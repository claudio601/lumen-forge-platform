// scripts/warm-images.ts
// "Precalienta" el CDN de imágenes de Jumpseller: la primera petición de cada tamaño
// tarda 2–6 s mientras el CDN la genera; después queda en caché. Pide los tamaños que
// usa el sitio (tarjeta 400/800, ficha 800/1200, miniatura 200) para que ningún
// cliente tenga que esperar. Solo hace GET públicos; no usa credenciales.
//
//   npm run warm:images              # todas las fotos
//   npm run warm:images -- --first   # solo la primera foto de cada producto

import { products } from '../src/data/catalog/index';
import { jsImage, type ImageMode } from '../src/lib/jumpsellerImage';

const CONCURRENCY = 6;
const firstOnly = process.argv.includes('--first');

const jobs: string[] = [];
for (const p of products) {
  const refs = firstOnly ? (p.imageRefs ?? []).slice(0, 1) : (p.imageRefs ?? []);
  refs.forEach((ref, i) => {
    const sizes: [number, ImageMode][] = i === 0 ? [[400, 'resize'], [800, 'resize'], [1200, 'resize'], [200, 'thumb']] : [[800, 'resize'], [1200, 'resize'], [200, 'thumb']];
    for (const [w, mode] of sizes) jobs.push(jsImage(ref, w, mode));
  });
}

async function main() {
  let ok = 0;
  let failed = 0;
  let next = 0;
  const started = Date.now();
  async function worker() {
    while (next < jobs.length) {
      const url = jobs[next++];
      try {
        const res = await fetch(url);
        await res.arrayBuffer();
        if (res.ok) ok++;
        else failed++;
      } catch {
        failed++;
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`CDN: ${ok} tamaños listos, ${failed} con error, en ${Math.round((Date.now() - started) / 1000)} s.`);
  process.exit(failed > jobs.length * 0.1 ? 1 : 0);
}

main();
