// scripts/content/files.ts
// Lectura de los archivos de contenido SEO (src/data/catalog/content/<jumpseller_id>.json).

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ProductContent } from '../../src/data/catalog/types';

export const CONTENT_DIR = 'src/data/catalog/content';

export function contentIds(root: string): number[] {
  const dir = join(root, CONTENT_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => /^\d+\.json$/.test(f))
    .map(f => Number(f.replace('.json', '')))
    .sort((a, b) => a - b);
}

export function readContent(root: string, id: number): ProductContent | undefined {
  const file = join(root, CONTENT_DIR, `${id}.json`);
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as ProductContent) : undefined;
}
