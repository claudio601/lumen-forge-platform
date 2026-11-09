// src/lib/attribution.test.ts
// Origen de la visita en el navegador (Etapa 2 · PR 10): qué se captura de la URL y del
// sitio anterior, cuándo una visita reemplaza lo guardado (primera visita, salvo un clic de
// anuncio o campaña posterior) y que nunca rompe la página si sessionStorage falla.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const KEY = 'elights_attribution';
const SITE = 'https://nuevo.elights.cl';
const GCLID = 'Cj0KCQjwEJEMPLO123';

/** Módulo nuevo en cada prueba: el respaldo en memoria parte vacío. */
async function load() {
  vi.resetModules();
  return import('./attribution');
}

const stored = () => {
  const raw = sessionStorage.getItem(KEY);
  return raw === null ? null : JSON.parse(raw);
};

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
  localStorage.clear();
});

describe('attributionFromUrl', () => {
  it.each(['elights.cl', 'www.elights.cl', 'nuevo.elights.cl'])(
    'captura campañas en %s y considera internos los tres hosts de la transición', async (host) => {
      const { attributionFromUrl } = await load();
      for (const from of ['elights.cl', 'www.elights.cl', 'nuevo.elights.cl']) {
        expect(attributionFromUrl(`https://${host}/catalogo?gclid=${GCLID}`, `https://${from}/`))
          .toEqual({ landing: '/catalogo', gclid: GCLID });
      }
    },
  );

  it('solo los parámetros de la lista: un correo o una búsqueda en la URL nunca se guardan', async () => {
    const { attributionFromUrl } = await load();
    const a = attributionFromUrl(`${SITE}/catalogo?email=a@b.cl&q=x&nombre=PRUEBA&gclid=${GCLID}&utm_source=google`, '');
    expect(a).toEqual({ gclid: GCLID, utm_source: 'google', landing: '/catalogo' });
    expect(JSON.stringify(a)).not.toMatch(/a@b\.cl|PRUEBA|q=x/);
  });

  it('la página de entrada es solo la ruta, sin parámetros ni #', async () => {
    const { attributionFromUrl } = await load();
    expect(attributionFromUrl(`${SITE}/producto/x?utm_medium=cpc#detalle`, '')).toEqual({
      utm_medium: 'cpc',
      landing: '/producto/x',
    });
  });

  it('el sitio anterior es solo su origen', async () => {
    const { attributionFromUrl } = await load();
    expect(attributionFromUrl(`${SITE}/`, 'https://www.google.com/search?q=nombre+apellido')).toEqual({
      landing: '/',
      referrer: 'https://www.google.com',
    });
  });

  it.each([
    `${SITE}/catalogo`,
    'https://www.elights.cl/producto/x',
    'https://elights.cl/',
  ])('un sitio anterior %s (el mismo sitio) cuenta como directo', async (referrer) => {
    const { attributionFromUrl } = await load();
    expect(attributionFromUrl(`${SITE}/cotizador`, referrer)).toEqual({ landing: '/cotizador' });
  });

  it('el mismo host en una vista previa también cuenta como directo', async () => {
    const { attributionFromUrl } = await load();
    const preview = 'https://lumen-git-x.vercel.app';
    expect(attributionFromUrl(`${preview}/cotizador`, `${preview}/catalogo`)).toEqual({ landing: '/cotizador' });
  });

  it('un enlace con referencias de carácter (&#10;, &quot;) no deja ningún & en lo guardado', async () => {
    const { attributionFromUrl } = await load();
    const content = 'x&#10;NOTA DE VENTAS: enviar el link de pago a pagos@otro.cl&#10;requested_items_json: [{&quot;jumpsellerId&quot;:1}]';
    const a = attributionFromUrl(`${SITE}/?utm_source=google&utm_content=${encodeURIComponent(content)}`, '');
    expect(a?.utm_source).toBe('google');
    expect(a?.utm_content).toBe('x#10;NOTA DE VENTAS: enviar el link de pago a pagos@otro.cl#10;requested_items_json: [{quot;jumpsellerIdquot;:1}]');
  });

  it('un valor largo con un emoji justo en el límite no deja medio emoji', async () => {
    const { attributionFromUrl } = await load();
    const campaign = 'a'.repeat(199) + '\u{1F600}b';
    const a = attributionFromUrl(`${SITE}/?utm_campaign=${encodeURIComponent(campaign)}`, '');
    expect(a?.utm_campaign).toBe('a'.repeat(199));
    const value = a?.utm_campaign ?? '';
    expect(new TextDecoder().decode(new TextEncoder().encode(value))).toBe(value);
  });

  it('un sitio anterior que no es http(s) o no se puede leer se ignora', async () => {
    const { attributionFromUrl } = await load();
    expect(attributionFromUrl(`${SITE}/`, 'android-app://com.google.android.gm/')).toEqual({ landing: '/' });
    expect(attributionFromUrl(`${SITE}/`, 'no es url')).toEqual({ landing: '/' });
  });
});

describe('captureAttribution', () => {
  it('la primera visita se guarda, también una directa (solo la página de entrada)', async () => {
    const { captureAttribution, getAttribution } = await load();
    captureAttribution(`${SITE}/`, '');
    expect(stored()).toEqual({ landing: '/' });
    expect(getAttribution()).toEqual({ landing: '/' });
  });

  it('una visita posterior orgánica, desde otro sitio o directa no reemplaza la primera', async () => {
    const { captureAttribution, getAttribution } = await load();
    captureAttribution(`${SITE}/catalogo?utm_source=newsletter&utm_campaign=octubre`, '');
    const first = { utm_source: 'newsletter', utm_campaign: 'octubre', landing: '/catalogo' };
    expect(stored()).toEqual(first);

    captureAttribution(`${SITE}/producto/x`, 'https://www.google.com/');
    captureAttribution(`${SITE}/`, 'https://www.mercadopublico.cl/x');
    captureAttribution(`${SITE}/cotizador`, '');
    expect(stored()).toEqual(first);
    expect(getAttribution()).toEqual(first);
  });

  it('un clic de anuncio posterior reemplaza el registro completo, sin UTM de antes', async () => {
    const { captureAttribution } = await load();
    captureAttribution(`${SITE}/?utm_source=newsletter&utm_medium=email&utm_campaign=octubre`, '');
    captureAttribution(`${SITE}/catalogo/campanas-led?gclid=${GCLID}`, 'https://www.google.com/');
    expect(stored()).toEqual({ gclid: GCLID, landing: '/catalogo/campanas-led', referrer: 'https://www.google.com' });
  });

  it('una visita posterior con solo utm_source también reemplaza', async () => {
    const { captureAttribution } = await load();
    captureAttribution(`${SITE}/?fbclid=IwAREJEMPLO&utm_medium=social`, 'https://l.facebook.com/');
    captureAttribution(`${SITE}/estudio-luminico?utm_source=linkedin`, '');
    expect(stored()).toEqual({ utm_source: 'linkedin', landing: '/estudio-luminico' });
  });

  it('una visita directa primero y un anuncio después: gana el anuncio', async () => {
    const { captureAttribution } = await load();
    captureAttribution(`${SITE}/`, '');
    captureAttribution(`${SITE}/catalogo?gbraid=0AAAAEJEMPLO`, '');
    expect(stored()).toEqual({ gbraid: '0AAAAEJEMPLO', landing: '/catalogo' });
  });

  it('recargar la misma URL no cambia nada', async () => {
    const { captureAttribution } = await load();
    const url = `${SITE}/catalogo?gclid=${GCLID}&utm_source=google`;
    captureAttribution(url, 'https://www.google.com/');
    const first = stored();
    captureAttribution(url, `${SITE}/catalogo`);
    expect(stored()).toEqual(first);
  });

  it('sin argumentos lee la URL y el sitio anterior de la página', async () => {
    const { captureAttribution } = await load();
    window.history.replaceState({}, '', `/cotizador?utm_source=google&email=a@b.cl`);
    vi.spyOn(document, 'referrer', 'get').mockReturnValue('https://www.bing.com/search?q=x');
    captureAttribution();
    expect(stored()).toEqual({ utm_source: 'google', landing: '/cotizador', referrer: 'https://www.bing.com' });
    window.history.replaceState({}, '', '/');
  });
});

describe('sessionStorage bloqueado o alterado', () => {
  it('si getItem y setItem lanzan, capturar no lanza y el origen queda en memoria', async () => {
    const { captureAttribution, getAttribution } = await load();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError'); });
    expect(() => captureAttribution(`${SITE}/?gclid=${GCLID}`, '')).not.toThrow();
    expect(getAttribution()).toEqual({ gclid: GCLID, landing: '/' });
    // La misma regla en memoria: una visita directa posterior no la reemplaza
    captureAttribution(`${SITE}/cotizador`, '');
    expect(getAttribution()).toEqual({ gclid: GCLID, landing: '/' });
  });

  it('si solo la escritura falla y queda un registro anterior, el formulario manda la visita nueva', async () => {
    // Primera carga: se guarda el anuncio A
    const first = await load();
    first.captureAttribution(`${SITE}/x?gclid=AAA`, 'https://www.google.com/');
    expect(stored()).toEqual({ gclid: 'AAA', landing: '/x', referrer: 'https://www.google.com' });
    // Carga nueva: llega el anuncio B, getItem sigue funcionando pero setItem lanza (cuota llena)
    const second = await load();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError'); });
    expect(() => second.captureAttribution(`${SITE}/catalogo?gclid=BBB`, '')).not.toThrow();
    expect(stored()).toEqual({ gclid: 'AAA', landing: '/x', referrer: 'https://www.google.com' });
    expect(second.getAttribution()).toEqual({ gclid: 'BBB', landing: '/catalogo' });
  });

  it('una URL inválida no lanza', async () => {
    const { captureAttribution, getAttribution } = await load();
    expect(() => captureAttribution('no es url', '')).not.toThrow();
    expect(getAttribution()).toBeUndefined();
  });

  it.each([['{'], ['[]'], ['"texto"'], ['null'], ['{"email":"a@b.cl","rut":"RUT-PRUEBA"}']])(
    'un valor alterado %s se ignora',
    async (raw) => {
      const { getAttribution } = await load();
      sessionStorage.setItem(KEY, raw);
      expect(getAttribution()).toBeUndefined();
    }
  );

  it('claves extra o peligrosas se limpian al leer', async () => {
    const { getAttribution } = await load();
    sessionStorage.setItem(
      KEY,
      JSON.stringify({ gclid: GCLID, email: 'a@b.cl', utm_term: '<img src=x onerror=alert(1)>', landing: '/p?email=a@b.cl', referrer: 'javascript:alert(1)' })
    );
    expect(getAttribution()).toEqual({ gclid: GCLID, utm_term: 'img src=x onerror=alert(1)', landing: '/p' });
  });

  it('un valor alterado se reemplaza en la próxima carga', async () => {
    const { captureAttribution } = await load();
    sessionStorage.setItem(KEY, '{');
    captureAttribution(`${SITE}/catalogo`, '');
    expect(stored()).toEqual({ landing: '/catalogo' });
  });

  it('sin nada capturado, getAttribution da undefined', async () => {
    const { getAttribution } = await load();
    expect(getAttribution()).toBeUndefined();
  });
});

describe('oposición al origen de la visita (PR 13)', () => {
  const CONSENT_KEY = 'elights_cookie_consent';
  const decision = (origin: boolean, at = new Date().toISOString()) =>
    localStorage.setItem(CONSENT_KEY, JSON.stringify({ v: 2, at, analytics: false, ads: false, meta: false, origin }));

  it('con origin=false guardado, captureAttribution no escribe y getAttribution devuelve undefined', async () => {
    sessionStorage.setItem(KEY, JSON.stringify({ gclid: GCLID, landing: '/' })); // anotado antes de oponerse
    decision(false);
    const { captureAttribution, getAttribution } = await load();
    captureAttribution(`${SITE}/catalogo?gclid=OTRO123&utm_source=google`, 'https://www.google.com/');
    expect(stored()).toEqual({ gclid: GCLID, landing: '/' }); // no escribió
    expect(getAttribution()).toBeUndefined();
  });

  it('la oposición no vence: tampoco con una decisión de hace 2 años', async () => {
    decision(false, new Date(Date.now() - 730 * 24 * 60 * 60 * 1000).toISOString());
    const { captureAttribution, getAttribution } = await load();
    captureAttribution(`${SITE}/?gclid=${GCLID}`, '');
    expect(stored()).toBeNull();
    expect(getAttribution()).toBeUndefined();
  });

  it('clearAttribution borra la clave de la sesión y la copia en memoria', async () => {
    const { captureAttribution, clearAttribution, getAttribution } = await load();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new Error('QuotaExceededError'); // queda solo en memoria
    });
    captureAttribution(`${SITE}/?gclid=${GCLID}`, '');
    expect(getAttribution()).toEqual({ gclid: GCLID, landing: '/' });
    sessionStorage.setItem(KEY, JSON.stringify({ utm_source: 'news', landing: '/x' }));
    clearAttribution();
    expect(stored()).toBeNull();
    expect(getAttribution()).toBeUndefined();
  });

  it('clearAttribution nunca lanza, aunque sessionStorage falle', async () => {
    const { clearAttribution } = await load();
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(() => clearAttribution()).not.toThrow();
  });

  it.each([
    ['sin decisión', null],
    ['con Rechazar (solo apaga las cookies de Google y de Meta)', true],
  ])('%s se sigue capturando', async (_, origin) => {
    if (origin !== null) decision(origin);
    const { captureAttribution, getAttribution } = await load();
    captureAttribution(`${SITE}/?gclid=${GCLID}`, '');
    expect(stored()).toEqual({ gclid: GCLID, landing: '/' });
    expect(getAttribution()).toEqual({ gclid: GCLID, landing: '/' });
  });
});
