// Páginas estáticas (Etapa 2): el HTML se genera en el servidor (entry-server.tsx), sin
// sesión y sin parámetros de URL, y el navegador lo "hidrata" con la app real (App.tsx).
// Si el primer render del navegador difiere del HTML, o si una actualización urgente
// llega a la página antes de que termine de hidratarse, React descarta el HTML del
// servidor y la vuelve a dibujar (onRecoverableError) o avisa por consola ("did not match").
//
// Aviso de cookies (PR 13): todas las hidrataciones corren con el aviso HABILITADO en este
// host (VITE_COOKIE_BANNER_HOSTS=localhost, como en elights.cl), porque es el caso que puede
// romper la página de llegada: el aviso lee la decisión del navegador. El HTML del servidor
// nunca lo trae; después de hidratar aparece solo si no hay decisión (control positivo). La
// decisión se siembra solo en el navegador, después de generar el HTML.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, waitFor } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot, type Root } from 'react-dom/client';
import { HelmetProvider } from 'react-helmet-async';
import App from '@/App';
import { serverTree } from '@/entry-server';
import { preloadRoute, staticPage } from '@/routes';
import { NOT_FOUND_ATTR, NOT_FOUND_URL } from '@/lib/notFound';
import { notFoundSearch } from '@/lib/notFoundSearch';
import { prerenderedRoutes, STATIC_ROUTES } from '@/lib/seo/routes';
import { products } from '@/data/products';
import { editorialOverlay } from '@/data/catalog/overlay/editorial';
import { hasProductContent } from '@/data/catalog/content';
import { COOKIE_CONSENT_STORAGE_KEY, COOKIE_CONSENT_VERSION, COOKIE_TEXTS, __resetForTests, type CookieChoice } from '@/lib/cookieConsent';
import { CONSENT_FIELD_NAMES } from '../api/_lib/forms/consent';

/**
 * Sesión de un cliente en modo empresa con productos en la cotización y en la solicitud, y
 * con el origen de la visita guardado (src/lib/attribution.ts: ningún componente lo lee al
 * dibujar, solo al enviar un formulario).
 */
function seedSession() {
  const p = products[0];
  sessionStorage.setItem('elights_b2b', 'true');
  sessionStorage.setItem(
    'elights_attribution',
    JSON.stringify({ gclid: 'Cj0KCQjwEJEMPLO123', utm_source: 'google', utm_medium: 'cpc', landing: '/catalogo', referrer: 'https://www.google.com' }),
  );
  sessionStorage.setItem('elights_quote', JSON.stringify([{ product: p, quantity: 3 }]));
  sessionStorage.setItem(
    'elights_request_cart',
    JSON.stringify([{ productId: p.id, jumpsellerId: p.jumpseller_id, sku: p.sku || `JS-${p.jumpseller_id}`, name: p.name, quantity: 2, unitPrice: p.price, priceMode: 'iva', url: `/producto/${p.id}`, attributes: {} }]),
  );
}

/** Decisiones de cookies que se siembran en el navegador (nunca en el HTML del servidor). */
const ACCEPTED: CookieChoice = { analytics: true, ads: true, meta: true, origin: true };
const REJECTED_NO_ORIGIN: CookieChoice = { analytics: false, ads: false, meta: false, origin: false };

function seedDecision(choice: CookieChoice) {
  localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, JSON.stringify({ v: COOKIE_CONSENT_VERSION, at: new Date().toISOString(), ...choice }));
}

/** El aviso de cookies (CookieConsent): una región con su etiqueta. */
const BANNER = `section[aria-label="${COOKIE_TEXTS.bannerLabel}"]`;

let root: Root | undefined;
beforeEach(() => {
  // El aviso se abre solo en este host (jsdom: localhost), como en elights.cl
  vi.stubEnv('VITE_COOKIE_BANNER_HOSTS', 'localhost');
});
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  sessionStorage.clear();
  localStorage.clear();
  __resetForTests();
  document.body.innerHTML = '';
  window.history.replaceState({}, '', '/');
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const MISMATCH = /did not match|did not expect server HTML|Expected server HTML|received an update before it finished hydrating|switch to client rendering/i;

/**
 * Genera el HTML como el prerender (ruta sin parámetros, sin sesión) y lo hidrata con
 * la app del navegador en la URL del visitante, opcionalmente con una sesión activa y con
 * una decisión de cookies guardada (las dos, solo en el navegador).
 * notFound: el HTML es 404.html (Vercel lo sirve en cualquier URL sin archivo ni regla).
 */
async function hydrate(serverPath: string, clientUrl: string, withSession: boolean, notFound = false, decision: CookieChoice | null = null) {
  sessionStorage.clear();
  localStorage.clear();
  __resetForTests();
  const errors: unknown[] = [];
  const consoleErrors: string[] = [];
  // En jsdom, Radix usa useLayoutEffect también en el render del servidor y React avisa
  // (en Node, donde corre el prerender, no lo usa). Solo cuentan los avisos de hidratación.
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { consoleErrors.push(args.map(String).join(' ')); });
  await preloadRoute(serverPath);
  const html = renderToString(serverTree(serverPath));
  if (withSession) seedSession();
  if (decision) seedDecision(decision);
  window.history.replaceState({}, '', clientUrl);
  const container = document.createElement('div');
  container.innerHTML = html;
  if (notFound) container.setAttribute(NOT_FOUND_ATTR, ''); // como scripts/prerender.ts (markNotFound)
  document.body.appendChild(container);
  const serverH1 = container.querySelector('main h1');
  await act(async () => {
    const { notFoundPath, preload } = staticPage(container, new URL(clientUrl, 'http://x').pathname); // como src/main.tsx
    await preload;
    root = hydrateRoot(container, <HelmetProvider><App notFoundPath={notFoundPath} /></HelmetProvider>, { onRecoverableError: e => errors.push(e) });
    await new Promise(r => setTimeout(r, 0));
  });
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
  return { errors, mismatches: consoleErrors.filter(m => MISMATCH.test(m)), container, serverH1, html };
}

/** El HTML del servidor no trae el aviso y sí el botón «Configurar cookies» del pie. */
function expectServerHtmlWithoutBanner(html: string) {
  expect(html).not.toContain(`aria-label="${COOKIE_TEXTS.bannerLabel}"`);
  expect(html).not.toContain(COOKIE_TEXTS.banner);
  expect(html).not.toMatch(/googletagmanager|dataLayer|fbevents|connect\.facebook\.net|facebook\.com\/tr|\bfbq\(/);
  expect(html).toContain(`>${COOKIE_TEXTS.footerButton}</button>`);
}

const withContent = products.find(p => hasProductContent(p.jumpseller_id) && !editorialOverlay[p.jumpseller_id])!;
const bestled = products.find(p => editorialOverlay[p.jumpseller_id])!;
// Selector de variante genérico con dos ejes (potencia y temperatura de color) y precio «desde»
const flyhawk = products.find(p => p.jumpseller_id === 11521285)!;

const PAGES: [string, string, string][] = [
  ...STATIC_ROUTES.map(r => [`página fija ${r}`, r, r] as [string, string, string]),
  ['categoría (Google Ads, página 2)', '/catalogo/paneles-led', '/catalogo/paneles-led?gclid=abc&utm_source=google&page=2'],
  // Temperatura de color en la URL (auditoría UX, B-05): el HTML estático no la trae; se aplica al montar
  ['categoría con temperatura en la URL (campaña ?k=2700)', '/catalogo/alumbrado-publico', '/catalogo/alumbrado-publico?k=2700&gclid=abc'],
  ['ficha con contenido SEO', `/producto/${withContent.id}`, `/producto/${withContent.id}?gclid=abc`],
  ['ficha BESTLED', `/producto/${bestled.id}`, `/producto/${bestled.id}`],
  ['ficha con selector de variante (Flyhawk)', `/producto/${flyhawk.id}`, `/producto/${flyhawk.id}?gclid=abc`],
  // Guías (plan del blog, §5.6): cada guía publicada, también las sin indexar; G1 llega desde el
  // correo del 12/11 a su sección #plazos
  ...prerenderedRoutes()
    .filter(r => r.startsWith('/guias/'))
    .map(r => [`guía ${r}, desde un correo`, r, `${r}?utm_source=email&utm_medium=email&utm_campaign=20261112-plazos-ds1#plazos`] as [string, string, string]),
];

/**
 * URLs que reciben 404.html (PR 05). Varias coinciden con una ruta de la app: sin la marca
 * de 404.html el navegador dibujaría otra página encima del HTML.
 */
const NOT_FOUND_URLS: [string, string][] = [
  ['URL desconocida', '/una/url/que/no/existe'],
  ['producto que no existe', '/producto/no-existe'],
  // 2325754 no se publica y no se renombró: su URL da 404 (un id renombrado da 301, PR 07)
  ['producto que salió del catálogo (id publicado antes)', '/producto/lineal-led-flat-40w-120-cm-ip20-6500k?gclid=abc'],
  ['categoría que no existe, página 2', '/catalogo/no-existe?page=2'],
  ['ruta de la app con otras mayúsculas', '/Cotizador'],
  // Una guía que no existe (o que se despublicó): coincide con /guias/:slug
  ['guía que no existe', '/guias/no-existe'],
];

describe('hidratación de las páginas estáticas (árbol real: entry-server y App)', () => {
  const cases: [string, string, string, boolean][] = [
    ...PAGES.map(([name, serverPath, clientUrl]) => [name, serverPath, clientUrl, false] as [string, string, string, boolean]),
    ...NOT_FOUND_URLS.map(([name, url]) => [`404.html en ${name} (${url})`, NOT_FOUND_URL, url, true] as [string, string, string, boolean]),
  ];
  for (const [name, serverPath, clientUrl, notFound] of cases) {
    for (const withSession of [false, true]) {
      // Visitante nuevo: sin sesión y sin decisión de cookies. Con sesión: modo empresa,
      // carrito, origen de la visita y cookies aceptadas.
      it(`${name}, ${withSession ? 'con sesión (modo empresa, carrito y cookies aceptadas)' : 'visitante nuevo (sin decisión de cookies)'}: conserva el HTML del servidor`, async () => {
        const { errors, mismatches, container, serverH1, html } = await hydrate(serverPath, clientUrl, withSession, notFound, withSession ? ACCEPTED : null);
        expect(errors).toEqual([]);
        expect(mismatches).toEqual([]);
        expect(serverH1).not.toBeNull();
        expect(container.contains(serverH1)).toBe(true); // React reutilizó el nodo: no lo volvió a dibujar
        expect(container.querySelector('main .animate-spin')).toBeNull(); // ni el indicador de carga
        expectServerHtmlWithoutBanner(html);
        // Control positivo: el aviso aparece después de hidratar solo si no hay decisión
        if (withSession) expect(container.querySelector(BANNER)).toBeNull();
        else await waitFor(() => expect(container.querySelector(BANNER)).not.toBeNull());
      });
    }
  }

  it('después de hidratar, la categoría muestra la página de la URL y la sesión queda aplicada', async () => {
    const { container } = await hydrate('/catalogo/paneles-led', '/catalogo/paneles-led?page=2', true);
    expect(container.textContent).toContain('Página 2 de');
    expect(container.textContent).toContain('B2B - Precio neto');
    expect(sessionStorage.getItem('elights_b2b')).toBe('true');
    expect(JSON.parse(sessionStorage.getItem('elights_request_cart')!)).toHaveLength(1);
  });

  it('la ficha con variantes llega con el selector y «desde» en el HTML, y al hidratar se puede elegir', async () => {
    const { container, html } = await hydrate(`/producto/${flyhawk.id}`, `/producto/${flyhawk.id}`, false);
    expect(html).toContain('data-variant-selector');
    expect(html).toContain('Elige una potencia y una temperatura de color para continuar.');
    const price = () => container.querySelector('main p.text-3xl')!.parentElement!.textContent!;
    expect(price()).toMatch(/^desde\s*\$442\.800/);
    const radio = (name: RegExp) => [...container.querySelectorAll<HTMLElement>('[role="radio"]')].find(r => name.test(r.closest('label')!.textContent!))!;
    await act(async () => { fireEvent.click(radio(/^80W/)); });
    await act(async () => { fireEvent.click(radio(/^Ámbar 2200K/)); });
    expect(price()).toMatch(/^\$514\.800/);
    expect(container.textContent).toContain('Elegiste: 80W · Ámbar 2200K.');
  });

  it('el HTML de las fichas con selector no lleva el texto crudo de Jumpseller; en las BESTLED, ningún «% de luz azul»', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {}); // useLayoutEffect de Radix en jsdom (ver hydrate)
    const bestleds = products.filter(p => p.availableCCT?.length);
    expect(bestleds).toHaveLength(7);
    for (const p of [...bestleds, flyhawk]) {
      const path = `/producto/${p.id}`;
      await preloadRoute(path);
      const html = renderToString(serverTree(path));
      expect(html, p.name).toContain('data-variant-selector');
      // Ni en los radios ni en los inputs ocultos de Radix (antes: value="Luz Cálida - 2200K - 1% Luz Azul")
      for (const raw of new Set(p.variants!.flatMap(v => v.options.map(o => o.value)))) {
        if (/luz/i.test(raw)) expect(html, `${p.name}: ${raw}`).not.toContain(`value="${raw}"`);
      }
      // D.S. N°1: el % es el límite de la clase, no un dato de la temperatura (scripts/catalog.test.ts)
      if (p.availableCCT?.length) expect(html, p.name).not.toMatch(/\b\d+ ?% (?:de )?luz azul/i);
    }
  });

  it('la ficha llega con su contenido SEO en el HTML y lo conserva al hidratar', async () => {
    const { container } = await hydrate(`/producto/${withContent.id}`, `/producto/${withContent.id}`, false);
    expect(container.textContent).toContain('Beneficios clave');
    expect(container.textContent).toContain('Preguntas frecuentes');
  });

  it('404.html en un producto que no existe: queda la página "no encontrada" (sin la ficha) y lleva noindex', async () => {
    const { container } = await hydrate(NOT_FOUND_URL, '/producto/no-existe', false, true);
    expect(container.querySelector('main h1')?.textContent).toBe('404');
    expect(container.textContent).not.toContain('Producto no encontrado');
    await waitFor(() => expect(document.title).toBe('Página no encontrada | eLIGHTS Chile'));
    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe('noindex, follow');
  });

  it('404.html (auditoría UX, B-10): el buscador llega vacío en el HTML y, al hidratar, con las palabras de la URL que encuentran productos', async () => {
    const path = '/producto/lineal-led-flat-40w-120-cm-ip20-6500k';
    const url = `${path}?gclid=abc`;
    const { container, html, errors, mismatches } = await hydrate(NOT_FOUND_URL, url, false, true);
    expect(errors).toEqual([]);
    expect(mismatches).toEqual([]);
    const server = document.createElement('div');
    server.innerHTML = html;
    expect(server.querySelector('main form[role="search"][action="/buscar"] input[name="q"]')?.getAttribute('value')).toBe('');
    expect(server.querySelectorAll('main section a[href^="/catalogo/"]')).toHaveLength(6);
    expect(server.querySelector('main a[href="mailto:ventas@elights.cl"]')?.textContent).toBe('Escríbenos a ventas@elights.cl');
    const field = () => container.querySelector<HTMLInputElement>('main input[name="q"]')!;
    const expected = notFoundSearch(path);
    expect(expected).not.toBe('');
    await waitFor(() => expect(field().value).toBe(expected));
    expect(container.querySelector('main h1')?.textContent).toBe('404');
  });

  it('desde la página 404 se navega normal, y al volver atrás se ve otra vez la 404', async () => {
    const { container } = await hydrate(NOT_FOUND_URL, '/producto/no-existe', false, true);
    const home = [...container.querySelectorAll('main a')].find(a => a.textContent === 'Volver al inicio')!;
    await act(async () => { fireEvent.click(home); });
    expect(window.location.pathname).toBe('/');
    await waitFor(() => expect(container.querySelector('main h1')?.textContent).not.toBe('404'));
    await act(async () => {
      window.history.back();
      await new Promise(r => setTimeout(r, 50));
    });
    expect(window.location.pathname).toBe('/producto/no-existe');
    await waitFor(() => expect(container.querySelector('main h1')?.textContent).toBe('404'));
  });

  it('sin la marca de 404.html, el navegador hidrata la ruta de la URL (la marca no se cuela en otras páginas)', async () => {
    const container = document.createElement('div');
    expect(staticPage(container, '/producto/no-existe').notFoundPath).toBeUndefined();
    container.setAttribute(NOT_FOUND_ATTR, '');
    expect(staticPage(container, '/producto/no-existe').notFoundPath).toBe('/producto/no-existe');
    expect(await staticPage(container, '/producto/no-existe').preload).toEqual(await preloadRoute(NOT_FOUND_URL));
  });
});

describe('aviso de cookies y casillas en la hidratación (PR 13)', () => {
  const PAGES_WITH_BANNER = ['/', '/cotizador', '/instalacion', '/estudio-luminico', '/politica-de-privacidad'];

  it('las páginas clave están entre las fijas (la prueba de arriba las hidrata sin decisión y con cookies aceptadas)', () => {
    for (const page of PAGES_WITH_BANNER) expect(STATIC_ROUTES).toContain(page);
  });

  for (const page of PAGES_WITH_BANNER) {
    it(`${page}, rechazó las cookies y se opuso al origen de la visita: conserva el HTML y no muestra el aviso`, async () => {
      const { errors, mismatches, container, serverH1, html } = await hydrate(page, page, false, false, REJECTED_NO_ORIGIN);
      expect(errors).toEqual([]);
      expect(mismatches).toEqual([]);
      expect(container.contains(serverH1)).toBe(true);
      expectServerHtmlWithoutBanner(html);
      expect(container.querySelector(BANNER)).toBeNull();
    });
  }

  const FORMS: [string, string][] = [
    ['/cotizador', 'cotizador'],
    ['/instalacion', 'instalacion'],
    ['/estudio-luminico', 'estudio-luminico'],
  ];
  for (const [page, form] of FORMS) {
    it(`${page}: las casillas llegan sin marcar en el formulario deshabilitado y quedan sin marcar y habilitadas al hidratar`, async () => {
      const { errors, mismatches, container, html } = await hydrate(page, page, false);
      expect(errors).toEqual([]);
      expect(mismatches).toEqual([]);
      const server = document.createElement('div');
      server.innerHTML = html;
      for (const name of [CONSENT_FIELD_NAMES.privacy, CONSENT_FIELD_NAMES.marketing]) {
        const box = server.querySelector<HTMLInputElement>(`input[type="checkbox"][name="${name}"]`);
        expect(box).not.toBeNull();
        expect(box!.hasAttribute('checked')).toBe(false);
        expect(box!.closest('fieldset[disabled]')).not.toBeNull(); // puerta de hidratación
        expect(box!.closest('[data-elights-form]')?.getAttribute('data-elights-form')).toBe(form);
        const live = container.querySelector<HTMLInputElement>(`input[type="checkbox"][name="${name}"]`)!;
        await waitFor(() => expect(live.closest('fieldset[disabled]')).toBeNull());
        expect(live.checked).toBe(false);
      }
    });
  }
});

// Va al final: analytics.ts recuerda en el módulo que GTM ya se cargó (solo vi.resetModules
// lo reinicia) y las pruebas de arriba comparten el módulo.
describe('con GTM activo en el host (elights.cl desde la Etapa 3)', () => {
  it('página de llegada de Google Ads con cookies aceptadas: se hidrata sin desajustes y GTM se carga después, fuera del HTML', async () => {
    vi.stubEnv('VITE_ANALYTICS_HOSTS', 'localhost');
    vi.stubEnv('VITE_GTM_ID', 'GTM-TEST123');
    vi.stubEnv('VITE_GA4_ID', 'G-TEST123');
    try {
      const { errors, mismatches, container, serverH1, html } = await hydrate(
        '/catalogo/paneles-led',
        '/catalogo/paneles-led?gclid=abc&utm_source=google',
        false,
        false,
        ACCEPTED,
      );
      expect(errors).toEqual([]);
      expect(mismatches).toEqual([]);
      expect(container.contains(serverH1)).toBe(true);
      expectServerHtmlWithoutBanner(html);
      // Control positivo: con la decisión guardada, la vista de RouteTracker cargó GTM (y nunca gtag/js)
      await waitFor(() => expect(document.head.querySelector('script[src="https://www.googletagmanager.com/gtm.js?id=GTM-TEST123"]')).not.toBeNull());
      expect(document.head.querySelector('script[src*="gtag/js"]')).toBeNull();
      expect(container.innerHTML).not.toContain('googletagmanager');
      expect(container.querySelector(BANNER)).toBeNull();
    } finally {
      document.head.querySelectorAll('script[src*="googletagmanager"]').forEach(s => s.remove());
      delete window.gtag;
      delete window.dataLayer;
      delete (window as unknown as Record<string, unknown>)['ga-disable-G-TEST123'];
    }
  });
});
