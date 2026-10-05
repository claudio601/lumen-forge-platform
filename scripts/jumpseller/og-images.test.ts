// scripts/jumpseller/og-images.test.ts
// Revisión de la primera foto de cada producto (imagen para compartir), sin red: las
// respuestas del servidor de fotos se simulan con bytes reales de PNG, JPEG, WebP y GIF.

import { describe, expect, it, vi } from 'vitest';
import {
  buildOgImageFacts,
  createImageProbe,
  DEADLINE_REASON,
  PROBE_BYTES,
  renderOgImagesReport,
  sniffImage,
  type ImageFetch,
  type ImageProbe,
} from './og-images';
import { renderOgImagesFile } from './write';
import type { ProductImageFacts, SnapshotProduct } from '../../src/data/catalog/jumpseller.types';

const IMG = 'https://images.jumpseller.com/store/elights-cl';
const noSleep = async () => {};

// ── Bytes de prueba ──────────────────────────────────────────────────────────

function png(width: number, height: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, width);
  new DataView(b.buffer).setUint32(20, height);
  return b;
}

const seg = (marker: number, payload: number[]) => [0xff, marker, ((payload.length + 2) >> 8) & 0xff, (payload.length + 2) & 0xff, ...payload];

/** JPEG con un APP1 (EXIF) del largo pedido antes del SOF. */
function jpeg(width: number, height: number, opts: { sof?: number; exifBytes?: number; withSof?: boolean; before?: number[] } = {}): Uint8Array {
  const exif = Array.from({ length: opts.exifBytes ?? 10 }, (_, i) => i & 0x7f);
  const sof = seg(opts.sof ?? 0xc0, [8, height >> 8, height & 0xff, width >> 8, width & 0xff, 3, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1]);
  const parts = [0xff, 0xd8, ...seg(0xe0, [0x4a, 0x46, 0x49, 0x46, 0]), ...seg(0xe1, exif), ...seg(0xdb, Array(65).fill(1)), ...(opts.before ?? [])];
  if (opts.withSof !== false) parts.push(...sof);
  parts.push(0xff, 0xda, 0, 8, 1, 1, 0, 0, 0x3f, 0);
  return Uint8Array.from(parts);
}

const ascii = (s: string) => [...s].map(c => c.charCodeAt(0));
const webp = () => Uint8Array.from([...ascii('RIFF'), 0x24, 0, 0, 0, ...ascii('WEBPVP8 '), 0, 0, 0, 0]);
const gif = () => Uint8Array.from([...ascii('GIF89a'), 0x58, 0x02, 0x58, 0x02, 0, 0, 0]);

// ── Servidor de fotos simulado ───────────────────────────────────────────────

type Reply = { status: number; body?: Uint8Array; headers?: Record<string, string> } | Error;

function fakeImages(route: (url: string, n: number) => Reply) {
  const calls: { url: string; init: Parameters<ImageFetch>[1] }[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const fn: ImageFetch = async (url, init) => {
    calls.push({ url, init });
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      await new Promise(r => setTimeout(r, 1));
      const r = route(url, calls.filter(c => c.url === url).length);
      if (r instanceof Error) throw r;
      return {
        status: r.status,
        headers: { get: (n: string) => Object.entries(r.headers ?? {}).find(([k]) => k.toLowerCase() === n.toLowerCase())?.[1] ?? null },
        arrayBuffer: async () => (r.body ?? new Uint8Array()).slice().buffer,
      };
    } finally {
      inFlight--;
    }
  };
  return { fn, calls, maxInFlight: () => maxInFlight };
}

/** 206 con Content-Range, como responde images.jumpseller.com al Range. */
const partial = (body: Uint8Array, total: number): Reply => ({
  status: 206,
  body: body.subarray(0, PROBE_BYTES),
  headers: { 'Content-Range': `bytes 0-${Math.min(total, PROBE_BYTES) - 1}/${total}`, 'Content-Type': 'image/jpeg' },
});

const probeWith = (fetchImpl: ImageFetch, extra = {}) => createImageProbe({ fetchImpl, sleep: noSleep, random: () => 0, ...extra });

function product(id: number, urls: string[]): SnapshotProduct {
  return {
    jumpseller_id: id,
    name: `PRODUCTO ${id}`,
    permalink: `p-${id}`,
    sku: '',
    price: 1000,
    brand: null,
    featured: false,
    categories: ['paneles-led'],
    images: urls.map((url, i) => ({ id: id * 10 + i, url, position: i + 1 })),
    variants: [],
  };
}

describe('sniffImage: formato por los primeros bytes', () => {
  it('reconoce PNG, JPEG, WebP, GIF y "other"', () => {
    expect(sniffImage(png(600, 600)).format).toBe('png');
    expect(sniffImage(jpeg(600, 600)).format).toBe('jpeg');
    expect(sniffImage(webp())).toEqual({ format: 'webp' });
    expect(sniffImage(gif())).toEqual({ format: 'gif' });
    expect(sniffImage(Uint8Array.from(ascii('<svg xmlns=')))).toEqual({ format: 'other' });
    expect(sniffImage(new Uint8Array())).toEqual({ format: 'other' });
  });

  it('PNG: medidas desde IHDR', () => {
    expect(sniffImage(png(1010, 1024))).toEqual({ format: 'png', width: 1010, height: 1024 });
  });

  it('JPEG: medidas desde SOF0 y desde SOF2 (progresivo) detrás de un EXIF grande', () => {
    expect(sniffImage(jpeg(1200, 630))).toEqual({ format: 'jpeg', width: 1200, height: 630 });
    expect(sniffImage(jpeg(2113, 1500, { sof: 0xc2, exifBytes: 30_000 }))).toEqual({ format: 'jpeg', width: 2113, height: 1500 });
  });

  it('JPEG: los segmentos C4 (tablas Huffman), C8 y CC no son SOF aunque estén en ese rango', () => {
    // Si se leyeran como SOF, darían 772 × 258 (bytes 1–4 de su contenido)
    const trap = [0x08, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09];
    const before = [...seg(0xc4, trap), ...seg(0xc8, trap), ...seg(0xcc, trap)];
    expect(sniffImage(jpeg(800, 600, { before }))).toEqual({ format: 'jpeg', width: 800, height: 600 });
    expect(sniffImage(jpeg(800, 600, { before, sof: 0xc2 }))).toEqual({ format: 'jpeg', width: 800, height: 600 });
  });

  it('JPEG sin SOF dentro de lo recibido: formato sin medidas', () => {
    expect(sniffImage(jpeg(600, 600, { withSof: false }))).toEqual({ format: 'jpeg' });
    // el SOF queda después de los 64 KB pedidos
    const far = jpeg(600, 600, { exifBytes: 65_500 });
    expect(sniffImage(far.subarray(0, PROBE_BYTES))).toEqual({ format: 'jpeg' });
  });

  it('PNG servido como .jpg con Content-Type image/jpeg: es PNG', async () => {
    const api = fakeImages(() => partial(png(500, 500), 105_225));
    const r = await probeWith(api.fn)(`${IMG}/1/foto.jpg?1`);
    expect(r).toEqual({ ok: true, facts: { format: 'png', bytes: 105_225, width: 500, height: 500 } });
  });
});

describe('createImageProbe: el pedido', () => {
  it('GET con Range de 64 KB y el User-Agent del sitio; sin Authorization', async () => {
    const api = fakeImages(() => partial(png(600, 600), 98_765));
    await probeWith(api.fn)(`${IMG}/1/a.png?1`);
    expect(api.calls).toHaveLength(1);
    const { init } = api.calls[0];
    expect(init.method).toBe('GET');
    expect(init.headers.Range).toBe('bytes=0-65535');
    expect(init.headers['User-Agent']).toMatch(/^eLIGHTS-catalog-sync/);
    expect(Object.keys(init.headers).map(k => k.toLowerCase())).not.toContain('authorization');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.redirect).toBe('manual');
  });

  it('pide la URL codificada con new URL: "Á" → %C3%81 y el %2C se mantiene (nunca %252C)', async () => {
    const api = fakeImages(() => partial(png(600, 600), 98_765));
    const probe = probeWith(api.fn);
    await probe(`${IMG}/4123096/FOCO-MONOFÁSICO.png?1`);
    await probe(`${IMG}/35794580/media/x.png/v1/fit/w_500%2Ch_500%2Cq_90/file.png?1781479280`);
    expect(api.calls[0].url).toBe(`${IMG}/4123096/FOCO-MONOF%C3%81SICO.png?1`);
    expect(api.calls[1].url).toBe(`${IMG}/35794580/media/x.png/v1/fit/w_500%2Ch_500%2Cq_90/file.png?1781479280`);
    expect(api.calls[1].url).not.toContain('%252C');
  });

  it('solo pide a https://images.jumpseller.com: otro servidor o http nunca se piden', async () => {
    const api = fakeImages(() => partial(png(600, 600), 98_765));
    const probe = probeWith(api.fn);
    for (const url of ['http://images.jumpseller.com/store/a.png', 'https://otro.example.com/a.png', 'https://cdnx.jumpseller.com/elights-cl/image/1/resize/1200/1200']) {
      expect(await probe(url)).toEqual({ ok: false, reason: 'servidor no permitido' });
    }
    expect(api.calls).toHaveLength(0);
  });
});

describe('createImageProbe: las respuestas', () => {
  it('206: el peso sale del total de Content-Range', async () => {
    const api = fakeImages(() => partial(jpeg(600, 600), 154_083));
    expect(await probeWith(api.fn)(`${IMG}/1/a.jpg?1`)).toEqual({ ok: true, facts: { format: 'jpeg', bytes: 154_083, width: 600, height: 600 } });
  });

  it('206 de un archivo chico (bytes 0-8173/8174)', async () => {
    const body = jpeg(600, 600);
    const api = fakeImages(() => ({ status: 206, body, headers: { 'Content-Range': 'bytes 0-8173/8174' } }));
    expect(await probeWith(api.fn)(`${IMG}/1/a.jpg?1`)).toMatchObject({ ok: true, facts: { bytes: 8174 } });
  });

  it('200 (servidor que ignora Range): el peso sale de Content-Length o del cuerpo', async () => {
    const body = png(600, 600);
    const withLength = fakeImages(() => ({ status: 200, body, headers: { 'Content-Length': '98765' } }));
    expect(await probeWith(withLength.fn)(`${IMG}/1/a.png?1`)).toMatchObject({ ok: true, facts: { bytes: 98_765 } });
    const without = fakeImages(() => ({ status: 200, body }));
    expect(await probeWith(without.fn)(`${IMG}/1/a.png?1`)).toMatchObject({ ok: true, facts: { bytes: body.length } });
  });

  it('sin un tamaño que se pueda leer: falla', async () => {
    const api = fakeImages(() => ({ status: 206, body: png(600, 600), headers: { 'Content-Range': 'bytes */98765' } }));
    expect(await probeWith(api.fn)(`${IMG}/1/a.png?1`)).toEqual({ ok: false, reason: 'sin tamaño' });
    const empty = fakeImages(() => ({ status: 200, body: new Uint8Array() }));
    expect(await probeWith(empty.fn)(`${IMG}/1/a.png?1`)).toEqual({ ok: false, reason: 'sin tamaño' });
  });
});

describe('createImageProbe: reintentos', () => {
  const abort = () => Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });

  for (const [label, first] of [
    ['503', { status: 503 }],
    ['429', { status: 429 }],
    ['un error de red', new Error('ECONNRESET')],
    ['un timeout (AbortError)', abort()],
  ] as [string, Reply][]) {
    it(`reintenta ${label} y se recupera`, async () => {
      const api = fakeImages((_, n) => (n === 1 ? first : partial(png(600, 600), 98_765)));
      const sleep = vi.fn(async (_ms: number) => {});
      const r = await createImageProbe({ fetchImpl: api.fn, sleep, random: () => 0 })(`${IMG}/1/a.png?1`);
      expect(r.ok).toBe(true);
      expect(api.calls).toHaveLength(2);
      expect(sleep).toHaveBeenCalledWith(500);
    });
  }

  it('falla después de 2 reintentos, con espera creciente', async () => {
    const api = fakeImages(() => ({ status: 503 }));
    const sleep = vi.fn(async (_ms: number) => {});
    const r = await createImageProbe({ fetchImpl: api.fn, sleep, random: () => 0.5 })(`${IMG}/1/a.png?1`);
    expect(r).toEqual({ ok: false, reason: 'HTTP 503' });
    expect(api.calls).toHaveLength(3);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([625, 1125]);
    const net = fakeImages(() => abort());
    expect(await probeWith(net.fn)(`${IMG}/1/a.png?1`)).toEqual({ ok: false, reason: 'sin respuesta' });
    expect(net.calls).toHaveLength(3);
  });

  it('una redirección no se sigue (podría llevar a otro servidor): falla sin reintentar', async () => {
    for (const status of [301, 302, 307]) {
      const api = fakeImages(() => ({ status, headers: { Location: 'http://otro.example/x.png' } }));
      expect(await probeWith(api.fn)(`${IMG}/1/a.png?1`)).toEqual({ ok: false, reason: `HTTP ${status}` });
      expect(api.calls).toHaveLength(1);
    }
  });

  it('no reintenta 403 ni 404', async () => {
    for (const status of [403, 404]) {
      const api = fakeImages(() => ({ status }));
      expect(await probeWith(api.fn)(`${IMG}/1/a.png?1`)).toEqual({ ok: false, reason: `HTTP ${status}` });
      expect(api.calls).toHaveLength(1);
    }
  });

  it('el timeout corta también la lectura del cuerpo y se reintenta', async () => {
    let n = 0;
    const fn: ImageFetch = async (_url, init) => {
      n++;
      return {
        status: 206,
        headers: { get: () => 'bytes 0-32/98765' },
        arrayBuffer: () =>
          n === 1
            ? new Promise<ArrayBuffer>((_, reject) => init.signal.addEventListener('abort', () => reject(abort())))
            : Promise.resolve(png(600, 600).slice().buffer),
      };
    };
    const r = await createImageProbe({ fetchImpl: fn, sleep: noSleep, random: () => 0, timeoutMs: 5 })(`${IMG}/1/a.png?1`);
    expect(r).toMatchObject({ ok: true, facts: { bytes: 98_765 } });
    expect(n).toBe(2);
  });
});

describe('buildOgImageFacts', () => {
  const okProbe = () => {
    const urls: string[] = [];
    const probe: ImageProbe = async url => {
      urls.push(url);
      return { ok: true, facts: { format: 'png', bytes: 98_765, width: 600, height: 600 } };
    };
    return { probe, urls };
  };
  const facts = (url: string): ProductImageFacts => ({ url, format: 'jpeg', bytes: 8174, width: 600, height: 600 });

  it('misma URL que la vez anterior: 0 pedidos; foto cambiada: 1 pedido', async () => {
    const next = [product(1, [`${IMG}/1/a.png?1`, `${IMG}/1/b.png?1`]), product(2, [`${IMG}/2/a.png?2`])];
    const { probe, urls } = okProbe();
    const r = await buildOgImageFacts(next, { 1: facts(`${IMG}/1/a.png?1`), 2: facts(`${IMG}/2/a.png?1`) }, probe);
    expect(urls).toEqual([`${IMG}/2/a.png?2`]); // solo la primera foto, y solo la que cambió
    expect(r).toMatchObject({ probed: 1, reused: 1, failed: [] });
    expect(r.facts[1]).toEqual(facts(`${IMG}/1/a.png?1`));
    expect(r.facts[2]).toEqual({ url: `${IMG}/2/a.png?2`, format: 'png', bytes: 98_765, width: 600, height: 600 });
  });

  it('una foto que falla no deja dato y queda en failed (la ficha usa la imagen de la marca)', async () => {
    const probe: ImageProbe = async url => (url.includes('/2/') ? { ok: false, reason: 'HTTP 404' } : { ok: true, facts: { format: 'png', bytes: 5 } });
    const r = await buildOgImageFacts([product(1, [`${IMG}/1/a.png`]), product(2, [`${IMG}/2/a.png`])], null, probe);
    expect(Object.keys(r.facts)).toEqual(['1']);
    expect(r.failed).toEqual([{ id: 2, reason: 'HTTP 404' }]);
  });

  it('--recheck-images pide todas y, si una falla, mantiene el dato anterior', async () => {
    const prev = { 1: facts(`${IMG}/1/a.png`), 2: facts(`${IMG}/2/a.png`) };
    const probe: ImageProbe = async url => (url.includes('/2/') ? { ok: false, reason: 'HTTP 503' } : { ok: true, facts: { format: 'png', bytes: 5 } });
    const r = await buildOgImageFacts([product(1, [`${IMG}/1/a.png`]), product(2, [`${IMG}/2/a.png`])], prev, probe, { recheck: true });
    expect(r).toMatchObject({ probed: 2, reused: 0 });
    expect(r.facts[1]).toEqual({ url: `${IMG}/1/a.png`, format: 'png', bytes: 5 });
    expect(r.facts[2]).toEqual(prev[2]);
    expect(r.failed).toEqual([{ id: 2, reason: 'HTTP 503; se mantiene el dato anterior' }]);
  });

  it('productos que ya no se publican o sin fotos no tienen dato', async () => {
    const { probe, urls } = okProbe();
    const r = await buildOgImageFacts([product(1, []), product(2, [`${IMG}/2/a.png`])], { 9: facts(`${IMG}/9/a.png`) }, probe);
    expect(Object.keys(r.facts)).toEqual(['2']);
    expect(urls).toEqual([`${IMG}/2/a.png`]);
  });

  it('a lo más 4 pedidos a la vez', async () => {
    const api = fakeImages(() => partial(png(600, 600), 98_765));
    const next = Array.from({ length: 20 }, (_, i) => product(i + 1, [`${IMG}/${i + 1}/a.png`]));
    const r = await buildOgImageFacts(next, null, probeWith(api.fn));
    expect(api.calls).toHaveLength(20);
    expect(Object.keys(r.facts)).toHaveLength(20);
    expect(api.maxInFlight()).toBe(4);
  });

  it('pasado el plazo no pide más fotos y las informa', async () => {
    let t = 0;
    const probe: ImageProbe = async () => {
      t += 100;
      return { ok: true, facts: { format: 'png', bytes: 5 } };
    };
    const next = Array.from({ length: 5 }, (_, i) => product(i + 1, [`${IMG}/${i + 1}/a.png`]));
    const r = await buildOgImageFacts(next, null, probe, { concurrency: 1, deadlineMs: 250, now: () => t });
    expect(r.probed).toBe(3);
    expect(Object.keys(r.facts)).toEqual(['1', '2', '3']);
    expect(r.failed).toEqual([4, 5].map(id => ({ id, reason: DEADLINE_REASON })));
  });

  it('salida ordenada: el archivo generado es idéntico byte a byte con otro orden de entrada', async () => {
    const next = [3, 1, 2].map(id => product(id, [`${IMG}/${id}/a.png`]));
    const a = await buildOgImageFacts(next, null, okProbe().probe);
    const b = await buildOgImageFacts([...next].reverse(), null, okProbe().probe, { concurrency: 1 });
    expect(Object.keys(a.facts)).toEqual(['1', '2', '3']);
    expect(renderOgImagesFile(a.facts, 'abc')).toBe(renderOgImagesFile(b.facts, 'abc'));
    // una línea por producto, sin claves prohibidas
    const file = renderOgImagesFile(a.facts, 'abc');
    expect(file).toContain(`  "1": {"url":"${IMG}/1/a.png","format":"png","bytes":98765,"width":600,"height":600},`);
    expect(file).not.toMatch(/stock|description|cost_per_item/);
  });
});

describe('renderOgImagesReport', () => {
  it('cuenta fotos propias y de la marca, y lista las que hay que reemplazar en Jumpseller', async () => {
    const next = [product(1, [`${IMG}/1/a.png`]), product(2, [`${IMG}/2/b.png`]), product(3, [`${IMG}/3/c.webp`]), product(4, [`${IMG}/4/d.png`])];
    const probe: ImageProbe = async url =>
      url.endsWith('b.png')
        ? { ok: true, facts: { format: 'png', bytes: 601_579 } }
        : url.endsWith('c.webp')
          ? { ok: true, facts: { format: 'webp', bytes: 120_000 } }
          : url.endsWith('d.png')
            ? { ok: false, reason: 'HTTP 404' }
            : { ok: true, facts: { format: 'png', bytes: 1000 } };
    const r = await buildOgImageFacts(next, null, probe);
    const md = renderOgImagesReport(next, r, new Map(next.map(p => [p.jumpseller_id, p.name])));
    expect(md).toContain('## Imagen para compartir (WhatsApp, Facebook)');
    expect(md).toContain('- Foto propia: 1 · imagen de la marca: 3 (1 de 600 KB o más, 1 en otro formato, 1 sin revisar)');
    expect(md).toContain('- Revisadas hoy: 4 · reutilizadas: 0');
    expect(md).toContain('- ⚠️ No se pudieron revisar: 4 PRODUCTO 4 (HTTP 404)');
    expect(md).toContain('- 2 PRODUCTO 2 (PNG, 602 KB)');
    expect(md).toContain('- 3 PRODUCTO 3 (WebP, 120 KB)');
    expect(md).toContain('PNG o JPG de menos de 600 KB');
  });
});
