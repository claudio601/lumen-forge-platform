/**
 * extract-jumpseller-ids.mjs
 * Extrae el ID numérico de Jumpseller desde las URLs de imágenes en products.ts
 * Uso: node scripts/extract-jumpseller-ids.mjs
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ── 1. Leer products.ts como texto ──────────────────────────────────────────
const productsPath = resolve(ROOT, 'src/data/products.ts');
const source = readFileSync(productsPath, 'utf-8');

// ── 2. Extraer bloques de producto con regex ─────────────────────────────────
// Busca cada objeto { id: '...', ..., images: ['url1', 'url2', ...], ... }
// Estrategia: encontrar todos los id slugs y sus arrays de images
const idRegex = /id:\s*'([^']+)'/g;
const imagesRegex = /images:\s*\[([^\]]*)\]/g;

const ids = [];
const imageArrays = [];

let m;
while ((m = idRegex.exec(source)) !== null) {
    ids.push(m[1]);
}
while ((m = imagesRegex.exec(source)) !== null) {
    imageArrays.push(m[1]);
}

// ── 3. Para cada par (id, images), extraer el Jumpseller ID ──────────────────
// Patrón: https://images.jumpseller.com/store/elights-cl/{ID}/...
const jsIdRegex = /elights-cl\/(\d+)\//;

const resultMap = {};
const failed = [];

// Nota: ids[0] corresponde a imageArrays[0], etc.
// Sin embargo, products.ts también tiene ids de categorías — filtrar solo los
// que tienen un array de images asociado (los de categorías no tienen images)
// Contamos cuántos ids hay antes del primer "images:" para alinear
// Estrategia más robusta: parsear por bloques de producto

// Buscar todos los bloques { id: '...', images: ['...'] } en el texto
// Usamos un approach de sliding window: encontrar cada "id:" seguido eventualmente
// por "images:" dentro del mismo objeto (antes del siguiente "id:")

const productBlockRegex = /\{\s*id:\s*'([^']+)'[\s\S]*?images:\s*\[([^\]]*)\]/g;

let matchCount = 0;
let noMatchCount = 0;

while ((m = productBlockRegex.exec(source)) !== null) {
    const slug = m[1];
    const imagesContent = m[2];

  // Extraer la primera URL del array de images
  const firstUrlMatch = imagesContent.match(/'([^']+)'/);
    if (!firstUrlMatch) {
          failed.push({ slug, reason: 'no image URL found in images array' });
          noMatchCount++;
          continue;
    }

  const firstUrl = firstUrlMatch[1];
    const jsIdMatch = firstUrl.match(jsIdRegex);

  if (!jsIdMatch) {
        failed.push({ slug, reason: `no Jumpseller ID in URL: ${firstUrl.slice(0, 80)}` });
        noMatchCount++;
        continue;
  }

  resultMap[slug] = parseInt(jsIdMatch[1], 10);
    matchCount++;
}

// ── 4. Reporte en consola ────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════');
console.log('  REPORTE: extract-jumpseller-ids');
console.log('══════════════════════════════════════════');
console.log(`  ✅ Productos con ID extraído : ${matchCount}`);
console.log(`  ❌ Productos sin match        : ${noMatchCount}`);
console.log(`  📦 Total procesados           : ${matchCount + noMatchCount}`);
console.log('══════════════════════════════════════════');

if (failed.length > 0) {
    console.log('\n  Productos que fallaron:');
    failed.forEach(f => {
          console.log(`    - ${f.slug}`);
          console.log(`      Razón: ${f.reason}`);
    });
} else {
    console.log('\n  ✨ Todos los productos tuvieron match exitoso.');
}

// ── 5. Muestra los primeros 5 resultados como preview ───────────────────────
console.log('\n  Preview (primeros 5 del mapa):');
const previewEntries = Object.entries(resultMap).slice(0, 5);
previewEntries.forEach(([slug, id]) => {
    console.log(`    "${slug}": ${id}`);
});

// ── 6. Escribir JSON de salida ───────────────────────────────────────────────
const outputPath = resolve(__dirname, 'jumpseller-ids-map.json');
writeFileSync(outputPath, JSON.stringify(resultMap, null, 2), 'utf-8');

console.log(`\n  📄 Archivo generado: scripts/jumpseller-ids-map.json`);
console.log(`     ${matchCount} entradas escritas.\n`);
