import { readFileSync, writeFileSync, copyFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const MAP_PATH      = resolve(__dirname, 'jumpseller-ids-map.json');
const PRODUCTS_PATH = resolve(ROOT, 'src/data/products.ts');
const BACKUP_PATH   = resolve(ROOT, 'src/data/products.ts.bak');

const idMap    = JSON.parse(readFileSync(MAP_PATH, 'utf-8'));
const original = readFileSync(PRODUCTS_PATH, 'utf-8');

copyFileSync(PRODUCTS_PATH, BACKUP_PATH);
console.log('\n  Backup creado: src/data/products.ts.bak');

let source   = original;
let injected = 0;
let skipped  = 0;
const notFound = [];

for (const [slug, jsId] of Object.entries(idMap)) {
  const esc = slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Idempotencia: ya tiene jumpseller_id?
  const alreadyRe = new RegExp(
    String.raw`\{\s*jumpseller_id:\s*\d+,\s*id:\s*'` + esc + `'`, 'ms'
  );
  if (alreadyRe.test(source)) { skipped++; continue; }

  // Inyectar: { id: 'slug' -> { jumpseller_id: ID, id: 'slug'
  const insertRe = new RegExp(String.raw`(\{\s*)(id:\s*'` + esc + `')`);
  const next = source.replace(insertRe, `$1jumpseller_id: ${jsId}, $2`);
  if (next === source) { notFound.push(slug); continue; }
  source = next;
  injected++;
}

writeFileSync(PRODUCTS_PATH, source, 'utf-8');

const sep = '='.repeat(43);
console.log('\n' + sep);
console.log('  REPORTE: inject-jumpseller-ids');
console.log(sep);
console.log(`  IDs inyectados        : ${injected}`);
console.log(`  Ya tenian ID (skip)   : ${skipped}`);
console.log(`  No encontrados        : ${notFound.length}`);
console.log(`  Total en mapa         : ${Object.keys(idMap).length}`);
console.log(sep);

if (notFound.length > 0) {
  console.log('\n  Slugs no encontrados:');
  notFound.forEach(s => console.log('    - ' + s));
}

const preRe = /\{\s*jumpseller_id:\s*\d+,\s*id:\s*'[^']+'/g;
let cnt = 0, m;
console.log('\n  Preview (primeros 3 productos):');
while ((m = preRe.exec(source)) !== null && cnt < 3) {
  const snip = source.slice(m.index, m.index + 200).split('\n').slice(0, 6).join('\n');
  console.log(`\n  [${cnt + 1}]\n${snip}`);
  cnt++;
}
console.log('\n  products.ts actualizado.\n');
