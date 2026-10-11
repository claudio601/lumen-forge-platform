// api/_lib/auth.test.ts
// Guardas de los formularios: origen exacto del sitio (solo en producción), límite de
// solicitudes por IP, IP del cliente y honeypot. Vive en _lib: Vercel no lo despliega.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { VercelRequest } from '@vercel/node';
import { isAllowedOrigin, checkRateLimit, getClientIp, isHoneypotTriggered, SITE_ORIGINS } from './auth';

function req(headers: Record<string, string | string[]> = {}, remoteAddress?: string): VercelRequest {
  return { headers, socket: remoteAddress ? { remoteAddress } : undefined } as unknown as VercelRequest;
}

const warned = () => vi.mocked(console.warn).mock.calls.flat().map(String).join('\n');

describe('isAllowedOrigin en producción: solo los orígenes exactos del sitio', () => {
  beforeEach(() => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it('los orígenes del sitio son nuevo, elights.cl y www', () => {
    expect(SITE_ORIGINS).toEqual(['https://nuevo.elights.cl', 'https://elights.cl', 'https://www.elights.cl']);
  });

  it.each(['https://nuevo.elights.cl', 'https://elights.cl', 'https://www.elights.cl'])('acepta Origin %s', (origin) => {
    expect(isAllowedOrigin(req({ origin }))).toBe(true);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('sin Origin acepta el Referer de una página de www (con el gclid de Google Ads)', () => {
    expect(isAllowedOrigin(req({ referer: 'https://www.elights.cl/cotizacion?gclid=x' }))).toBe(true);
  });

  it('mayúsculas y puerto por defecto dan el mismo origen', () => {
    expect(isAllowedOrigin(req({ origin: 'HTTPS://WWW.ELIGHTS.CL:443' }))).toBe(true);
  });

  it.each([
    'https://nuevo.elights.cl.evil.example',
    'https://elights.cl.evil.example',
    'https://elights.clx.io',
    'http://elights.cl',
    'https://elights.cl@evil.com',
    'https://elights.cl:8443',
  ])('rechaza Origin %s', (origin) => {
    expect(isAllowedOrigin(req({ origin }))).toBe(false);
  });

  it("rechaza Origin 'null' sin Referer", () => {
    expect(isAllowedOrigin(req({ origin: 'null' }))).toBe(false);
  });

  it.each(['elights.cl', 'nuevo.elights.cl', 'no es una url', '   ', 'https://', 'javascript:alert(1)'])(
    'rechaza basura como Origin o Referer: %j',
    (garbage) => {
      expect(isAllowedOrigin(req({ origin: garbage }))).toBe(false);
      expect(isAllowedOrigin(req({ referer: garbage }))).toBe(false);
    },
  );

  it('rechaza una solicitud sin cabeceras', () => {
    expect(isAllowedOrigin(req())).toBe(false);
    expect(warned()).toContain('sin origen');
  });

  it('un Origin válido pero ajeno gana: no se mira el Referer', () => {
    expect(isAllowedOrigin(req({ origin: 'https://evil.example', referer: 'https://elights.cl/' }))).toBe(false);
  });

  it.each([
    'http://evil.example',
    'http://elights.cl',
    'chrome-extension://abc',
    'https://evil.example, https://elights.cl',
    'https://elights.cl, https://evil.example',
    'no es una url',
  ])('un Origin enviado que no sirve (%j) se rechaza aunque el Referer sea del sitio', (origin) => {
    expect(isAllowedOrigin(req({ origin, referer: 'https://elights.cl/' }))).toBe(false);
    expect(warned()).toContain('origen no válido');
    expect(warned()).not.toContain(origin);
  });

  it('un Origin como arreglo cuenta como enviado y no sirve', () => {
    expect(isAllowedOrigin(req({ origin: ['https://elights.cl'], referer: 'https://elights.cl/' }))).toBe(false);
  });

  it.each(['null', '', '   '])('Origin %j sin valor: decide el Referer del sitio', (origin) => {
    expect(isAllowedOrigin(req({ origin, referer: 'https://www.elights.cl/cotizacion' }))).toBe(true);
    expect(isAllowedOrigin(req({ origin, referer: 'https://evil.example/' }))).toBe(false);
  });

  it('el log del rechazo lleva solo el origen, sin ruta ni query', () => {
    expect(isAllowedOrigin(req({ referer: 'https://evil.example/cotizacion?email=prueba-auth@example.com' }))).toBe(false);
    expect(warned()).toContain('https://evil.example');
    expect(warned()).not.toContain('cotizacion');
    expect(warned()).not.toContain('prueba-auth@example.com');
  });

  it('una lista propia reemplaza la del sitio', () => {
    expect(isAllowedOrigin(req({ origin: 'https://otro.example' }), ['https://otro.example'])).toBe(true);
    expect(isAllowedOrigin(req({ origin: 'https://nuevo.elights.cl' }), ['https://otro.example'])).toBe(false);
  });
});

describe('isAllowedOrigin fuera de producción: acepta todo (sin cambios)', () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each([undefined, 'development', 'preview'])('VERCEL_ENV=%s', (env) => {
    vi.stubEnv('VERCEL_ENV', env);
    expect(isAllowedOrigin(req({ origin: 'https://evil.example' }))).toBe(true);
    expect(isAllowedOrigin(req({ origin: 'https://nuevo.elights.cl.evil.example' }))).toBe(true);
    expect(isAllowedOrigin(req())).toBe(true);
  });
});

describe('checkRateLimit', () => {
  afterEach(() => vi.restoreAllMocks());

  it('10 solicitudes pasan; la 11.ª no', () => {
    const results = Array.from({ length: 11 }, () => checkRateLimit('192.0.2.10'));
    expect(results.slice(0, 10).every((r) => r.allowed)).toBe(true);
    expect(results[9].remaining).toBe(0);
    expect(results[10]).toEqual({ allowed: false, remaining: 0 });
  });

  it('pasados 15 minutos empieza una ventana nueva', () => {
    const t0 = 1_000_000;
    const now = vi.spyOn(Date, 'now').mockReturnValue(t0);
    for (let i = 0; i < 10; i++) checkRateLimit('192.0.2.11');
    expect(checkRateLimit('192.0.2.11').allowed).toBe(false);
    now.mockReturnValue(t0 + 14 * 60_000);
    expect(checkRateLimit('192.0.2.11').allowed).toBe(false);
    now.mockReturnValue(t0 + 15 * 60_000 + 1);
    expect(checkRateLimit('192.0.2.11')).toEqual({ allowed: true, remaining: 9 });
  });

  it('cada IP tiene su propio contador', () => {
    for (let i = 0; i < 10; i++) checkRateLimit('192.0.2.12');
    expect(checkRateLimit('192.0.2.12').allowed).toBe(false);
    expect(checkRateLimit('192.0.2.13')).toEqual({ allowed: true, remaining: 9 });
  });
});

describe('getClientIp', () => {
  it('toma la primera entrada de x-forwarded-for, sin espacios', () => {
    expect(getClientIp(req({ 'x-forwarded-for': ' 203.0.113.5 , 10.0.0.1' }, '127.0.0.1'))).toBe('203.0.113.5');
  });

  it('acepta la cabecera como arreglo', () => {
    expect(getClientIp(req({ 'x-forwarded-for': ['198.51.100.7, 10.0.0.1', '192.0.2.1'] }))).toBe('198.51.100.7');
  });

  it('sin x-forwarded-for usa la IP del socket', () => {
    expect(getClientIp(req({}, '192.0.2.9'))).toBe('192.0.2.9');
  });

  it("sin cabecera ni socket: 'unknown'", () => {
    expect(getClientIp(req())).toBe('unknown');
  });
});

describe('isHoneypotTriggered', () => {
  it('true si el campo website trae texto', () => {
    expect(isHoneypotTriggered({ website: 'http://spam' })).toBe(true);
  });

  it.each([{ website: '   ' }, { website: '' }, { website: 1 }, {}, null, undefined, 'website=x', 42])(
    'false para %j',
    (body) => {
      expect(isHoneypotTriggered(body)).toBe(false);
    },
  );

  it('acepta otro nombre de campo', () => {
    expect(isHoneypotTriggered({ url: 'x' }, 'url')).toBe(true);
    expect(isHoneypotTriggered({ website: 'x' }, 'url')).toBe(false);
  });
});
