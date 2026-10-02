// scripts/sync-jumpseller.ts
// Sincroniza el catálogo del sitio con Jumpseller (fuente única de precios, nombres,
// fotos, categorías y productos activos). Solo LEE de Jumpseller.
//
//   npm run sync:catalog                      # simulación: informe, sin tocar archivos
//   npm run sync:catalog -- --write           # escribe los *.generated.ts
//   npm run sync:catalog -- --baseline legacy # compara contra src/data/products.ts
//   npm run sync:catalog -- --from-dir <dir>  # usa páginas guardadas, sin llamar a la API
//   npm run sync:catalog -- --save-raw <dir>  # guarda lo recibido (solo campos validados) bajo reports/
//
// Credenciales: JUMPSELLER_LOGIN y JUMPSELLER_TOKEN en el entorno (GitHub Secrets) o
// en .env.local. Nunca se imprimen.
//
// Códigos de salida: 0 ok · 1 validación o resguardo fallido (no se escribe nada)
//                    2 uso incorrecto · 3 credenciales o error de la API

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse as parseDotenv } from 'dotenv';
import { createJumpsellerClient, JumpsellerApiError, type FetchLike } from './jumpseller/client';
import { rawCategorySchema, rawProductSchema, validateList } from './jumpseller/schema';
import { normalizeCatalog } from './jumpseller/normalize';
import { buildDescriptions, diffDescriptions, renderDescriptionsReport } from './jumpseller/descriptions';
import { editorialOverlay } from '../src/data/catalog/overlay/editorial';
import { diffCatalog, renderDiffMarkdown, type BaselineEntry, type BenchmarkPrice } from './jumpseller/diff';
import {
  OUTPUT_PATHS,
  findForbiddenKeys,
  renderCategoriesFile,
  renderDescriptionsFile,
  type ProductDescription,
  renderPriceIndexFile,
  renderSiteIdsFile,
  renderSnapshotFile,
  snapshotHash,
  writeFilesAtomically,
} from './jumpseller/write';
import type { SnapshotProduct } from '../src/data/catalog/jumpseller.types';
import { LEGACY_SITE_IDS } from '../src/data/catalog/legacy-ids';
import { newSiteId, skuOwners } from '../src/data/catalog/build';
import {
  categories as siteCategories,
  IGNORED_JUMPSELLER_CATEGORY_IDS,
  JUMPSELLER_TOP_CATEGORY_TO_SLUG,
} from '../src/data/catalog/categories.config';
import { baseOverrides } from '../src/data/catalog/overlay/overrides';
import { renderContentReport, reviewContent } from './content/report';

export const MAX_DROP = 0.15;
const REPORT_DIR = 'reports/jumpseller-sync';

export interface SyncOptions {
  argv: string[];
  env: Record<string, string | undefined>;
  /** Raíz del repo: se leen .env.local y config, y se escriben las salidas relativas a ella. */
  root: string;
  log?: (msg: string) => void;
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  loadLegacyBaseline?: () => Promise<BaselineEntry[]>;
}

interface Args {
  write: boolean;
  baseline?: 'legacy' | 'snapshot';
  fromDir?: string;
  saveRaw?: string;
}

function parseArgs(argv: string[]): Args | string {
  const args: Args = { write: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--write') args.write = true;
    else if (a === '--baseline') {
      const v = argv[++i];
      if (v !== 'legacy' && v !== 'snapshot') return `--baseline debe ser "legacy" o "snapshot"`;
      args.baseline = v;
    } else if (a === '--from-dir') {
      if (!argv[i + 1]) return '--from-dir necesita una carpeta';
      args.fromDir = argv[++i];
    } else if (a === '--save-raw') {
      if (!argv[i + 1]) return '--save-raw necesita una carpeta';
      args.saveRaw = argv[++i];
    } else return `Opción desconocida: ${a}`;
  }
  return args;
}

/** Lee solo JUMPSELLER_LOGIN/JUMPSELLER_TOKEN de .env.local (con el parser de dotenv) si no vienen en el entorno. */
function readCredentials(root: string, env: SyncOptions['env']): { login?: string; token?: string } {
  let login = env.JUMPSELLER_LOGIN?.trim();
  let token = env.JUMPSELLER_TOKEN?.trim();
  const file = join(root, '.env.local');
  if ((!login || !token) && existsSync(file)) {
    const parsed = parseDotenv(readFileSync(file));
    login ||= parsed.JUMPSELLER_LOGIN?.trim();
    token ||= parsed.JUMPSELLER_TOKEN?.trim();
  }
  return { login: login || undefined, token: token || undefined };
}

function unwrapAll(items: unknown[], key: string): unknown[] {
  return items.map(i => ((i as Record<string, unknown>)?.[key] ?? i));
}

function readRawDir(dir: string) {
  const files = readdirSync(dir).sort();
  const load = (prefix: string, key: string) =>
    files
      .filter(f => f.startsWith(prefix) && f.endsWith('.json'))
      .flatMap(f => unwrapAll(JSON.parse(readFileSync(join(dir, f), 'utf8')) as unknown[], key));
  const countFile = join(dir, 'count.json');
  const count = existsSync(countFile) ? Number((JSON.parse(readFileSync(countFile, 'utf8')) as { count: unknown }).count) : undefined;
  return { products: load('products', 'product'), categories: load('categories', 'category'), count };
}

/** Catálogo legado congelado (antes de pasar a Jumpseller): fixture del 2026-09-30. */
async function defaultLegacyBaseline(): Promise<BaselineEntry[]> {
  const file = fileURLToPath(new URL('./fixtures/catalog-legacy-2026-09-30.json', import.meta.url));
  const legacy = JSON.parse(readFileSync(file, 'utf8')) as {
    jumpseller_id: number;
    name: string;
    price: number;
    cctVariants?: { sku: string; kelvin: number; price?: number; jumpseller_variant_id?: number }[];
  }[];
  return legacy.map(p => ({
    jumpseller_id: p.jumpseller_id,
    name: p.name,
    price: p.price,
    // El catálogo legado solo conoce las variantes CCT de BESTLED (con su id de Jumpseller).
    variants: p.cctVariants?.some(v => v.jumpseller_variant_id)
      ? p.cctVariants
          .filter(v => v.jumpseller_variant_id)
          .map(v => ({ id: v.jumpseller_variant_id!, price: v.price ?? p.price, label: `${v.sku} · ${v.kelvin}K` }))
      : undefined,
  }));
}

async function loadSnapshotBaseline(root: string): Promise<BaselineEntry[] | null> {
  const file = join(root, OUTPUT_PATHS.snapshot);
  if (!existsSync(file)) return null;
  const mod = (await import(pathToFileURL(resolve(file)).href)) as { jumpsellerSnapshot: SnapshotProduct[] };
  return mod.jumpsellerSnapshot.map(p => ({
    jumpseller_id: p.jumpseller_id,
    name: p.name,
    price: p.price,
    variants: p.variants.map(v => ({ id: v.id, price: v.price, label: [v.sku, ...v.options.map(o => o.value)].filter(Boolean).join(' · ') })),
  }));
}

async function loadPreviousDescriptions(root: string): Promise<Record<number, ProductDescription> | null> {
  const file = join(root, OUTPUT_PATHS.descriptions);
  if (!existsSync(file)) return null;
  const mod = (await import(pathToFileURL(resolve(file)).href)) as { productDescriptions: Record<number, ProductDescription> };
  return { ...mod.productDescriptions };
}

async function loadSiteIds(root: string): Promise<Record<number, string>> {
  const file = join(root, OUTPUT_PATHS.siteIds);
  if (!existsSync(file)) return {};
  const mod = (await import(pathToFileURL(resolve(file)).href)) as { SITE_IDS: Record<number, string> };
  return { ...mod.SITE_IDS };
}

function readJson<T>(root: string, rel: string): T {
  return JSON.parse(readFileSync(join(root, rel), 'utf8')) as T;
}

export async function runSync(opts: SyncOptions): Promise<number> {
  const log = opts.log ?? (msg => console.log(msg));
  const parsed = parseArgs(opts.argv);
  if (typeof parsed === 'string') {
    log(`Error: ${parsed}`);
    return 2;
  }
  const args = parsed;
  const root = opts.root;

  const abort = (msg: string) => {
    log(`ABORTADO: ${msg}`);
    log('No se modificó ningún archivo del sitio.');
    return 1;
  };

  // --save-raw solo dentro de reports/ (ignorado por git): nunca junto al código.
  let saveRawDir: string | undefined;
  if (args.saveRaw) {
    const reportsRoot = resolve(root, 'reports');
    saveRawDir = resolve(root, args.saveRaw);
    if (saveRawDir !== reportsRoot && !saveRawDir.startsWith(reportsRoot + sep)) {
      log('Error: --save-raw solo acepta carpetas dentro de reports/ (ignorada por git).');
      return 2;
    }
  }

  // 1. Obtener datos crudos
  let rawProducts: unknown[];
  let rawCategories: unknown[];
  let reportedCount: number | undefined;
  if (args.fromDir) {
    const raw = readRawDir(resolve(root, args.fromDir));
    rawProducts = raw.products;
    rawCategories = raw.categories;
    reportedCount = raw.count;
    log(`Leyendo páginas guardadas en ${args.fromDir}`);
  } else {
    const { login, token } = readCredentials(root, opts.env);
    const missing = [!login && 'JUMPSELLER_LOGIN', !token && 'JUMPSELLER_TOKEN'].filter(Boolean);
    if (missing.length) {
      log(`Error: falta ${missing.join(' y ')} (en .env.local o en las variables de entorno).`);
      return 3;
    }
    let countBefore: number;
    let countAfter: number;
    try {
      const client = createJumpsellerClient({ login: login!, token: token!, fetchImpl: opts.fetchImpl, sleep: opts.sleep });
      // Conteo antes y después: la paginación por offset puede duplicar o saltar
      // productos si el catálogo cambia mientras se descarga.
      countBefore = await client.countAvailableProducts();
      rawProducts = await client.fetchAvailableProducts();
      countAfter = await client.countAvailableProducts();
      rawCategories = await client.fetchCategories();
    } catch (err) {
      if (err instanceof JumpsellerApiError) {
        log(`Error de Jumpseller: ${err.message}`);
        return err.kind === 'shape' ? 1 : 3;
      }
      log('Error inesperado al consultar Jumpseller.');
      return 3;
    }
    log(`Jumpseller: ${rawProducts.length} productos disponibles, ${rawCategories.length} categorías.`);
    if (countBefore !== countAfter) {
      return abort(`el catálogo cambió durante la descarga (${countBefore} → ${countAfter} productos). Vuelve a intentarlo.`);
    }
    reportedCount = countAfter;
  }

  // 2. Validar (zod descarta todo campo que no esté en el esquema: costo, stock, descripción…)
  const products = validateList(rawProductSchema, rawProducts);
  const categories = validateList(rawCategorySchema, rawCategories);
  const issues = [...products.issues, ...categories.issues];
  if (issues.length) {
    return abort(
      `${issues.length} registro(s) con formato inesperado: ` +
        issues.slice(0, 10).map(i => `id ${String(i.id)} (${i.message})`).join('; '),
    );
  }
  if (saveRawDir) {
    mkdirSync(saveRawDir, { recursive: true });
    const saved = {
      'products-available.json': JSON.stringify(products.valid.map(product => ({ product }))),
      'categories.json': JSON.stringify(categories.valid.map(category => ({ category }))),
      'count.json': JSON.stringify({ count: reportedCount }),
    };
    // La descripción (texto público, sin limpiar) sí va en el respaldo local: --from-dir la necesita.
    const leaked = findForbiddenKeys(Object.values(saved), ['description']);
    if (leaked.length) return abort(`campos prohibidos en lo que se iba a guardar: ${leaked.join(', ')}`);
    for (const [name, content] of Object.entries(saved)) writeFileSync(join(saveRawDir, name), content, 'utf8');
    log(`Datos validados guardados en ${args.saveRaw}`);
  }
  if (products.valid.length === 0) return abort('Jumpseller no devolvió productos.');
  const ids = products.valid.map(p => p.id);
  const duplicated = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (duplicated.length) {
    return abort(`productos repetidos en la descarga (${[...new Set(duplicated)].join(', ')}). Vuelve a intentarlo.`);
  }
  if (reportedCount !== undefined && reportedCount !== products.valid.length) {
    return abort(`Jumpseller informa ${reportedCount} productos disponibles pero se recibieron ${products.valid.length}.`);
  }

  // 3. Normalizar
  const denylist = readJson<{ ids: number[] }>(root, 'scripts/jumpseller/denylist.json').ids;
  const result = normalizeCatalog(products.valid, categories.valid, {
    topCategoryToSlug: JUMPSELLER_TOP_CATEGORY_TO_SLUG,
    ignoredTopCategoryIds: IGNORED_JUMPSELLER_CATEGORY_IDS,
    denylist,
  });
  if (result.unmappedTopCategories.length) {
    return abort(
      'categorías principales de Jumpseller sin mapear en src/data/catalog/categories.config.ts: ' +
        result.unmappedTopCategories.map(c => `${c.id} "${c.name}" (${c.productIds.length} productos)`).join('; '),
    );
  }
  const next = result.products;
  if (next.length === 0) return abort('ningún producto quedó publicable después de las exclusiones.');
  const badPrices = next.filter(p => !(p.price > 0) || p.variants.some(v => !(v.price > 0)));
  if (badPrices.length) {
    return abort(`precio 0 o inválido en: ${badPrices.map(p => `${p.jumpseller_id} ${p.name}`).join('; ')}`);
  }

  // 4. Línea base y resguardo de caída
  const snapshotBaseline = args.baseline === 'legacy' ? null : await loadSnapshotBaseline(root);
  let baseline: BaselineEntry[];
  let baselineLabel: string;
  if (snapshotBaseline) {
    baseline = snapshotBaseline;
    baselineLabel = 'snapshot anterior';
  } else {
    if (args.baseline === 'snapshot') return abort('no existe un snapshot anterior (usa --baseline legacy).');
    baseline = await (opts.loadLegacyBaseline ?? defaultLegacyBaseline)();
    baselineLabel = 'catálogo legado (src/data/products.ts)';
  }
  if (next.length < baseline.length * (1 - MAX_DROP)) {
    return abort(
      `quedarían ${next.length} productos, ${Math.round((1 - next.length / baseline.length) * 100)}% menos que antes (${baseline.length}). ` +
        `Máximo permitido: ${MAX_DROP * 100}%.`,
    );
  }

  // 5. Registrar ids de productos nuevos (una sola vez: después nunca cambian)
  const siteIds = await loadSiteIds(root);
  const taken = new Set([...Object.values(LEGACY_SITE_IDS), ...Object.values(siteIds)]);
  const newIds: number[] = [];
  for (const p of next) {
    if (LEGACY_SITE_IDS[p.jumpseller_id] || siteIds[p.jumpseller_id]) continue;
    const id = newSiteId(p.permalink, p.jumpseller_id, taken);
    siteIds[p.jumpseller_id] = id;
    taken.add(id);
    newIds.push(p.jumpseller_id);
  }

  // SKUs repetidos entre productos distintos (se corrigen en Jumpseller)
  const duplicateSkus = [...skuOwners(next)]
    .filter(([, ids]) => ids.size > 1)
    .map(([sku, ids]) => ({ sku, jumpseller_ids: [...ids].sort((a, b) => a - b) }))
    .sort((a, b) => a.sku.localeCompare(b.sku));

  // Descripciones (texto y especificaciones agrupadas), limpias. Una problemática se omite y
  // se informa; nunca bloquea la sincronización. Sin el campo en los datos (respaldo
  // anterior), se mantiene el archivo actual.
  const previousDescriptions = await loadPreviousDescriptions(root);
  const desc = buildDescriptions(products.valid, new Set(next.map(p => p.jumpseller_id)), editorialOverlay);
  if (!desc.available) log('Los datos no traen descripciones: se mantienen las del sitio.');
  if (desc.skipped.length) log(`Descripciones omitidas: ${desc.skipped.map(s => `${s.id} (${s.reason})`).join(', ')}`);
  if (desc.warnings.length) log(`Descripciones con textos a corregir en Jumpseller: ${desc.warnings.map(w => `${w.id} ("${w.phrase}")`).join(', ')}`);
  if (desc.unknownLabels.length) log(`Etiquetas de especificación sin grupo: ${desc.unknownLabels.join(', ')}`);

  // 6. Generar archivos y verificar que no filtren campos prohibidos
  const hash = snapshotHash(next);
  const files = {
    [OUTPUT_PATHS.snapshot]: renderSnapshotFile(next, hash),
    [OUTPUT_PATHS.categories]: renderCategoriesFile(next, hash),
    [OUTPUT_PATHS.priceIndex]: renderPriceIndexFile(next, hash),
    [OUTPUT_PATHS.siteIds]: renderSiteIdsFile(siteIds, hash),
    ...(desc.available ? { [OUTPUT_PATHS.descriptions]: renderDescriptionsFile(desc.descriptions, hash) } : {}),
  };
  const forbidden = findForbiddenKeys(Object.values(files));
  if (forbidden.length) return abort(`campos prohibidos en la salida: ${forbidden.join(', ')}`);

  // 7. Informe (reports/ está en .gitignore)
  const diff = diffCatalog(baseline, next, baselineLabel);
  const benchmark = readJson<{ prices: BenchmarkPrice[] }>(root, 'scripts/jumpseller/benchmark-2026-03-18.json').prices;
  const markdown = renderDiffMarkdown(diff, { snapshotHash: hash, excluded: result.excluded, benchmark, next, duplicateSkus });
  const descriptionsReport = renderDescriptionsReport(
    desc,
    previousDescriptions ? diffDescriptions(previousDescriptions, desc.descriptions) : null,
    new Map(next.map(p => [p.jumpseller_id, p.name])),
    previousDescriptions ? Object.keys(previousDescriptions).length : 0,
  );
  // Contenido SEO: revisado contra los datos nuevos (solo informa, no bloquea)
  const contentReview = reviewContent(root, next, desc.available ? desc.descriptions : (previousDescriptions ?? {}), {
    categoryNames: Object.fromEntries(siteCategories.map(c => [c.slug, c.name])),
    site: p => ({ sku: p.sku || baseOverrides[p.jumpseller_id]?.sku || '', brand: p.brand ?? baseOverrides[p.jumpseller_id]?.brand ?? '' }),
    hasEditorial: id => !!editorialOverlay[id]?.description,
  });
  const contentReport = renderContentReport(contentReview, new Map(next.map(p => [p.jumpseller_id, p.name])));
  if (contentReview.mismatched.length) log(`Contenido SEO a corregir: ${contentReview.mismatched.map(m => m.id).join(', ')}`);
  const summary = {
    snapshotHash: hash,
    baseline: baselineLabel,
    products: next.length,
    previousProducts: baseline.length,
    priceChanges: diff.priceChanges.length,
    flaggedPriceChanges: diff.priceChanges.filter(c => c.flagged).map(c => c.jumpseller_id),
    variantPriceChanges: diff.variantPriceChanges.length,
    flaggedVariantPriceChanges: diff.variantPriceChanges.filter(c => c.flagged).map(c => c.variant_id),
    added: diff.added.map(a => a.jumpseller_id),
    removed: diff.removed.map(r => r.jumpseller_id),
    renamed: diff.renamed.map(r => r.jumpseller_id),
    excluded: result.excluded,
    newSiteIds: newIds,
    descriptions: Object.keys(desc.descriptions).length,
    descriptionsAvailable: desc.available,
    withoutDescription: next.filter(p => !desc.descriptions[p.jumpseller_id]).map(p => p.jumpseller_id),
    descriptionWarnings: desc.warnings,
    specLabelsWithoutGroup: desc.unknownLabels,
    descriptionsSkipped: desc.skipped,
    contentWritten: contentReview.written,
    contentMismatched: contentReview.mismatched,
    contentOrphans: contentReview.orphans,
    duplicateSkus,
    wrote: args.write,
  };
  mkdirSync(join(root, REPORT_DIR), { recursive: true });
  writeFileSync(join(root, REPORT_DIR, 'diff.md'), `${markdown}\n\n${descriptionsReport}\n\n${contentReport}\n`, 'utf8');
  writeFileSync(join(root, REPORT_DIR, 'summary.json'), JSON.stringify(summary, null, 2) + '\n', 'utf8');

  // 8. Escribir (solo con --write)
  if (args.write) writeFilesAtomically(root, files);

  log(
    `Snapshot ${hash}: ${next.length} productos (antes ${baseline.length}) · ` +
      `${diff.priceChanges.length} cambios de precio · ${diff.added.length} nuevos · ` +
      `${diff.removed.length} salen · ${result.excluded.length} excluidos.`,
  );
  log(`Informe: ${REPORT_DIR}/diff.md`);
  log(args.write ? 'Archivos generados actualizados.' : 'Simulación: no se modificó ningún archivo del sitio (usa --write).');
  return 0;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  runSync({ argv: process.argv.slice(2), env: process.env, root: process.cwd() }).then(
    code => process.exit(code),
    (err: unknown) => {
      console.log(`Error inesperado: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    },
  );
}
