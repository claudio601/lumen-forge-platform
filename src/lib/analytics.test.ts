import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Analytics = typeof import('./analytics');

async function load(id: string | undefined): Promise<Analytics> {
  vi.resetModules();
  vi.stubEnv('VITE_GA4_ID', id ?? '');
  return import('./analytics');
}

const isArgs = (e: unknown) => Object.prototype.toString.call(e) === '[object Arguments]';
const entries = () => (window.dataLayer ?? []).map(e => Array.from(e as ArrayLike<unknown>));
const events = () => entries().filter(e => e[0] === 'event').map(e => e[1]);
const gaScripts = () => document.querySelectorAll('script[src*="googletagmanager.com/gtag/js"]').length;

describe('analytics (GA4)', () => {
  beforeEach(() => {
    delete window.dataLayer;
    delete window.gtag;
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('importar no hace nada (se puede usar al generar páginas estáticas)', async () => {
    await load('G-TEST123');
    expect(window.dataLayer).toBeUndefined();
    expect(gaScripts()).toBe(0);
  });

  it('empuja objetos arguments (formato de Google), con consentimiento, js y config antes del primer evento', async () => {
    const a = await load('G-TEST123');
    a.sendPageView('/catalogo');
    expect(window.dataLayer!.every(isArgs)).toBe(true);
    expect(entries().map(e => e[0])).toEqual(['consent', 'js', 'config', 'event']);
    expect(entries()[2]).toEqual(['config', 'G-TEST123', { send_page_view: false }]);
    expect(entries()[3]).toEqual(['event', 'page_view', { page_path: '/catalogo', send_to: 'G-TEST123' }]);
    a.sendPageView('/');
    expect(gaScripts()).toBe(1);
  });

  it('un lead enviado es un solo generate_lead con el tipo de formulario', async () => {
    const a = await load('G-TEST123');
    a.trackLead('cotizacion', { lead_type: 'B2B' });
    expect(entries().at(-1)).toEqual(['event', 'generate_lead', { form_type: 'cotizacion', currency: 'CLP', lead_type: 'B2B' }]);
    expect(events().filter(n => n === 'generate_lead')).toHaveLength(1);
  });

  it('mide los clics a WhatsApp, correo y teléfono en cualquier enlace, una vez por clic', async () => {
    const a = await load('G-TEST123');
    a.sendPageView('/');
    document.body.innerHTML = `
      <a id="wa" href="https://wa.me/56991273128?text=hola"><span id="wa-icon">WA</span></a>
      <a id="mail" href="mailto:ventas@elights.cl">correo</a>
      <a id="tel" href="tel:+56991273128">fono</a>
      <a id="otro" href="/catalogo">catálogo</a>`;
    document.body.addEventListener('click', e => e.preventDefault()); // jsdom no navega
    for (const id of ['wa-icon', 'mail', 'tel', 'otro']) document.getElementById(id)!.click();
    expect(events().filter(n => n !== 'page_view')).toEqual(['whatsapp_click', 'contact_email_click', 'contact_phone_click']);
  });

  it('sin ID configurado no carga nada ni falla', async () => {
    const a = await load('PENDING_GA4_MEASUREMENT_ID');
    a.sendEvent('x');
    a.trackLead('instalacion');
    expect(window.dataLayer).toBeUndefined();
    expect(gaScripts()).toBe(0);
  });
});
