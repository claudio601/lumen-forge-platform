// scripts/export-products.mjs
// Lee products.ts como texto y extrae los campos clave a JSON limpio
// Uso: node scripts/export-products.mjs

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcPath  = join(__dirname, '../src/data/products.ts');
const outPath  = join(__dirname, 'elights-products.json');

const source = readFileSync(srcPath, 'utf-8');

// Dividir en bloques individuales de objeto { ... }
// Usamos un parser de llaves para no depender de regex frágiles
function splitObjectBlocks(text) {
  const blocks = [];
  let depth = 0;
  let start = -1;

  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (text[i] === '}') {
      depth--;
      if (depth === 0 && start !== -1) {
        blocks.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return blocks;
}

// Extraer valor de un campo por nombre desde un bloque de texto
function extractField(block, fieldName) {
  // Soporta: fieldName: 'value', fieldName: "value", fieldName: 123, fieldName: true/false
  const re = new RegExp(
    `\\b${fieldName}\\??\\s*:\\s*(?:'([^']*)'|"([^"]*)"|([\\d.]+)|(true|false))`,
    'i'
  );
  const m = block.match(re);
  if (!m) return undefined;
  if (m[1] !== undefined) return m[1];   // single-quoted string
  if (m[2] !== undefined) return m[2];   // double-quoted string
  if (m[3] !== undefined) return parseFloat(m[3]); // number
  if (m[4] !== undefined) return m[4] === 'true';   // boolean
  return undefined;
}

const blocks = splitObjectBlocks(source);
const products = [];

for (const block of blocks) {
  // Solo procesar bloques que sean productos reales (tienen jumpseller_id)
  if (!block.includes('jumpseller_id')) continue;

  const id       = extractField(block, 'id');
  const sku      = extractField(block, 'sku');
  const name     = extractField(block, 'name');
  const price    = extractField(block, 'price');
  const category = extractField(block, 'category');
  const watts    = extractField(block, 'watts');

  // Validar que tenga los campos mínimos
  if (!sku || !name || price === undefined) continue;

  products.push({
    id:       id       ?? '',
    sku:      sku      ?? '',
    name:     name     ?? '',
    price:    typeof price === 'number' ? price : parseFloat(price) || 0,
    category: category ?? '',
    watts:    typeof watts === 'number' ? watts : parseFloat(watts) || 0,
  });
}

writeFileSync(outPath, JSON.stringify(products, null, 2), 'utf-8');

console.log(`✅ Exportados ${products.length} productos → ${outPath}`);
if (products.length > 0) {
  console.log('\nEjemplos:');
  products.slice(0, 3).forEach(p =>
    console.log(`  [${p.sku}] ${p.name} | ${p.watts}W | $${p.price} | cat: ${p.category}`)
  );
}
