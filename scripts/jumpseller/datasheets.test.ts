// scripts/jumpseller/datasheets.test.ts
// Fichas técnicas en PDF: filtro de URLs, consulta producto por producto (con fallas que
// conservan lo anterior), informe y el archivo generado del sitio.

import { describe, it, expect } from 'vitest';
import { buildDatasheets, datasheetUrl, DATASHEET_URL_RE, DEADLINE_REASON, renderDatasheetsReport, type FetchAttachments } from './datasheets';
import { JumpsellerApiError } from './client';
import type { SnapshotProduct } from '../../src/data/catalog/jumpseller.types';
import { productDatasheets } from '../../src/data/catalog/datasheets.generated';
import { jumpsellerSnapshot } from '../../src/data/catalog/jumpseller-snapshot.generated';

const CDN = 'https://images.jumpseller.com/store/elights-cl';
const pdf = (id: number, file: string) => `${CDN}/${id}/attachments/0211280a2037d7b3a05dca4cc7ee9f82/${file}?1662057911`;
const products = (...ids: number[]) => ids.map(id => ({ jumpseller_id: id, name: `Producto ${id}` }) as SnapshotProduct);
const reply = (...urls: string[]) => urls.map((customer_url, i) => ({ attachment: { id: 100 + i, customer_url } }));

describe('datasheetUrl', () => {
  it('acepta los PDF de la tienda (adjunto del producto o assets/) y los deja codificados como los manda el navegador', () => {
    expect(datasheetUrl(pdf(2252771, 'FT_PROYECTOR_ANTIVANDÁLICO 50W_eLIGHTS.cl.pdf'))).toBe(
      pdf(2252771, 'FT_PROYECTOR_ANTIVAND%C3%81LICO%2050W_eLIGHTS.cl.pdf'),
    );
    expect(datasheetUrl(pdf(2252771, 'FT_PROYECTOR_ANTIVAND%C3%81LICO_50W.pdf'))).toBe(pdf(2252771, 'FT_PROYECTOR_ANTIVAND%C3%81LICO_50W.pdf'));
    expect(datasheetUrl(`${CDN}/assets/FT_Panel_LED_60X30_cm_eLIGHTS.cl_1_1.pdf?1695305682`)).toBe(
      `${CDN}/assets/FT_Panel_LED_60X30_cm_eLIGHTS.cl_1_1.pdf?1695305682`,
    );
    expect(datasheetUrl(pdf(2252771, 'ficha.PDF'))).not.toBeNull();
    expect(datasheetUrl(pdf(2252771, 'ficha.pdf').replace(/\?\d+$/, ''))).not.toBeNull();
  });

  it('rechaza otros archivos, otras tiendas, otros hosts, http y URLs inválidas', () => {
    for (const bad of [
      pdf(2252771, 'curva.ies'),
      pdf(2252771, 'ficha.pdf.exe'),
      'https://images.jumpseller.com/store/otra-tienda/1/attachments/ab/ficha.pdf',
      'https://evil.example/store/elights-cl/1/attachments/ab/ficha.pdf',
      pdf(2252771, 'ficha.pdf').replace('https:', 'http:'),
      `${CDN}/2252771/attachments/zz/ficha.pdf`,
      `${CDN}/2252771/attachments/ab/ficha.pdf?v=1`,
      `${CDN}/2252771/attachments/ab/ficha.pdf#x`,
      'javascript:alert(1)//.pdf',
      'no es una url',
    ]) {
      expect(datasheetUrl(bad), bad).toBeNull();
    }
  });
});

describe('buildDatasheets', () => {
  it('ordena por id de adjunto, sin repetir, y omite los productos sin PDF', async () => {
    const fetch: FetchAttachments = async id =>
      id === 1
        ? [
            { attachment: { id: 9, customer_url: pdf(1, 'b-60w.pdf') } },
            { attachment: { id: 3, customer_url: pdf(1, 'a-40w.pdf') } },
            { attachment: { id: 12, customer_url: pdf(1, 'a-40w.pdf') } },
          ]
        : [];
    const r = await buildDatasheets(products(2, 1), null, fetch);
    expect(r.datasheets).toEqual({ 1: [pdf(1, 'a-40w.pdf'), pdf(1, 'b-60w.pdf')] });
    expect(r).toMatchObject({ checked: true, queried: 2, failed: [], rejected: [] });
  });

  it('una respuesta con otra forma o un error conserva las fichas anteriores; sin anteriores, el producto queda sin ficha', async () => {
    const fetch: FetchAttachments = async id => {
      if (id === 1) return { attachments: [] };
      if (id === 2) throw new JumpsellerApiError('Jumpseller respondió HTTP 500 (products/2/attachments)', 'http', 500);
      return reply(pdf(id, 'nueva.pdf'));
    };
    const previous = { 1: [pdf(1, 'vieja.pdf')], 3: [pdf(3, 'vieja.pdf')] };
    const r = await buildDatasheets(products(1, 2, 3), previous, fetch);
    expect(r.datasheets).toEqual({ 1: [pdf(1, 'vieja.pdf')], 3: [pdf(3, 'nueva.pdf')] });
    expect(r.failed).toEqual([
      { id: 1, reason: 'respuesta con otra forma; se mantienen las fichas anteriores' },
      { id: 2, reason: 'Jumpseller respondió HTTP 500 (products/2/attachments)' },
    ]);
  });

  it('con las credenciales rechazadas no sigue consultando', async () => {
    const asked: number[] = [];
    const fetch: FetchAttachments = async id => {
      asked.push(id);
      throw new JumpsellerApiError('Jumpseller rechazó las credenciales (HTTP 401)', 'auth', 401);
    };
    const r = await buildDatasheets(products(1, 2, 3), { 3: [pdf(3, 'vieja.pdf')] }, fetch);
    expect(asked).toEqual([1]);
    expect(r.failed.map(f => f.id)).toEqual([1, 2, 3]);
    expect(r.datasheets).toEqual({ 3: [pdf(3, 'vieja.pdf')] });
  });

  it('pasado el tiempo límite no consulta más y conserva lo anterior', async () => {
    let t = 0;
    const fetch: FetchAttachments = async id => { t += 1000; return reply(pdf(id, 'nueva.pdf')); };
    const r = await buildDatasheets(products(1, 2), { 2: [pdf(2, 'vieja.pdf')] }, fetch, { deadlineMs: 1000, now: () => t });
    expect(r.queried).toBe(1);
    expect(r.datasheets).toEqual({ 1: [pdf(1, 'nueva.pdf')], 2: [pdf(2, 'vieja.pdf')] });
    expect(r.failed).toEqual([{ id: 2, reason: `${DEADLINE_REASON}; se mantienen las fichas anteriores` }]);
  });

  it('si el cliente llega a su hora límite, no sigue consultando y conserva lo anterior', async () => {
    const asked: number[] = [];
    const fetch: FetchAttachments = async id => {
      asked.push(id);
      throw new JumpsellerApiError('Se acabó el tiempo de la sincronización (products/1/attachments)', 'deadline');
    };
    const r = await buildDatasheets(products(1, 2), { 2: [pdf(2, 'vieja.pdf')] }, fetch);
    expect(asked).toEqual([1]);
    expect(r.failed).toEqual([
      { id: 1, reason: DEADLINE_REASON },
      { id: 2, reason: `${DEADLINE_REASON}; se mantienen las fichas anteriores` },
    ]);
    expect(r.datasheets).toEqual({ 2: [pdf(2, 'vieja.pdf')] });
  });

  it('primero los productos sin ficha guardada; los demás, desde un punto que cambia cada día', async () => {
    const DAY = 86_400_000;
    const previous = Object.fromEntries([1, 2, 3].map(id => [id, [pdf(id, 'a.pdf')]]));
    const order = async (day: number) => {
      const asked: number[] = [];
      await buildDatasheets(products(1, 2, 3, 4), previous, async id => { asked.push(id); return []; }, { now: () => day * DAY });
      return asked;
    };
    expect(await order(0)).toEqual([4, 1, 2, 3]);
    expect(await order(1)).toEqual([4, 2, 3, 1]);
    expect(await order(2)).toEqual([4, 3, 1, 2]);
    // En tres días seguidos con tiempo para una sola consulta de las conocidas, se revisan todas
    const firstKnown = await Promise.all([0, 1, 2].map(async d => (await order(d))[1]));
    expect(firstKnown.sort()).toEqual([1, 2, 3]);
  });

  it('sin API (--from-dir) mantiene las fichas anteriores de los productos publicados', async () => {
    const r = await buildDatasheets(products(1), { 1: [pdf(1, 'a.pdf')], 9: [pdf(9, 'b.pdf')] }, null);
    expect(r).toMatchObject({ checked: false, queried: 0, datasheets: { 1: [pdf(1, 'a.pdf')] } });
  });
});

describe('informe', () => {
  it('avisa si bajan más del 15 % y lista las fichas nuevas, cambiadas y perdidas', async () => {
    const next = products(1, 2, 3, 4, 5, 6, 7);
    const previous = Object.fromEntries([1, 2, 3, 4, 5, 6].map(id => [id, [pdf(id, 'a.pdf')]]));
    const fetch: FetchAttachments = async id => (id <= 3 ? reply(pdf(id, 'a.pdf')) : id === 7 ? reply(pdf(id, 'nueva.pdf')) : []);
    const r = await buildDatasheets(next, previous, fetch);
    const text = renderDatasheetsReport(next, r, previous, new Map(next.map(p => [p.jumpseller_id, p.name])));
    expect(text).toContain('- Con ficha: 4 · sin ficha: 3 (antes, 6 con ficha)');
    expect(text).toContain('⚠️ Bajan las fichas de 6 a 4');
    expect(text).toContain('- Ficha nueva: 7 Producto 7');
    expect(text).toContain('- ⚠️ Pierden su ficha: 4 Producto 4; 5 Producto 5; 6 Producto 6');
    expect(text).toContain('3 productos sin ficha técnica');
  });
});

describe('archivo generado (datasheets.generated.ts)', () => {
  const published = new Set(jumpsellerSnapshot.map(p => p.jumpseller_id));

  it('solo productos publicados, cada uno con PDF de la tienda sin repetir', () => {
    for (const [id, urls] of Object.entries(productDatasheets)) {
      expect(published.has(Number(id)), id).toBe(true);
      expect(urls.length, id).toBeGreaterThan(0);
      expect(new Set(urls).size, id).toBe(urls.length);
      for (const u of urls) expect(u, id).toMatch(DATASHEET_URL_RE);
    }
  });
});
