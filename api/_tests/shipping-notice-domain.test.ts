// api/_tests/shipping-notice-domain.test.ts
// Guarda del dominio del aviso de despacho (spec Nivel 2, §3 paso 9 y §8): mientras SITE_URL no sea
// https://elights.cl, «Enviar al cliente» no sale (los enlaces a las fichas irían a otro dominio) y la
// vista previa sí. Va en un archivo aparte porque la plantilla fija sus orígenes permitidos al
// cargarse. Upstash, Pipedrive y el relay simulados; datos ficticios. Vive en api/_tests/ para que
// Vercel no lo despliegue.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@vercel/functions', () => ({ waitUntil: vi.fn() }));
vi.mock('../_lib/site.js', async (importOriginal) => ({ ...(await importOriginal<typeof import('../_lib/site.js')>()), SITE_URL: 'https://nuevo.elights.cl' }));
vi.mock('../_lib/catalog/product-links.generated.js', async () => ({ SNAPSHOT_HASH: 'prueba', productLinks: (await import('./shippingFixture')).PRODUCT_LINKS }));
vi.mock('../_lib/catalog/price-index.generated.js', async () => ({ SNAPSHOT_HASH: 'prueba', priceIndex: (await import('./shippingFixture')).PRICE_INDEX }));

import { SITE_URL } from '../_lib/site.js';
import { processShippingNotice, PUBLIC_SITE_URL } from '../_lib/shipping/notice.js';
import { DEAL_ID, K, nextUpdateTime, OPT, setupNoticeWorld, teardownNoticeWorld, type NoticeWorld } from './shippingFixture';

let w: NoticeWorld;

beforeEach(() => {
  w = setupNoticeWorld();
});

afterEach(() => {
  teardownNoticeWorld();
});

function choose(option: 'preview' | 'send') {
  w.deal()[K.trigger] = OPT[option];
  return processShippingNotice({ dealId: DEAL_ID, triggerKey: K.trigger, triggerOptionId: OPT[option], startedAt: Date.now(), eventUpdateTime: nextUpdateTime() });
}

describe('SITE_URL todavía no es elights.cl', () => {
  it('la prueba corre con otro dominio', () => {
    expect(SITE_URL).toBe('https://nuevo.elights.cl');
    expect(PUBLIC_SITE_URL).toBe('https://elights.cl');
  });

  it('«Enviar al cliente» no sale: nota del cambio de dominio y el disparador vacío', async () => {
    expect(await choose('send')).toBe('dominio');
    expect(w.relay.calls).toBe(0);
    expect(w.notes()).toEqual([
      'Aviso de despacho NO enviado: el envío al cliente queda disponible después del cambio de dominio (los enlaces a las fichas tienen que ir a elights.cl).\nMientras tanto funciona «Vista previa».',
    ]);
    expect(w.deal()[K.trigger]).toBeNull();
    expect(w.deal()[K.sentLog]).toBeNull();
  });

  it('la guarda va antes que los datos: con un campo obligatorio vacío, la nota es la del dominio', async () => {
    w.deal()[K.carrier] = null;
    expect(await choose('send')).toBe('dominio');
  });

  it('la vista previa sí sale', async () => {
    expect(await choose('preview')).toBe('vista_previa_enviada');
    expect(w.relay.sent).toHaveLength(1);
    expect(w.relay.sent[0].action).toBe('preview');
  });
});
