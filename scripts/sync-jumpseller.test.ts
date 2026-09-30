// scripts/sync-jumpseller.test.ts
// Pruebas de la sincronización con Jumpseller, sin red: la API se simula con fixtures
// que tienen la forma real de las respuestas (incluido un cost_per_item falso).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJumpsellerClient, JumpsellerApiError, type FetchLike } from './jumpseller/client';
import { runSync } from './sync-jumpseller';
import { findForbiddenKeys, OUTPUT_PATHS } from './jumpseller/write';
import type { BaselineEntry } from './jumpseller/diff';
import type { SnapshotProduct } from '../src/data/catalog/jumpseller.types';

const FIX = join(__dirname, 'fixtures/jumpseller');
const fixture = (f: string) => JSON.parse(readFileSync(join(FIX, f), 'utf8'));
const LOGIN = 'tienda-login';
const TOKEN = 'TOKEN-SUPER-SECRETO-123';
const noSleep = async () => {};

type Reply = { status: number; body?: unknown; headers?: Record<string, string> };
function fakeFetch(route: (url: URL) => Reply) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fn: FetchLike = async (input, init) => {
    calls.push({ url: input, headers: init?.headers ?? {} });
    const r = route(new URL(input));
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      headers: { get: (n: string) => r.headers?.[n] ?? null },
      json: async () => r.body,
    };
  };
  return { fn, calls };
}

/** API simulada desde los fixtures, paginando de a `limit`. */
function apiFromFixtures(products = fixture('products-available.json'), categories = fixture('categories.json'), count?: number | number[]) {
  let countCalls = 0;
  return fakeFetch(url => {
    const limit = Number(url.searchParams.get('limit') ?? 50);
    const page = Number(url.searchParams.get('page') ?? 1);
    const slice = (arr: unknown[]) => arr.slice((page - 1) * limit, page * limit);
    if (url.pathname.endsWith('/products/status/available/count.json')) {
      const c = Array.isArray(count) ? count[Math.min(countCalls++, count.length - 1)] : count;
      return { status: 200, body: { count: c ?? products.length } };
    }
    if (url.pathname.endsWith('/products/status/available.json')) return { status: 200, body: slice(products) };
    if (url.pathname.endsWith('/categories.json')) return { status: 200, body: slice(categories) };
    return { status: 404 };
  });
}

/** Raíz temporal con los archivos de config que lee la sincronización. */
function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'sync-js-'));
  mkdirSync(join(root, 'scripts/jumpseller'), { recursive: true });
  for (const f of ['denylist.json', 'benchmark-2026-03-18.json']) {
    cpSync(join(__dirname, 'jumpseller', f), join(root, 'scripts/jumpseller', f));
  }
  return root;
}

const legacy4: BaselineEntry[] = [
  { jumpseller_id: 2301098, name: 'ALUMBRADO PÚBLICO BESTLED 40W IP66 IK08', price: 105000 },
  { jumpseller_id: 2502343, name: 'Foco Dicroico LED Embutido SMD 1W Niquel', price: 2490 },
  { jumpseller_id: 2254290, name: 'PROYECTOR LED ANTIVANDÁLICO 200W IP66', price: 62400 },
  { jumpseller_id: 4320902, name: 'ALUMBRADO PÚBLICO MINI CROSS 60W IP66 IK08', price: 115000 },
];

async function run(root: string, argv: string[], extra: Partial<Parameters<typeof runSync>[0]> = {}) {
  const logs: string[] = [];
  const api = extra.fetchImpl ? null : apiFromFixtures();
  const code = await runSync({
    argv,
    env: { JUMPSELLER_LOGIN: LOGIN, JUMPSELLER_TOKEN: TOKEN },
    root,
    log: m => logs.push(m),
    fetchImpl: api?.fn,
    sleep: noSleep,
    loadLegacyBaseline: async () => legacy4,
    ...extra,
  });
  return { code, logs, api };
}

function readGenerated(root: string) {
  return Object.fromEntries(
    Object.entries(OUTPUT_PATHS).map(([k, rel]) => [k, existsSync(join(root, rel)) ? readFileSync(join(root, rel), 'utf8') : null]),
  ) as Record<keyof typeof OUTPUT_PATHS, string | null>;
}

function parseExport<T>(file: string, name: string): T {
  const start = file.indexOf(`${name}`);
  const eq = file.indexOf('= ', start) + 2;
  return JSON.parse(file.slice(eq, file.lastIndexOf(';')));
}

describe('cliente Jumpseller', () => {
  it('pagina hasta recibir una página corta', async () => {
    const items = [1, 2, 3].map(id => ({ product: { id } }));
    const api = fakeFetch(url => {
      const page = Number(url.searchParams.get('page'));
      return { status: 200, body: items.slice((page - 1) * 2, page * 2) };
    });
    const client = createJumpsellerClient({ login: LOGIN, token: TOKEN, fetchImpl: api.fn, sleep: noSleep, pageSize: 2 });
    const all = await client.fetchAvailableProducts();
    expect(all).toHaveLength(3);
    expect(api.calls).toHaveLength(2);
  });

  it('un 429 seguido de 200 funciona y espera según la ventana de la API', async () => {
    let n = 0;
    const api = fakeFetch(() => (n++ === 0 ? { status: 429, headers: { 'Jumpseller-PerSecondRateLimit-Remaining': '0' } } : { status: 200, body: { count: 5 } }));
    const sleep = vi.fn(async (_ms: number) => {});
    const client = createJumpsellerClient({ login: LOGIN, token: TOKEN, fetchImpl: api.fn, sleep, random: () => 0 });
    await expect(client.countAvailableProducts()).resolves.toBe(5);
    expect(sleep.mock.calls.some(([ms]) => ms >= 1000)).toBe(true);
  });

  it('reintenta errores 5xx y de red', async () => {
    let n = 0;
    const fn: FetchLike = async () => {
      n++;
      if (n === 1) throw new Error('ECONNRESET');
      if (n === 2) return { ok: false, status: 502, headers: { get: () => null }, json: async () => ({}) };
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ count: 7 }) };
    };
    const client = createJumpsellerClient({ login: LOGIN, token: TOKEN, fetchImpl: fn, sleep: noSleep });
    await expect(client.countAvailableProducts()).resolves.toBe(7);
    expect(n).toBe(3);
  });

  it('una respuesta cortada o con JSON inválido se reintenta', async () => {
    let n = 0;
    const fn: FetchLike = async () => {
      n++;
      return {
        ok: true, status: 200, headers: { get: () => null },
        json: async () => { if (n === 1) throw new SyntaxError('Unexpected end of JSON input'); return { count: 3 }; },
      };
    };
    const client = createJumpsellerClient({ login: LOGIN, token: TOKEN, fetchImpl: fn, sleep: noSleep });
    await expect(client.countAvailableProducts()).resolves.toBe(3);
    expect(n).toBe(2);
  });

  it('autentica solo con header Basic; la URL no lleva credenciales', async () => {
    const api = fakeFetch(() => ({ status: 200, body: { count: 1 } }));
    const client = createJumpsellerClient({ login: LOGIN, token: TOKEN, fetchImpl: api.fn, sleep: noSleep });
    await client.countAvailableProducts();
    const { url, headers } = api.calls[0];
    expect(headers.Authorization).toBe('Basic ' + Buffer.from(`${LOGIN}:${TOKEN}`).toString('base64'));
    expect(url).not.toMatch(/login|authtoken|token/i);
    expect(url).not.toContain(TOKEN);
  });

  it('401 no se reintenta y se informa como error de credenciales', async () => {
    const api = fakeFetch(() => ({ status: 401 }));
    const client = createJumpsellerClient({ login: LOGIN, token: TOKEN, fetchImpl: api.fn, sleep: noSleep });
    await expect(client.countAvailableProducts()).rejects.toMatchObject({ kind: 'auth' });
    expect(api.calls).toHaveLength(1);
    expect(new JumpsellerApiError('x', 'auth')).toBeInstanceOf(Error);
  });
});

describe('sincronización completa', () => {
  let root: string;
  beforeEach(() => { root = tempRoot(); return () => rmSync(root, { recursive: true, force: true }); });

  it('--write genera los 3 archivos con los productos publicables y el informe', async () => {
    const { code, logs } = await run(root, ['--write', '--baseline', 'legacy']);
    expect(code, logs.join('\n')).toBe(0);
    const files = readGenerated(root);
    const snapshot = parseExport<SnapshotProduct[]>(files.snapshot!, 'jumpsellerSnapshot');
    expect(snapshot.map(p => p.jumpseller_id)).toEqual([2254290, 2301098, 2502343, 14582065]);

    const byId = new Map(snapshot.map(p => [p.jumpseller_id, p]));
    // Subcategoría sola → se sube por parent_id hasta la categoría principal
    expect(byId.get(2502343)!.categories).toEqual(['paneles-led']);
    expect(byId.get(2254290)!.categories).toEqual(['proyectores-led']);
    // Dos categorías principales, sin repetir
    expect(byId.get(14582065)!.categories).toEqual(['solar', 'alumbrado-publico']);
    // Nombre recortado y SKU sin caracteres invisibles
    expect(byId.get(2254290)!.name).toBe('PROYECTOR LED ANTIVANDÁLICO 200W IP66');
    expect(byId.get(2254290)!.sku).toBe('CHIPX200');
    // Variantes e imágenes ordenadas por posición; opciones recortadas
    const bestled = byId.get(2301098)!;
    expect(bestled.variants.map(v => v.sku)).toEqual(['APB401', 'APB407', 'APB40N', 'APB40F']);
    expect(bestled.variants[2].options[0].value).toBe('Luz Neutra - 4000K');
    expect(bestled.images.map(i => i.id)).toEqual([7785930, 7785929]);

    const summary = JSON.parse(readFileSync(join(root, 'reports/jumpseller-sync/summary.json'), 'utf8'));
    expect(summary.excluded.map((e: { jumpseller_id: number; reason: string }) => [e.jumpseller_id, e.reason])).toEqual([
      [2499415, 'sin-categoria'],
      [2506956, 'no-disponible'],
      [34540602, 'lista-de-exclusion'],
      [34549999, 'producto-de-prueba'],
    ]);
    const md = readFileSync(join(root, 'reports/jumpseller-sync/diff.md'), 'utf8');
    expect(md).toContain('Productos que salen del sitio');
    expect(md).toContain('4320902');
    expect(md).toContain('benchmark de mercado');
  });

  it('el costo (cost_per_item), el stock y la descripción nunca llegan a la salida', async () => {
    await run(root, ['--write', '--baseline', 'legacy']);
    for (const content of Object.values(readGenerated(root))) {
      expect(content).not.toMatch(/cost_per_item|12345|55555|stock|description|Descripción HTML/);
    }
    expect(findForbiddenKeys(['{"cost_per_item": 1}'])).toEqual(['cost_per_item']);
  });

  it('las tildes se escriben en UTF-8', async () => {
    await run(root, ['--write', '--baseline', 'legacy']);
    const bytes = readFileSync(join(root, OUTPUT_PATHS.snapshot));
    expect(bytes.includes(Buffer.from('ALUMBRADO PÚBLICO', 'utf8'))).toBe(true);
    expect(bytes.toString('utf8')).not.toContain('\\u00da');
  });

  it('el snapshot y el índice de precios coinciden', async () => {
    await run(root, ['--write', '--baseline', 'legacy']);
    const files = readGenerated(root);
    const snapshot = parseExport<SnapshotProduct[]>(files.snapshot!, 'jumpsellerSnapshot');
    const index = parseExport<Record<string, { price: number; sku: string; variants: Record<string, { price: number }> }>>(files.priceIndex!, 'priceIndex');
    expect(Object.keys(index).map(Number).sort((a, b) => a - b)).toEqual(snapshot.map(p => p.jumpseller_id));
    for (const p of snapshot) {
      expect(index[p.jumpseller_id].price).toBe(p.price);
      for (const v of p.variants) expect(index[p.jumpseller_id].variants[v.id].price).toBe(v.price);
    }
    const hashes = Object.values(files).map(f => f!.match(/SNAPSHOT_HASH = '([0-9a-f]+)'/)![1]);
    expect(new Set(hashes).size).toBe(1);
  });

  it('la salida es idéntica byte a byte aunque la API entregue otro orden', async () => {
    await run(root, ['--write', '--baseline', 'legacy']);
    const first = readGenerated(root);
    const root2 = tempRoot();
    const shuffled = [...fixture('products-available.json')].reverse();
    const cats = [...fixture('categories.json')].reverse();
    await run(root2, ['--write', '--baseline', 'legacy'], { fetchImpl: apiFromFixtures(shuffled, cats).fn });
    expect(readGenerated(root2)).toEqual(first);
    rmSync(root2, { recursive: true, force: true });
  });

  it('sin --write es una simulación: escribe el informe pero no los archivos del sitio', async () => {
    const { code } = await run(root, ['--baseline', 'legacy']);
    expect(code).toBe(0);
    expect(Object.values(readGenerated(root)).every(f => f === null)).toBe(true);
    expect(existsSync(join(root, 'reports/jumpseller-sync/diff.md'))).toBe(true);
  });

  it('el informe muestra cambios de precio en variantes', async () => {
    const withVariants: BaselineEntry[] = legacy4.map(b =>
      b.jumpseller_id === 2301098
        ? { ...b, variants: [{ id: 111887368, price: 70000, label: 'APB407 · 2700K' }, { id: 95224064, price: 108500 }, { id: 1, price: 5000, label: 'vieja' }] }
        : b,
    );
    await run(root, ['--baseline', 'legacy'], { loadLegacyBaseline: async () => withVariants });
    const md = readFileSync(join(root, 'reports/jumpseller-sync/diff.md'), 'utf8');
    expect(md).toContain('Cambios de precio en variantes');
    expect(md).toMatch(/⚠️ \| 2301098 \|[^\n]*APB407[^\n]*\$70\.000 \| \$119\.400/); // +70,6%: marcado
    expect(md).toContain('ya no existe');
    expect(md).toContain('variante nueva');
    const summary = JSON.parse(readFileSync(join(root, 'reports/jumpseller-sync/summary.json'), 'utf8'));
    expect(summary.flaggedVariantPriceChanges).toEqual([111887368]);
  });

  it('--save-raw solo acepta carpetas dentro de reports/', async () => {
    for (const dir of ['scripts/fixtures/jumpseller', 'tmp/raw', '/tmp/fuera', 'reports/../src']) {
      const { code, logs } = await run(root, ['--save-raw', dir, '--baseline', 'legacy']);
      expect(code, dir).toBe(2);
      expect(logs.join('\n')).toContain('reports/');
    }
  });

  it('--save-raw guarda solo campos validados (nunca costo, stock ni descripción) y se puede reproducir', async () => {
    const { code } = await run(root, ['--save-raw', 'reports/raw', '--baseline', 'legacy', '--write']);
    expect(code).toBe(0);
    const saved = readdirSync(join(root, 'reports/raw')).map(f => readFileSync(join(root, 'reports/raw', f), 'utf8')).join('\n');
    expect(saved).not.toMatch(/cost_per_item|12345|55555|"stock|description|Descripción HTML/);
    const first = readGenerated(root);
    const root2 = tempRoot();
    const fetchImpl = vi.fn();
    const again = await run(root2, ['--from-dir', join(root, 'reports/raw'), '--baseline', 'legacy', '--write'], { fetchImpl });
    expect(again.code).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(readGenerated(root2)).toEqual(first);
    rmSync(root2, { recursive: true, force: true });
  });

  it('registra una sola vez el id de un producto nuevo: no cambia aunque cambie su permalink', async () => {
    const nuevo = (permalink: string) => ({ product: { id: 999001, name: 'PANEL LED NUEVO 30W', permalink, price: 9990, status: 'available', sku: null, brand: null, featured: false, categories: [{ id: 286969, name: 'PANEL LED', parent_id: null }], images: [{ id: 1, url: 'https://images.jumpseller.com/x.png', position: 1 }], variants: [] } });
    const base = fixture('products-available.json');
    await run(root, ['--write', '--baseline', 'legacy'], { fetchImpl: apiFromFixtures([...base, nuevo('panel/nuevo-30w')]).fn });
    const idsFile = () => readFileSync(join(root, OUTPUT_PATHS.siteIds), 'utf8');
    expect(idsFile()).toContain('"999001": "panel-nuevo-30w"');
    const summary = JSON.parse(readFileSync(join(root, 'reports/jumpseller-sync/summary.json'), 'utf8'));
    expect(summary.newSiteIds).toContain(999001);
    // Jumpseller cambia el permalink: el id publicado se mantiene
    await run(root, ['--write', '--baseline', 'legacy'], { fetchImpl: apiFromFixtures([...base, nuevo('panel-nuevo-30w-ip40')]).fn });
    expect(idsFile()).toContain('"999001": "panel-nuevo-30w"');
    // y si deja de publicarse, el registro lo conserva (para no reutilizar ese id)
    await run(root, ['--write', '--baseline', 'legacy']);
    expect(idsFile()).toContain('"999001": "panel-nuevo-30w"');
  });

  it('el informe lista los SKU repetidos entre productos distintos', async () => {
    const dup = fixture('products-available.json') as { product: Record<string, unknown> }[];
    dup[1].product.sku = 'APB40N'; // mismo SKU que una variante del BESTLED 40W
    await run(root, ['--baseline', 'legacy'], { fetchImpl: apiFromFixtures(dup).fn });
    const summary = JSON.parse(readFileSync(join(root, 'reports/jumpseller-sync/summary.json'), 'utf8'));
    expect(summary.duplicateSkus).toEqual([{ sku: 'APB40N', jumpseller_ids: [2301098, 2502343] }]);
    expect(readFileSync(join(root, 'reports/jumpseller-sync/diff.md'), 'utf8')).toContain('SKU repetidos en Jumpseller');
  });

  it('--from-dir usa páginas guardadas sin llamar a la API', async () => {
    const fetchImpl = vi.fn();
    const { code } = await run(root, ['--from-dir', FIX, '--baseline', 'legacy', '--write'], { fetchImpl });
    expect(code).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(readGenerated(root).snapshot).toContain('2301098');
  });
});

describe('credenciales', () => {
  let root: string;
  beforeEach(() => { root = tempRoot(); return () => rmSync(root, { recursive: true, force: true }); });

  it('sin credenciales falla limpio (código 3) sin escribir nada', async () => {
    const { code, logs } = await run(root, ['--write'], { env: {} });
    expect(code).toBe(3);
    expect(logs.join('\n')).toContain('JUMPSELLER_LOGIN');
    expect(existsSync(join(root, 'reports'))).toBe(false);
  });

  it('lee .env.local como dotenv: comillas, comentarios y la última aparición gana', async () => {
    writeFileSync(join(root, '.env.local'), [
      'JUMPSELLER_LOGIN=viejo',
      'JUMPSELLER_LOGIN="tienda-login"  ',
      "JUMPSELLER_TOKEN='TOKEN-SUPER-SECRETO-123' # token nuevo",
      '',
    ].join('\n'));
    const api = apiFromFixtures();
    const { code } = await run(root, ['--baseline', 'legacy'], { env: {}, fetchImpl: api.fn });
    expect(code).toBe(0);
    expect(api.calls[0].headers.Authorization).toBe('Basic ' + Buffer.from(`${LOGIN}:${TOKEN}`).toString('base64'));
  });

  it('las credenciales nunca aparecen en lo que se imprime, ni siquiera ante errores', async () => {
    const b64 = Buffer.from(`${LOGIN}:${TOKEN}`).toString('base64');
    for (const status of [401, 500, 200]) {
      const api = fakeFetch(url => (status === 200 && url.pathname.endsWith('count.json') ? { status: 200, body: { count: 999 } } : status === 200 ? { status: 200, body: [] } : { status }));
      const { logs } = await run(root, ['--write'], { fetchImpl: api.fn });
      const out = logs.join('\n');
      expect(out).not.toContain(TOKEN);
      expect(out).not.toContain(b64);
    }
  });
});

describe('resguardos: abortan sin tocar archivos', () => {
  let root: string;
  let before: ReturnType<typeof readGenerated>;
  beforeEach(async () => {
    root = tempRoot();
    const seed = await run(root, ['--write', '--baseline', 'legacy']);
    expect(seed.code, seed.logs.join('\n')).toBe(0);
    before = readGenerated(root);
    expect(before.snapshot).not.toBeNull();
    return () => rmSync(root, { recursive: true, force: true });
  });

  const products = () => fixture('products-available.json') as { product: Record<string, unknown> }[];

  async function expectAbort(reason: string, fetchImpl: FetchLike, extra = {}) {
    const { code, logs } = await run(root, ['--write', '--baseline', 'legacy'], { fetchImpl, ...extra });
    const out = logs.join('\n');
    expect(code, out).toBe(1);
    expect(out).toContain('ABORTADO');
    expect(out).toContain(reason);
    expect(readGenerated(root)).toEqual(before);
  }
  const oneEntryBaseline = { loadLegacyBaseline: async () => legacy4.slice(0, 1) };

  it('formato inesperado (zod)', async () => {
    const bad = products();
    bad[0].product.price = 'no-es-precio';
    await expectAbort('formato inesperado', apiFromFixtures(bad).fn);
  });

  it('el conteo de Jumpseller no coincide con lo recibido', async () => {
    await expectAbort('informa 99', apiFromFixtures(undefined, undefined, 99).fn);
  });

  it('el catálogo cambia mientras se descarga (conteo antes ≠ después)', async () => {
    await expectAbort('cambió durante la descarga', apiFromFixtures(undefined, undefined, [8, 9]).fn);
  });

  it('productos repetidos en la descarga (paginación desplazada)', async () => {
    const dup = products();
    dup[3] = dup[0];
    await expectAbort('repetidos', apiFromFixtures(dup).fn);
  });

  it('Jumpseller no devuelve productos', async () => {
    await expectAbort('no devolvió productos', apiFromFixtures([], undefined, 0).fn);
  });

  it('una categoría principal nueva sin mapear', async () => {
    const withNew = products();
    withNew[1].product.categories = [{ id: 9999999, name: 'NUEVA', parent_id: null }];
    await expectAbort('sin mapear', apiFromFixtures(withNew).fn, oneEntryBaseline);
  });

  it('un precio 0', async () => {
    const zero = products();
    zero[0].product.price = 0;
    await expectAbort('precio 0', apiFromFixtures(zero).fn, oneEntryBaseline);
  });

  it('caída de más de 15% respecto a la línea base', async () => {
    const big: BaselineEntry[] = Array.from({ length: 20 }, (_, i) => ({ jumpseller_id: i + 1, name: `P${i}`, price: 1000 }));
    await expectAbort('% menos', apiFromFixtures().fn, { loadLegacyBaseline: async () => big });
  });
});
