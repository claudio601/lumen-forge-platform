// api/_lib/notify/salesEmail.test.ts
// Correo a ventas por el relay de Apps Script: claves de la plantilla, fecha de Chile,
// errores del relay y logs sin datos del cliente. El relay está simulado.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@vercel/functions', () => ({ waitUntil: vi.fn() }));

import { waitUntil } from '@vercel/functions';
import { toGasBody, sendSalesEmail, notifySales, SalesEmailError, type SalesEmail } from './salesEmail';

const base: SalesEmail = {
  modo: 'Estudio lumínico DIALux',
  nombre: 'PRUEBA TEST',
  email: 'prueba-notify@example.com',
  telefono: '+56 9 0000 0900',
  cuerpo: '=== SOLICITUD ===\nReferencia: ESTL-prueba',
};

function relay(text: string, status = 200) {
  return vi.fn(async () => ({ ok: status >= 200 && status < 300, status, text: async () => text }));
}

describe('toGasBody', () => {
  beforeEach(() => vi.stubEnv('SALES_EMAIL', undefined));
  afterEach(() => vi.unstubAllEnvs());

  it('usa las claves de la plantilla; total por defecto "-"', () => {
    expect(toGasBody(base)).toMatchObject({
      to_email: 'ventas@elights.cl',
      reply_to: 'prueba-notify@example.com',
      from_name: 'PRUEBA TEST',
      nombre: 'PRUEBA TEST',
      telefono: '+56 9 0000 0900',
      modo_precio: 'Estudio lumínico DIALux',
      items_lista: base.cuerpo,
      total: '-',
    });
  });

  it('deja fuera las claves opcionales vacías (la plantilla imprimiría la línea)', () => {
    const body = toGasBody({ ...base, razonSocial: '', rutEmpresa: '   ', giro: undefined });
    for (const key of ['razon_social', 'rut_empresa', 'giro', 'direccion', 'comentarios', 'subject_override']) {
      expect(body).not.toHaveProperty(key);
    }
    expect(Object.values(body)).not.toContain('undefined');

    const full = toGasBody({ ...base, razonSocial: 'PRUEBA SPA', rutEmpresa: 'RUT-PRUEBA', asunto: 'Estudio ESTL-x' });
    expect(full).toMatchObject({ razon_social: 'PRUEBA SPA', rut_empresa: 'RUT-PRUEBA', subject_override: 'Estudio ESTL-x' });
  });

  it('SALES_EMAIL cambia el destinatario', () => {
    vi.stubEnv('SALES_EMAIL', 'otro@example.com');
    expect(toGasBody(base).to_email).toBe('otro@example.com');
  });

  it('la fecha es la de Chile, no la de UTC', () => {
    expect(toGasBody(base, new Date('2026-10-07T01:30:00Z')).fecha).toBe('6 de octubre de 2026');
  });

  it('quita saltos de línea de los campos de una línea y limita los largos', () => {
    const body = toGasBody({ ...base, nombre: 'PRUEBA\r\nTEST', cuerpo: 'x'.repeat(9000), razonSocial: 'y'.repeat(900) });
    expect(body.nombre).toBe('PRUEBA TEST');
    expect(body.from_name).toBe('PRUEBA TEST');
    expect(body.items_lista).toHaveLength(8000);
    expect(body.razon_social).toHaveLength(500);
  });

  it('un cuerpo recortado termina con una marca visible que dice cuánto falta', () => {
    const cuerpo = 'Referencia: ESTL-x\n' + 'x'.repeat(9000) + '\nleadRef: ESTL-x';
    const body = toGasBody({ ...base, cuerpo });
    const mark = body.items_lista.match(/\n\[…recortado: (\d+) caracteres más\]$/);
    expect(mark).not.toBeNull();
    const kept = body.items_lista.length - mark![0].length;
    expect(kept + Number(mark![1])).toBe(cuerpo.length);
    expect(body.items_lista.startsWith(cuerpo.slice(0, kept))).toBe(true);
    expect(body.items_lista.length).toBeLessThanOrEqual(8000);
    // Lo que cabe no se toca
    expect(toGasBody({ ...base, cuerpo: 'x'.repeat(8000) }).items_lista).toBe('x'.repeat(8000));
    // Los comentarios largos también avisan
    expect(toGasBody({ ...base, comentarios: 'c'.repeat(600) }).comentarios).toMatch(/\[…recortado: \d+ caracteres más\]$/);
  });

  it('acepta campos que no son texto (un número en un opcional no rompe el correo)', () => {
    const odd = {
      ...base, razonSocial: 12345, comentarios: 7, giro: null, total: 0, cuerpo: undefined,
    } as unknown as SalesEmail;
    const body = toGasBody(odd);
    expect(body.razon_social).toBe('12345');
    expect(body.comentarios).toBe('7');
    expect(body.total).toBe('0');
    expect(body.items_lista).toBe('');
    expect(body).not.toHaveProperty('giro');
    expect(Object.values(body)).not.toContain('undefined');
    expect(Object.values(body)).not.toContain('null');
  });
});

describe('sendSalesEmail', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('en las pruebas el relay nunca es el de Google (no escribe a ventas@)', () => {
    expect(process.env.GAS_RELAY_URL).toBeTruthy();
    expect(process.env.GAS_RELAY_URL).not.toMatch(/script\.google\.com/);
  });

  it('hace un POST text/plain con JSON a GAS_RELAY_URL y resuelve con status ok', async () => {
    vi.stubGlobal('fetch', relay('{"status":"ok"}'));
    await expect(sendSalesEmail(base)).resolves.toBeUndefined();
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe(process.env.GAS_RELAY_URL);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'text/plain' });
    expect(JSON.parse(init.body as string).modo_precio).toBe('Estudio lumínico DIALux');
  });

  it('un número en un campo opcional igual llega al relay', async () => {
    vi.stubGlobal('fetch', relay('{"status":"ok"}'));
    await expect(sendSalesEmail({ ...base, razonSocial: 12345 } as unknown as SalesEmail)).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string).razon_social).toBe('12345');
  });

  it('rechaza si status no es ok: motivo clasificado en el mensaje, texto del relay aparte', async () => {
    vi.stubGlobal('fetch', relay('{"status":"error","message":"Script error en la línea 12"}'));
    const err = await sendSalesEmail(base).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SalesEmailError);
    expect((err as SalesEmailError).message).toBe('GAS relay: status error');
    expect((err as SalesEmailError).relayText).toBe('Script error en la línea 12');
  });

  it('reconoce la cuota de Gmail agotada', async () => {
    vi.stubGlobal('fetch', relay('{"status":"error","message":"Service invoked too many times for one day: email."}'));
    await expect(sendSalesEmail(base)).rejects.toThrow('GAS relay: status error (cuota de correos agotada)');
  });

  it('rechaza una página HTML con el estado HTTP; el trozo del cuerpo queda aparte', async () => {
    vi.stubGlobal('fetch', relay('<!DOCTYPE html><html>Error del script</html>', 500));
    const err = await sendSalesEmail(base).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SalesEmailError);
    expect((err as SalesEmailError).message).toBe('GAS relay: HTTP 500, respuesta no JSON');
    expect((err as SalesEmailError).relayText).toContain('<!DOCTYPE html>');
  });

  it('rechaza si el relay no responde a tiempo', async () => {
    // Como fetch real: no resuelve nunca, pero respeta la señal de corte.
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
    })));
    await expect(sendSalesEmail(base, { timeoutMs: 50 })).rejects.toBeDefined();
  });
});

describe('notifySales', () => {
  beforeEach(() => {
    vi.mocked(waitUntil).mockClear();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  const logged = () => [...vi.mocked(console.log).mock.calls, ...vi.mocked(console.warn).mock.calls].flat().map(String).join('\n');

  it('registra el envío en waitUntil una vez y resuelve true', async () => {
    vi.stubGlobal('fetch', relay('{"status":"ok"}'));
    const sent = notifySales(base, '[prueba] ESTL-x');
    expect(waitUntil).toHaveBeenCalledTimes(1);
    expect(vi.mocked(waitUntil).mock.calls[0][0]).toBe(sent);
    await expect(sent).resolves.toBe(true);
    expect(logged()).toContain('[prueba] ESTL-x GAS relay OK');
  });

  it('nunca rechaza: resuelve false si el relay falla o la red cae', async () => {
    vi.stubGlobal('fetch', relay('{"status":"error"}'));
    await expect(notifySales(base, '[prueba]')).resolves.toBe(false);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    await expect(notifySales(base, '[prueba]')).resolves.toBe(false);
    expect(logged()).toContain('GAS relay FAIL');
  });

  it('los logs no llevan el correo, el teléfono ni el nombre del cliente', async () => {
    vi.stubGlobal('fetch', relay('{"status":"ok"}'));
    await notifySales(base, '[prueba]');
    vi.stubGlobal('fetch', relay('<html>error</html>', 502));
    await notifySales(base, '[prueba]');
    const text = logged();
    expect(text).not.toContain(base.email);
    expect(text).not.toContain(base.telefono);
    expect(text).not.toContain(base.nombre);
  });

  it('aunque el relay repita los datos del cliente en su respuesta, el log no los lleva', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const m: SalesEmail = { ...base, rutEmpresa: 'RUT-PRUEBA', razonSocial: 'PRUEBA SPA' };
    const echo = 'Invalid email: ' + m.email + ' | ' + m.nombre + ' | ' + m.telefono + ' | ' + m.rutEmpresa;
    vi.stubGlobal('fetch', relay(JSON.stringify({ status: 'error', message: echo })));
    await expect(notifySales(m, '[prueba]')).resolves.toBe(false);
    vi.stubGlobal('fetch', relay('<html><body>' + echo + '</body></html>', 500));
    await expect(notifySales(m, '[prueba]')).resolves.toBe(false);
    vi.stubGlobal('fetch', relay(JSON.stringify({ status: echo })));
    await expect(notifySales(m, '[prueba]')).resolves.toBe(false);

    const text = [console.log, console.warn, console.error, console.info]
      .flatMap((fn) => vi.mocked(fn).mock.calls.flat()).map(String).join('\n');
    expect(text).toContain('[prueba] GAS relay FAIL: GAS relay: status error');
    expect(text).toContain('[prueba] GAS relay FAIL: GAS relay: HTTP 500, respuesta no JSON');
    expect(text).toContain('[prueba] GAS relay FAIL: GAS relay: status no reconocido');
    for (const value of [m.email, m.nombre, m.telefono, m.rutEmpresa!, 'Invalid email']) {
      expect(text).not.toContain(value);
    }
  });

  it('timeout y red caída quedan en el log como motivo, sin detalles del relay', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError'); }));
    await expect(notifySales(base, '[prueba]')).resolves.toBe(false);
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('fetch failed', { cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) });
    }));
    await expect(notifySales(base, '[prueba]')).resolves.toBe(false);
    const text = logged();
    expect(text).toContain('GAS relay FAIL: GAS relay: sin respuesta a tiempo');
    expect(text).toContain('GAS relay FAIL: GAS relay: error de red (TypeError, ECONNREFUSED)');
  });
});
