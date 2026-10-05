// Datos de la primera foto de cada producto (imagen para compartir), sincronizados desde
// Jumpseller: cada dato corresponde a la primera foto actual de un producto publicado
// (si no, la ficha usa la imagen de la marca) y tiene la forma que espera la regla.
import { describe, expect, it } from 'vitest';
import { productImageFacts } from './og-images.generated';
import { jumpsellerSnapshot } from './jumpseller-snapshot.generated';

const entries = Object.entries(productImageFacts);
const firstImage = new Map(jumpsellerSnapshot.map(p => [String(p.jumpseller_id), p.images[0]?.url]));
const isPositiveInt = (n: unknown) => typeof n === 'number' && Number.isInteger(n) && n > 0;

// En la PR diaria del robot, cuántas fotos se pudieron revisar ese día solo se informa.
// CATALOG_SYNC_JOB: la tarea de sincronización (corre desde main, antes de abrir la PR).
// En la PR, GITHUB_REF_NAME es 'N/merge' y la rama viene en GITHUB_HEAD_REF.
const isSyncBot =
  process.env.CATALOG_SYNC_JOB === '1' ||
  [process.env.GITHUB_HEAD_REF, process.env.GITHUB_REF_NAME].includes('bot/jumpseller-sync');

describe('fotos para compartir (archivo generado)', () => {
  it('cada dato es de un producto publicado y de su primera foto actual', () => {
    expect(entries.filter(([id]) => !firstImage.has(id)).map(([id]) => id)).toEqual([]);
    expect(entries.filter(([id, f]) => f.url !== firstImage.get(id)).map(([id]) => id)).toEqual([]);
  });

  it('peso entero positivo, formato conocido y medidas enteras positivas cuando están', () => {
    for (const [id, f] of entries) {
      expect(isPositiveInt(f.bytes), id).toBe(true);
      expect(['png', 'jpeg', 'webp', 'gif', 'other'], id).toContain(f.format);
      expect(f.width === undefined, id).toBe(f.height === undefined);
      if (f.width !== undefined) expect(isPositiveInt(f.width) && isPositiveInt(f.height), id).toBe(true);
    }
  });

  it.skipIf(isSyncBot)('casi todos los productos publicados tienen su dato (al menos 90%)', () => {
    expect(entries.length).toBeGreaterThanOrEqual(jumpsellerSnapshot.length * 0.9);
  });
});
