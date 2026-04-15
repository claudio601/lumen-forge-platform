/**
 * extract-variant-ids.mjs
 * Enriquecer products.ts con jumpseller_variant_id de la primera variante de cada producto
 * Uso: node scripts/extract-variant-ids.mjs
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from 'dotenv';

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '..', '.env.local') });

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ── 1. Leer products.ts ─────────────────────────────────────────────────────
const productsPath = resolve(ROOT, 'src/data/products.ts');
let source = readFileSync(productsPath, 'utf-8');

// ── 2. Parsear productos con jumpseller_id ──────────────────────────────────
// Buscar productos que ya tienen jumpseller_id
const productRegex = /{[^}]*jumpseller_id:\s*(\d+)[^}]*}/g;
const products = [];
let match;
while ((match = productRegex.exec(source)) !== null) {
  const jumpsellerId = parseInt(match[1]);
  products.push({ jumpsellerId, fullMatch: match[0] });
}

// ── 3. Para cada producto, obtener la primera variante ──────────────────────
const enrichedProducts = [];

for (const product of products) {
  const { jumpsellerId } = product;

  try {
    const response = await fetch(`https://api.jumpseller.com/v1/products/${jumpsellerId}.json?login=${process.env.JUMPSELLER_LOGIN}&authtoken=${process.env.JUMPSELLER_TOKEN}`);
    const data = await response.json();

    if (data.product && data.product.variants && data.product.variants.length > 0) {
      const firstVariant = data.product.variants[0];
      const variantId = firstVariant.id;
      enrichedProducts.push({ ...product, variantId });
      console.log(`Producto ${jumpsellerId}: variant_id ${variantId}`);
    } else {
      console.log(`Producto ${jumpsellerId}: no variants found`);
    }
  } catch (error) {
    console.error(`Error fetching product ${jumpsellerId}:`, error.message);
  }
}

// ── 4. Actualizar products.ts con jumpseller_variant_id ────────────────────
// Para cada producto enriquecido, reemplazar el bloque en el source
let updatedSource = source;

for (const product of enrichedProducts) {
  const { fullMatch, variantId } = product;
  // Agregar jumpseller_variant_id después de jumpseller_id
  const updatedMatch = fullMatch.replace(/(jumpseller_id:\s*\d+)/, `$1,\n  jumpseller_variant_id: ${variantId}`);
  updatedSource = updatedSource.replace(fullMatch, updatedMatch);
}

// ── 5. Escribir el archivo actualizado ──────────────────────────────────────
writeFileSync(productsPath, updatedSource, 'utf-8');
console.log('products.ts updated with jumpseller_variant_id');