// api/_lib/notify/shippingRelay.test.ts
// Relay del aviso de despacho: clave, firma con un vector fijo (el mismo de testDoPost en
// apps-script/aviso-despacho/Code.gs), resultados del relay, plazo, errores de red, respuestas
// que no son del relay, redirección de Apps Script, variables faltantes y registros sin datos
// del cliente. El relay está simulado: nunca se llama al de Google.

import { createHash, createHmac } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import vm from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_RELAY_ATTACHMENT_BYTES,
  buildRelayBody,
  buildShippingPayload,
  relayReason,
  sendShippingNotice,
  signShippingPayload,
  validateShippingRequest,
  type ShippingNoticeRequest,
} from './shippingRelay';
import { dispatchRef, shippingNoticeKey, shortKey } from '../shipping/key';

// ── Vector fijo ──────────────────────────────────────────────────────────────
// El mismo secreto, ts, payload y sig que PRUEBA en Code.gs (una prueba de abajo lo exige).
// Secreto ficticio: nunca se usa fuera de las pruebas.
const VECTOR = {
  secret: 'secreto-de-prueba-solo-para-el-vector-0123456789abcdef',
  ts: 1795000000,
  payload:
    '{"v":1,"action":"despacho","key":"c4ea6a81742a5462b236a0d8840ed67e10003fce958d08d528e2ffe866266ba3",' +
    '"to":"cliente.prueba@example.com",' +
    '"subject":"Tu pedido va en camino \\u2014 Factura N\\u00b0 1234, Starken orden de flete ABC123456",' +
    '"html":"<p>Hola Prueba, tu pedido va en camino.</p>",' +
    '"text":"Hola Prueba,\\n\\nTu pedido ya va en camino.",' +
    '"attachments":[{"name":"Factura-1234.pdf","mimeType":"application/pdf","data":"JVBERi0xLjQKJXBydWViYQo="}]}',
  sig: 'bba784e7b2ca71c7b18d36e080c4aeca7cf41631321917dc285131e688edba27',
};

const PDF = Buffer.from('%PDF-1.4\n%prueba\n');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);

/** El pedido del vector: datos ficticios. */
const VECTOR_REQUEST: ShippingNoticeRequest = {
  action: 'despacho',
  key: shippingNoticeKey(4242, 'starken', 'ABC123456'),
  to: 'cliente.prueba@example.com',
  subject: 'Tu pedido va en camino — Factura N° 1234, Starken orden de flete ABC123456',
  html: '<p>Hola Prueba, tu pedido va en camino.</p>',
  text: 'Hola Prueba,\n\nTu pedido ya va en camino.',
  attachments: [{ name: 'Factura-1234.pdf', mimeType: 'application/pdf', data: PDF }],
};

const AT_VECTOR_TS = { now: () => VECTOR.ts * 1000 };

function relay(text: string, status = 200, url = 'https://script.googleusercontent.com/macros/echo?user_content_key=prueba') {
  return vi.fn(async (_url: string, _init: RequestInit) => ({
    ok: status >= 200 && status < 300,
    status,
    url,
    redirected: url.includes('googleusercontent'),
    text: async () => text,
  }) as unknown as Response);
}

/** Como fetch real: no resuelve nunca, pero respeta la señal de corte. */
function hangingFetch() {
  return vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
  }));
}

const fetchCall = () => vi.mocked(fetch).mock.calls[0] as [string, RequestInit];

describe('shippingNoticeKey', () => {
  it('es el SHA-256 en hex de {dealId}:{carrierId}:{orden}', () => {
    expect(shippingNoticeKey(4242, 'starken', 'ABC123456')).toBe('c4ea6a81742a5462b236a0d8840ed67e10003fce958d08d528e2ffe866266ba3');
    expect(shippingNoticeKey(4242, 'starken', 'ABC123456')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('el id como número (webhook v1) o como texto (v2) da la misma clave', () => {
    expect(shippingNoticeKey('4242', 'starken', 'ABC123456')).toBe(shippingNoticeKey(4242, 'starken', 'ABC123456'));
    expect(shippingNoticeKey(4242, '77', 'ABC123456')).toBe(shippingNoticeKey(4242, 77, 'ABC123456'));
  });

  it('otra orden, otro negocio u otro operador dan otra clave', () => {
    const base = shippingNoticeKey(4242, 'starken', 'ABC123456');
    expect(shippingNoticeKey(4242, 'starken', 'ABC123457')).not.toBe(base);
    expect(shippingNoticeKey(4243, 'starken', 'ABC123456')).not.toBe(base);
    expect(shippingNoticeKey(4242, 'chilexpress', 'ABC123456')).not.toBe(base);
  });

  it('con orden, la referencia es la orden y la clave no cambia (el documento no cuenta)', () => {
    expect(dispatchRef('ABC123456', { type: 'factura', number: '8459' })).toBe('ABC123456');
    expect(dispatchRef('ABC123456', { type: 'guia', number: '1' })).toBe('ABC123456');
    expect(shippingNoticeKey(4242, 'starken', dispatchRef('ABC123456', { type: 'factura', number: '8459' }))).toBe(
      'c4ea6a81742a5462b236a0d8840ed67e10003fce958d08d528e2ffe866266ba3',
    );
  });

  it('sin orden de flete (opcional desde el 24-11-2026): el documento identifica el despacho', () => {
    const f8459 = dispatchRef('', { type: 'factura', number: '8459' });
    expect(f8459).toBe('-factura8459');
    expect(dispatchRef('', { type: 'guia', number: '123' })).toBe('-guia123');
    const noOrder = shippingNoticeKey(4242, 'transportes-tvp', f8459);
    expect(noOrder).toBe(createHash('sha256').update('4242:transportes-tvp:-factura8459', 'utf8').digest('hex'));
    expect(shippingNoticeKey('4242', 'transportes-tvp', '-factura8459')).toBe(noOrder);
    // Otro número u otro tipo de documento, la orden u otro operador: otro despacho.
    expect(shippingNoticeKey(4242, 'transportes-tvp', '-factura8460')).not.toBe(noOrder);
    expect(shippingNoticeKey(4242, 'transportes-tvp', '-guia8459')).not.toBe(noOrder);
    expect(shippingNoticeKey(4242, 'transportes-tvp', 'ABC123')).not.toBe(noOrder);
    expect(shippingNoticeKey(4242, 'starken', '-factura8459')).not.toBe(noOrder);
    // Una orden normalizada nunca lleva «-»: no choca con un documento.
    expect(shippingNoticeKey(4242, 'transportes-tvp', 'FACTURA8459')).not.toBe(noOrder);
  });

  it('lanza si la referencia no es una orden normalizada ni la forma exacta del documento, o los ids no son válidos', () => {
    for (const order of ['ABC-123', 'abc123', '123.456.789', ' ABC123', ' ', '', 'ÑANDU1']) {
      expect(() => shippingNoticeKey(4242, 'starken', order), order).toThrow(TypeError);
    }
    // Sin orden: «-», el tipo (factura o guia) y el número sin ceros a la izquierda, hasta 10 dígitos.
    for (const ref of ['-', '-factura', '-factura0123', '-boleta123', '-Factura123', '-factura 123', 'factura-123', '--factura123', '-guía123', '-factura12345678901', '-factura123-']) {
      expect(() => shippingNoticeKey(4242, 'starken', ref), ref).toThrow(TypeError);
    }
    expect(shippingNoticeKey(4242, 'starken', '-factura1234567890')).toMatch(/^[0-9a-f]{64}$/);
    for (const deal of [0, -1, 1.5, '12a', '', '0123'] as Array<number | string>) {
      expect(() => shippingNoticeKey(deal, 'starken', 'ABC123'), String(deal)).toThrow(TypeError);
    }
    for (const carrier of ['', 'cruz del sur', 'x'.repeat(41)]) {
      expect(() => shippingNoticeKey(4242, carrier, 'ABC123'), carrier).toThrow(TypeError);
    }
  });

  it('shortKey deja los primeros 8 caracteres; lo que no es una clave no se imprime', () => {
    expect(shortKey(VECTOR_REQUEST.key)).toBe('c4ea6a81');
    for (const value of ['cliente.prueba@example.com', 'c4ea6a81', undefined, 42]) expect(shortKey(value)).toBe('--------');
  });
});

describe('firma HMAC (vector fijo)', () => {
  it('el payload del pedido es el del vector, solo en ASCII, y JSON.parse recupera el texto', () => {
    const payload = buildShippingPayload(VECTOR_REQUEST);
    expect(payload).toBe(VECTOR.payload);
    expect(/^[\x20-\x7e]*$/.test(payload)).toBe(true);
    const parsed = JSON.parse(payload);
    expect(parsed.subject).toBe(VECTOR_REQUEST.subject);
    expect(parsed.text).toBe(VECTOR_REQUEST.text);
    expect(Buffer.from(parsed.attachments[0].data, 'base64').equals(PDF)).toBe(true);
  });

  it('sig es el HMAC-SHA256 en hex de `${ts}.${payload}`', () => {
    expect(signShippingPayload(VECTOR.secret, VECTOR.ts, VECTOR.payload)).toBe(VECTOR.sig);
    expect(signShippingPayload(VECTOR.secret + 'x', VECTOR.ts, VECTOR.payload)).not.toBe(VECTOR.sig);
    expect(signShippingPayload(VECTOR.secret, VECTOR.ts + 1, VECTOR.payload)).not.toBe(VECTOR.sig);
  });

  it('el cuerpo es { ts, payload, sig }', () => {
    expect(buildRelayBody(VECTOR_REQUEST, VECTOR.secret, VECTOR.ts)).toBe(JSON.stringify({ ts: VECTOR.ts, payload: VECTOR.payload, sig: VECTOR.sig }));
  });

  it('Code.gs usa el mismo vector en testDoPost (PRUEBA, leído en la VM de abajo)', () => {
    const { PRUEBA } = loadCodeGs() as unknown as { PRUEBA: { secreto: string; ts: number; payload: string; sig: string } };
    expect(PRUEBA.secreto).toBe(VECTOR.secret);
    expect(PRUEBA.ts).toBe(VECTOR.ts);
    expect(PRUEBA.payload).toBe(VECTOR.payload);
    expect(PRUEBA.sig).toBe(VECTOR.sig);
  });
});

describe('sendShippingNotice', () => {
  beforeEach(() => {
    vi.stubEnv('SHIPPING_RELAY_URL', 'https://relay.example.test/macros/s/prueba/exec');
    vi.stubEnv('SHIPPING_RELAY_SECRET', VECTOR.secret);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const logged = () => [...vi.mocked(console.log).mock.calls, ...vi.mocked(console.warn).mock.calls].flat().map(String).join('\n');

  it('en las pruebas el relay nunca es el de Google (vitest.api.config.ts: puerto muerto)', () => {
    vi.unstubAllEnvs();
    expect(process.env.SHIPPING_RELAY_URL).toBeTruthy();
    expect(process.env.SHIPPING_RELAY_URL).not.toMatch(/script\.google/);
    expect(process.env.SHIPPING_RELAY_URL).toMatch(/^http:\/\/127\.0\.0\.1:9\//);
  });

  it('ok: un POST text/plain con { ts, payload, sig } firmado, siguiendo redirecciones', async () => {
    vi.stubGlobal('fetch', relay('{"status":"ok"}'));
    await expect(sendShippingNotice(VECTOR_REQUEST, AT_VECTOR_TS)).resolves.toEqual({ status: 'ok' });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetchCall();
    expect(url).toBe('https://relay.example.test/macros/s/prueba/exec');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'text/plain; charset=utf-8' });
    expect(init.redirect).toBe('follow');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.body).toBe(JSON.stringify({ ts: VECTOR.ts, payload: VECTOR.payload, sig: VECTOR.sig }));
    expect(logged()).toContain('[aviso-despacho] despacho c4ea6a81 Shipping relay: status ok');
  });

  it('ts es la hora actual en segundos y la firma la cubre', async () => {
    vi.stubGlobal('fetch', relay('{"status":"ok"}'));
    const before = Math.floor(Date.now() / 1000);
    await sendShippingNotice(VECTOR_REQUEST);
    const body = JSON.parse(fetchCall()[1].body as string);
    expect(Number.isInteger(body.ts)).toBe(true);
    expect(body.ts).toBeGreaterThanOrEqual(before);
    expect(body.ts).toBeLessThanOrEqual(before + 2);
    expect(body.sig).toBe(signShippingPayload(VECTOR.secret, body.ts, body.payload));
  });

  it('la vista previa no lleva el correo del cliente (el relay la envía solo a OWNER_EMAIL)', async () => {
    vi.stubGlobal('fetch', relay('{"status":"ok"}'));
    const preview = { ...VECTOR_REQUEST, action: 'preview' as const };
    await expect(sendShippingNotice(preview)).resolves.toEqual({ status: 'ok' });
    const payload = JSON.parse(JSON.parse(fetchCall()[1].body as string).payload);
    expect(payload.action).toBe('preview');
    expect(payload).not.toHaveProperty('to');
    expect(fetchCall()[1].body).not.toContain('cliente.prueba@example.com');
    // Sin correo también vale: lo pone el relay.
    vi.stubGlobal('fetch', relay('{"status":"ok"}'));
    await expect(sendShippingNotice({ ...preview, to: '' })).resolves.toEqual({ status: 'ok' });
  });

  it('acepta la factura y un comprobante JPEG o PNG', async () => {
    vi.stubGlobal('fetch', relay('{"status":"ok"}'));
    for (const voucher of [
      { name: 'Comprobante-Starken-ABC123456.jpg', mimeType: 'image/jpeg' as const, data: JPEG },
      { name: 'Comprobante-Starken-ABC123456.png', mimeType: 'image/png' as const, data: PNG },
    ]) {
      await expect(sendShippingNotice({ ...VECTOR_REQUEST, attachments: [VECTOR_REQUEST.attachments[0], voucher] })).resolves.toEqual({ status: 'ok' });
    }
    const payload = JSON.parse(JSON.parse(vi.mocked(fetch).mock.calls[1][1]!.body as string).payload);
    expect(payload.attachments.map((a: { mimeType: string }) => a.mimeType)).toEqual(['application/pdf', 'image/png']);
  });

  it('duplicate y quota', async () => {
    vi.stubGlobal('fetch', relay('{"status":"duplicate"}'));
    await expect(sendShippingNotice(VECTOR_REQUEST)).resolves.toEqual({ status: 'duplicate' });
    vi.stubGlobal('fetch', relay('{"status":"quota"}'));
    await expect(sendShippingNotice(VECTOR_REQUEST)).resolves.toEqual({ status: 'quota' });
    expect(logged()).toContain('Shipping relay: status duplicate');
    expect(logged()).toContain('Shipping relay: status quota');
  });

  it('una clave pendiente en el relay queda uncertain; el reenvío y la caché de la vista previa, rejected', async () => {
    vi.stubGlobal('fetch', relay('{"status":"uncertain","reason":"pendiente"}'));
    await expect(sendShippingNotice(VECTOR_REQUEST)).resolves.toEqual({
      status: 'uncertain',
      reason: 'clave pendiente en el relay (revisar Enviados)',
    });
    vi.stubGlobal('fetch', relay('{"status":"uncertain","reason":"cliente.prueba@example.com"}'));
    await expect(sendShippingNotice(VECTOR_REQUEST)).resolves.toEqual({ status: 'uncertain', reason: 'motivo no reconocido' });
    const preview: ShippingNoticeRequest = { ...VECTOR_REQUEST, action: 'preview', to: '' };
    vi.stubGlobal('fetch', relay('{"status":"rejected","reason":"reenvio"}'));
    await expect(sendShippingNotice(preview)).resolves.toEqual({ status: 'rejected', reason: 'reenvío del mismo cuerpo firmado' });
    vi.stubGlobal('fetch', relay('{"status":"rejected","reason":"cache"}'));
    await expect(sendShippingNotice(preview)).resolves.toEqual({ status: 'rejected', reason: 'caché del relay no disponible' });
    // Un duplicate siempre es «ya salió»: un motivo que lo acompañe no cambia nada.
    vi.stubGlobal('fetch', relay('{"status":"duplicate","reason":"reenvio"}'));
    await expect(sendShippingNotice(VECTOR_REQUEST)).resolves.toEqual({ status: 'duplicate' });
    expect(logged()).toContain('[aviso-despacho] despacho c4ea6a81 Shipping relay: status uncertain: clave pendiente en el relay (revisar Enviados)');
    expect(logged()).toContain('[aviso-despacho] preview c4ea6a81 Shipping relay: status rejected: reenvío del mismo cuerpo firmado');
    expect(logged()).toContain('[aviso-despacho] preview c4ea6a81 Shipping relay: status rejected: caché del relay no disponible');
    expect(logged()).not.toContain('cliente.prueba');
  });

  it('rejected: el código del relay pasa a un motivo de la lista; uno desconocido no se repite', async () => {
    const cases: Array<[string, string]> = [
      ['firma', 'firma no válida'],
      ['hora', 'hora fuera de rango'],
      ['para', 'destinatario no válido'],
      ['adjuntos', 'adjuntos no válidos'],
      ['config', 'falta configuración en el relay'],
      ['ocupado', 'relay ocupado'],
      ['almacenamiento', 'el relay no pudo reservar la clave'],
      ['reenvio', 'reenvío del mismo cuerpo firmado'],
      ['cache', 'caché del relay no disponible'],
      ['envio', 'Gmail no aceptó el envío'],
      ['xyz', 'motivo no reconocido'],
      ['constructor', 'motivo no reconocido'],
    ];
    for (const [code, reason] of cases) {
      vi.stubGlobal('fetch', relay(JSON.stringify({ status: 'rejected', reason: code })));
      await expect(sendShippingNotice(VECTOR_REQUEST), code).resolves.toEqual({ status: 'rejected', reason });
    }
    vi.stubGlobal('fetch', relay('{"status":"rejected"}'));
    await expect(sendShippingNotice(VECTOR_REQUEST)).resolves.toEqual({ status: 'rejected', reason: 'motivo no reconocido' });
    expect(logged()).toContain('[aviso-despacho] despacho c4ea6a81 Shipping relay: status rejected: firma no válida');
  });

  it('un JSON que no es del protocolo queda uncertain: no se sabe si salió', async () => {
    for (const text of ['{"status":"error"}', '{}', '{"ok":true}', '[]', 'null', '"ok"']) {
      vi.stubGlobal('fetch', relay(text));
      const result = await sendShippingNotice(VECTOR_REQUEST);
      expect(result.status, text).toBe('uncertain');
    }
  });

  it('plazo agotado: uncertain, sin reintento', async () => {
    vi.stubGlobal('fetch', hangingFetch());
    await expect(sendShippingNotice(VECTOR_REQUEST, { timeoutMs: 50 })).resolves.toEqual({ status: 'uncertain', reason: 'sin respuesta a tiempo' });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(logged()).toContain('Shipping relay: status uncertain: sin respuesta a tiempo');
  });

  it('el corte de quien llama también corta la llamada: uncertain', async () => {
    vi.stubGlobal('fetch', hangingFetch());
    const controller = new AbortController();
    const pending = sendShippingNotice(VECTOR_REQUEST, { signal: controller.signal });
    setTimeout(() => controller.abort(), 20);
    await expect(pending).resolves.toEqual({ status: 'uncertain', reason: 'sin respuesta a tiempo' });
  });

  it('usa el menor plazo: el de quien llama o 30 s', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    vi.stubGlobal('fetch', relay('{"status":"ok"}'));
    await sendShippingNotice(VECTOR_REQUEST, { timeoutMs: 5_000 });
    await sendShippingNotice(VECTOR_REQUEST, { timeoutMs: 60_000 });
    await sendShippingNotice(VECTOR_REQUEST);
    expect(timeout.mock.calls.map((c) => c[0])).toEqual([5_000, 30_000, 30_000]);
  });

  it('sin plazo (0 ms o la señal ya cortada) no llama al relay: no salió', async () => {
    vi.stubGlobal('fetch', relay('{"status":"ok"}'));
    await expect(sendShippingNotice(VECTOR_REQUEST, { timeoutMs: 0 })).resolves.toEqual({ status: 'rejected', reason: 'sin plazo para llamar al relay' });
    await expect(sendShippingNotice(VECTOR_REQUEST, { signal: AbortSignal.abort() })).resolves.toEqual({ status: 'rejected', reason: 'sin plazo para llamar al relay' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('error de red: uncertain, con el tipo y el código, sin detalles del servidor', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('fetch failed', { cause: Object.assign(new Error('connect ECONNREFUSED relay.example.test'), { code: 'ECONNREFUSED' }) });
    }));
    await expect(sendShippingNotice(VECTOR_REQUEST)).resolves.toEqual({ status: 'uncertain', reason: 'error de red (TypeError, ECONNREFUSED)' });
    vi.stubGlobal('fetch', vi.fn(async () => { throw 'texto raro'; }));
    await expect(sendShippingNotice(VECTOR_REQUEST)).resolves.toEqual({ status: 'uncertain', reason: 'error de red (error)' });
    expect(logged()).toContain('Shipping relay: status uncertain: error de red (TypeError, ECONNREFUSED)');
    expect(logged()).not.toContain('relay.example.test');
  });

  it('una respuesta que no es JSON (HTML de un error o un 302 sin seguir) queda uncertain', async () => {
    const cases: Array<[string, number, string]> = [
      ['<!DOCTYPE html><html><body>Error del script</body></html>', 200, 'respuesta no JSON (HTTP 200)'],
      ['<html>Bad Gateway</html>', 502, 'respuesta no JSON (HTTP 502)'],
      ['<HTML><HEAD><TITLE>Moved Temporarily</TITLE></HEAD></HTML>', 302, 'respuesta no JSON (HTTP 302)'],
      ['', 200, 'respuesta no JSON (HTTP 200)'],
    ];
    for (const [text, status, reason] of cases) {
      vi.stubGlobal('fetch', relay(text, status, 'https://script.google.com/macros/s/prueba/exec'));
      await expect(sendShippingNotice(VECTOR_REQUEST), reason).resolves.toEqual({ status: 'uncertain', reason });
    }
  });

  it('la página de inicio de sesión de Google o un 401/403/404: el script no corrió (rejected)', async () => {
    vi.stubGlobal('fetch', relay('<!DOCTYPE html><html><title>Iniciar sesión: Cuentas de Google</title></html>', 200,
      'https://accounts.google.com/v3/signin/identifier?continue=https%3A%2F%2Fscript.google.com'));
    await expect(sendShippingNotice(VECTOR_REQUEST)).resolves.toEqual({ status: 'rejected', reason: 'página de inicio de sesión de Google' });
    for (const status of [401, 403, 404]) {
      vi.stubGlobal('fetch', relay('<html>No encontrado</html>', status, 'https://script.google.com/macros/s/prueba/exec'));
      await expect(sendShippingNotice(VECTOR_REQUEST)).resolves.toEqual({ status: 'rejected', reason: 'respuesta no JSON (HTTP ' + status + ')' });
    }
  });

  it('variables faltantes o mal puestas: config, sin llamar al relay y sin lanzar', async () => {
    vi.stubGlobal('fetch', relay('{"status":"ok"}'));
    const cases: Array<[string | undefined, string | undefined, string]> = [
      [undefined, VECTOR.secret, 'falta SHIPPING_RELAY_URL'],
      ['  ', VECTOR.secret, 'falta SHIPPING_RELAY_URL'],
      ['no es una url', VECTOR.secret, 'SHIPPING_RELAY_URL no válida'],
      ['http://script.google.com/macros/s/prueba/exec', VECTOR.secret, 'SHIPPING_RELAY_URL no válida'],
      ['https://relay.example.test/exec', undefined, 'falta SHIPPING_RELAY_SECRET'],
      ['https://relay.example.test/exec', '', 'falta SHIPPING_RELAY_SECRET'],
      ['https://relay.example.test/exec', 'corto', 'SHIPPING_RELAY_SECRET demasiado corto'],
    ];
    for (const [url, secret, reason] of cases) {
      vi.stubEnv('SHIPPING_RELAY_URL', url);
      vi.stubEnv('SHIPPING_RELAY_SECRET', secret);
      await expect(sendShippingNotice(VECTOR_REQUEST), reason).resolves.toEqual({ status: 'config', reason });
    }
    expect(fetch).not.toHaveBeenCalled();
    expect(logged()).toContain('Shipping relay: status config: falta SHIPPING_RELAY_SECRET');
  });

  it('un pedido que el relay rechazaría no sale del servidor', async () => {
    vi.stubGlobal('fetch', relay('{"status":"ok"}'));
    const big = Buffer.alloc(MAX_RELAY_ATTACHMENT_BYTES / 2 + 1);
    big.write('%PDF-');
    const cases: Array<[unknown, string]> = [
      [null, 'acción no válida'],
      [{ ...VECTOR_REQUEST, action: 'enviar' }, 'acción no válida'],
      [{ ...VECTOR_REQUEST, key: 'abc' }, 'clave no válida'],
      [{ ...VECTOR_REQUEST, key: VECTOR_REQUEST.key.toUpperCase() }, 'clave no válida'],
      [{ ...VECTOR_REQUEST, to: 'uno@example.com, dos@example.com' }, 'destinatario no válido'],
      [{ ...VECTOR_REQUEST, to: 'Cliente <uno@example.com>' }, 'destinatario no válido'],
      [{ ...VECTOR_REQUEST, to: 'sin-arroba' }, 'destinatario no válido'],
      [{ ...VECTOR_REQUEST, subject: 'Asunto\r\nBcc: otro@example.com' }, 'asunto no válido'],
      [{ ...VECTOR_REQUEST, subject: '  ' }, 'asunto no válido'],
      [{ ...VECTOR_REQUEST, html: '' }, 'texto del correo no válido'],
      [{ ...VECTOR_REQUEST, text: undefined }, 'texto del correo no válido'],
      [{ ...VECTOR_REQUEST, attachments: undefined }, 'adjuntos no válidos'],
      [{ ...VECTOR_REQUEST, attachments: [...VECTOR_REQUEST.attachments, ...VECTOR_REQUEST.attachments, ...VECTOR_REQUEST.attachments] }, 'adjuntos no válidos'],
      [{ ...VECTOR_REQUEST, attachments: [{ name: 'Factura-1234.pdf', mimeType: 'image/png', data: PDF }] }, 'adjuntos no válidos'],
      [{ ...VECTOR_REQUEST, attachments: [{ name: 'Factura-1234.jpg', mimeType: 'application/pdf', data: PDF }] }, 'adjuntos no válidos'],
      [{ ...VECTOR_REQUEST, attachments: [{ name: 'Factura.pdf', mimeType: 'application/zip', data: PDF }] }, 'adjuntos no válidos'],
      [{ ...VECTOR_REQUEST, attachments: [{ name: '../Factura.pdf', mimeType: 'application/pdf', data: PDF }] }, 'adjuntos no válidos'],
      [{ ...VECTOR_REQUEST, attachments: [{ name: 'Factura.pdf', mimeType: 'application/pdf', data: Buffer.alloc(0) }] }, 'adjuntos no válidos'],
      [{ ...VECTOR_REQUEST, attachments: [{ name: 'Factura.pdf', mimeType: 'application/pdf', data: 'JVBERi0=' }] }, 'adjuntos no válidos'],
      [{ ...VECTOR_REQUEST, attachments: [
        { name: 'Factura-1.pdf', mimeType: 'application/pdf', data: big },
        { name: 'Factura-2.pdf', mimeType: 'application/pdf', data: big },
      ] }, 'adjuntos no válidos'],
    ];
    for (const [req, reason] of cases) {
      expect(validateShippingRequest(req), reason).toBe(reason);
      await expect(sendShippingNotice(req as ShippingNoticeRequest), reason).resolves.toEqual({ status: 'rejected', reason });
    }
    expect(fetch).not.toHaveBeenCalled();
    // Sin adjuntos y con el tope justo sí se acepta.
    expect(validateShippingRequest({ ...VECTOR_REQUEST, attachments: [] })).toBeNull();
    const exact = Buffer.alloc(MAX_RELAY_ATTACHMENT_BYTES / 2);
    exact.write('%PDF-');
    expect(validateShippingRequest({ ...VECTOR_REQUEST, attachments: [
      { name: 'Factura-1.pdf', mimeType: 'application/pdf', data: exact },
      { name: 'Factura-2.pdf', mimeType: 'application/pdf', data: exact },
    ] })).toBeNull();
  });

  it('los registros no llevan el correo, el nombre, el asunto, el cuerpo ni los adjuntos', async () => {
    const outcomes = ['{"status":"ok"}', '{"status":"duplicate"}', '{"status":"quota"}', '{"status":"rejected","reason":"para"}', '<html>error</html>'];
    for (const text of outcomes) {
      vi.stubGlobal('fetch', relay(text));
      await sendShippingNotice(VECTOR_REQUEST);
    }
    vi.stubGlobal('fetch', hangingFetch());
    await sendShippingNotice(VECTOR_REQUEST, { timeoutMs: 20 });
    await sendShippingNotice({ ...VECTOR_REQUEST, to: 'mal correo cliente.prueba@example.com' });
    const text = logged();
    expect(text.split('\n')).toHaveLength(7);
    for (const value of ['cliente.prueba@example.com', 'Prueba', 'Factura', 'camino', 'JVBERi0', VECTOR_REQUEST.key, VECTOR.secret]) {
      expect(text).not.toContain(value);
    }
    expect(text).toContain('c4ea6a81');
  });

  it('aunque el relay repita los datos del cliente en su respuesta, el log no los lleva', async () => {
    const echo = 'Invalid email: cliente.prueba@example.com | Persona Ficticia | +56 9 1234 5678';
    for (const text of [
      JSON.stringify({ status: 'rejected', reason: echo }),
      JSON.stringify({ status: echo }),
      JSON.stringify({ status: 'PersonaFicticia', reason: 'firma' }),
      '<html><body>' + echo + '</body></html>',
    ]) {
      vi.stubGlobal('fetch', relay(text, 500));
      const result = await sendShippingNotice(VECTOR_REQUEST);
      expect(JSON.stringify(result)).not.toContain('cliente.prueba');
    }
    const text = logged();
    for (const value of ['cliente.prueba@example.com', 'Persona Ficticia', 'PersonaFicticia', '1234 5678', 'Invalid email']) {
      expect(text).not.toContain(value);
    }
    expect(text).toContain('Shipping relay: status rejected: motivo no reconocido');
    expect(text).toContain('Shipping relay: status uncertain: status no reconocido');
    expect(text).toContain('Shipping relay: status uncertain: respuesta no JSON (HTTP 500)');
  });
});

describe('sendShippingNotice con un servidor HTTP local (redirección real de Apps Script)', () => {
  let server: Server;
  const seen: Array<{ method: string; url: string; body: string }> = [];

  beforeEach(async () => {
    seen.length = 0;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Como Apps Script: el POST a /exec responde 302 a otra URL, que entrega el resultado por GET.
    server = createServer((req: IncomingMessage, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        seen.push({ method: req.method ?? '', url: req.url ?? '', body });
        if (req.url === '/macros/s/prueba/exec') {
          res.writeHead(302, { Location: '/macros/echo?user_content_key=prueba' });
          res.end('<HTML><HEAD><TITLE>Moved Temporarily</TITLE></HEAD></HTML>');
        } else if (req.url?.startsWith('/macros/echo')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('{"status":"ok"}');
        } else {
          res.writeHead(404);
          res.end('<html>404</html>');
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    vi.stubEnv('SHIPPING_RELAY_URL', `http://127.0.0.1:${port}/macros/s/prueba/exec`);
    vi.stubEnv('SHIPPING_RELAY_SECRET', VECTOR.secret);
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('sigue el 302 (POST y después GET) y lee el resultado', async () => {
    await expect(sendShippingNotice(VECTOR_REQUEST, AT_VECTOR_TS)).resolves.toEqual({ status: 'ok' });
    expect(seen.map((r) => r.method + ' ' + r.url)).toEqual(['POST /macros/s/prueba/exec', 'GET /macros/echo?user_content_key=prueba']);
    expect(seen[0].body).toBe(JSON.stringify({ ts: VECTOR.ts, payload: VECTOR.payload, sig: VECTOR.sig }));
  });

  it('una implementación que no existe (404) no se da por enviada', async () => {
    vi.stubEnv('SHIPPING_RELAY_URL', process.env.SHIPPING_RELAY_URL!.replace('/prueba/', '/otra/'));
    await expect(sendShippingNotice(VECTOR_REQUEST)).resolves.toEqual({ status: 'rejected', reason: 'respuesta no JSON (HTTP 404)' });
  });

  it('el puerto muerto de vitest.api.config.ts da un error de red (uncertain), nunca un envío', async () => {
    vi.unstubAllEnvs();
    vi.stubEnv('SHIPPING_RELAY_SECRET', VECTOR.secret);
    const result = await sendShippingNotice(VECTOR_REQUEST, { timeoutMs: 2_000 });
    expect(result.status).toBe('uncertain');
  });
});

// ── Code.gs en una VM con lo mínimo de Apps Script ───────────────────────────
// Simula Utilities y ContentService con las mismas formas que documenta Google (bytes con signo
// de -128 a 127, HMAC y SHA-256 del texto en UTF-8). Así testDoPost corre en cada CI y el
// servidor y el relay no pueden dejar de entenderse sin que falle una prueba. Gmail, la cuota,
// el candado, las propiedades y CacheService los simula el propio testDoPost (entornoDePrueba):
// esta VM no tiene GmailApp ni CacheService.

interface CodeGsEnv {
  envios: Array<{ para: string; asunto: string; opciones: { attachments?: Array<{ mimeType: string; name: string }> } }>;
  guardadas: Record<string, string>;
  huellas: Record<string, { valor: string; segundos: number }>;
  fallar: boolean | string;
  fallarGuardar: string | null;
  fallarBorrar: boolean;
  fallarLeer: boolean;
  fallarCache: null | 'abrir' | 'get' | 'put' | 'remove';
  enviar: (...args: unknown[]) => void;
}

interface CodeGs {
  testDoPost(): void;
  procesar(cuerpo: string, entorno: unknown): { status: string; reason?: string };
  entornoDePrueba(opciones: { bcc?: string }, lineas: string[]): CodeGsEnv;
  doGet(): { getContent(): string };
}

function loadCodeGs(logs: string[] = []): CodeGs {
  const signed = (buf: Buffer) => Array.from(buf, (b) => (b > 127 ? b - 256 : b));
  const context = vm.createContext({
    console: { log: (line: string) => logs.push(String(line)) },
    Utilities: {
      Charset: { UTF_8: 'UTF_8' },
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      computeHmacSha256Signature: (value: string, key: string, charset: string) => {
        if (charset !== 'UTF_8') throw new Error('charset inesperado');
        return signed(createHmac('sha256', Buffer.from(key, 'utf8')).update(value, 'utf8').digest());
      },
      computeDigest: (algorithm: string, value: string, charset: string) => {
        if (algorithm !== 'SHA_256' || charset !== 'UTF_8') throw new Error('algoritmo o charset inesperado');
        return signed(createHash('sha256').update(value, 'utf8').digest());
      },
      base64Decode: (text: string) => signed(Buffer.from(text, 'base64')),
      base64Encode: (text: string) => Buffer.from(text, 'utf8').toString('base64'),
      newBlob: (bytes: number[], mimeType: string, name: string) => ({ bytes, mimeType, name }),
    },
    ContentService: {
      MimeType: { JSON: 'JSON' },
      createTextOutput: (content: string) => {
        const output = { getContent: () => content, setMimeType: () => output };
        return output;
      },
    },
  });
  vm.runInContext(readFileSync(new URL('../../../apps-script/aviso-despacho/Code.gs', import.meta.url), 'utf8'), context);
  return context as unknown as CodeGs;
}

describe('apps-script/aviso-despacho/Code.gs (VM)', () => {
  it('testDoPost pasa: firma, reserva de la clave, reintento, duplicate, reenvío del mismo cuerpo, vista previa, rechazos, cuota y limpieza', () => {
    const logs: string[] = [];
    const gs = loadCodeGs(logs);
    expect(() => gs.testDoPost()).not.toThrow();
    expect(logs.at(-1)).toMatch(/^testDoPost: \d+ verificaciones OK/);
  });

  it('acepta lo que arma y firma el servidor: despacho con factura y comprobante, y vista previa', () => {
    const gs = loadCodeGs();
    const lines: string[] = [];
    const env = gs.entornoDePrueba({}, lines);
    const withVoucher: ShippingNoticeRequest = {
      ...VECTOR_REQUEST,
      key: shippingNoticeKey(4242, 'starken', 'ABC999'),
      attachments: [...VECTOR_REQUEST.attachments, { name: 'Comprobante-Starken-ABC999.png', mimeType: 'image/png', data: PNG }],
    };
    expect(gs.procesar(buildRelayBody(withVoucher, VECTOR.secret, VECTOR.ts), env)).toEqual({ status: 'ok' });
    // El mismo cuerpo firmado o uno nuevo (otro ts) con la misma clave: duplicate, por la clave durable.
    expect(gs.procesar(buildRelayBody(withVoucher, VECTOR.secret, VECTOR.ts), env)).toEqual({ status: 'duplicate' });
    expect(gs.procesar(buildRelayBody(withVoucher, VECTOR.secret, VECTOR.ts + 1), env)).toEqual({ status: 'duplicate' });
    const preview: ShippingNoticeRequest = { ...VECTOR_REQUEST, action: 'preview', to: '' };
    expect(gs.procesar(buildRelayBody(preview, VECTOR.secret, VECTOR.ts), env)).toEqual({ status: 'ok' });
    expect(env.envios.map((s) => s.para)).toEqual(['cliente.prueba@example.com', 'dueno.prueba@example.com']);
    expect(env.envios[0].asunto).toBe(VECTOR_REQUEST.subject);
    expect(env.envios[1].asunto).toBe('[Vista previa] ' + VECTOR_REQUEST.subject);
    expect(env.envios[0].opciones.attachments?.map((a) => a.name)).toEqual(['Factura-1234.pdf', 'Comprobante-Starken-ABC999.png']);
    // Con otro secreto, nada.
    const other = gs.entornoDePrueba({}, lines);
    expect(gs.procesar(buildRelayBody(VECTOR_REQUEST, VECTOR.secret.replace('prueba', 'otra'), VECTOR.ts), other)).toEqual({ status: 'rejected', reason: 'firma' });
    expect(other.envios).toHaveLength(0);
    // Todo código que responde Code.gs (rechazo('x') o reason: 'x') tiene su motivo en el servidor.
    const codeGs = readFileSync(new URL('../../../apps-script/aviso-despacho/Code.gs', import.meta.url), 'utf8');
    const codes = new Set([...codeGs.matchAll(/rechazo\('([a-z]+)'\)|reason: '([a-z]+)'/g)].map((m) => m[1] ?? m[2]));
    expect(codes.size).toBeGreaterThan(12);
    expect([...codes]).toEqual(expect.arrayContaining(['almacenamiento', 'pendiente', 'reenvio', 'cache']));
    for (const code of codes) {
      expect(relayReason(code), code).not.toBe('motivo no reconocido');
    }
  });

  describe('sendShippingNotice contra Code.gs (fetch corre procesar en la VM)', () => {
    let gs: CodeGs;
    let env: CodeGsEnv;
    const bodies: string[] = [];

    beforeEach(() => {
      vi.stubEnv('SHIPPING_RELAY_URL', 'https://relay.example.test/macros/s/prueba/exec');
      vi.stubEnv('SHIPPING_RELAY_SECRET', VECTOR.secret);
      vi.spyOn(console, 'log').mockImplementation(() => {});
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      gs = loadCodeGs();
      env = gs.entornoDePrueba({}, []);
      bodies.length = 0;
      vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(init.body as string);
        return { ok: true, status: 200, url: 'https://script.googleusercontent.com/macros/echo', text: async () => JSON.stringify(gs.procesar(init.body as string, env)) } as unknown as Response;
      }));
    });
    afterEach(() => {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });

    /** El servidor reenvía exactamente el último cuerpo (lo que haría un proxy o un reintento de red). */
    const replay = () => gs.procesar(bodies.at(-1)!, env);

    it('almacenamiento lleno antes de enviar: rejected, sin correo; con espacio otra vez sale una sola vez', async () => {
      env.fallarGuardar = '';
      await expect(sendShippingNotice(VECTOR_REQUEST, AT_VECTOR_TS)).resolves.toEqual({ status: 'rejected', reason: 'el relay no pudo reservar la clave' });
      expect(env.envios).toHaveLength(0);
      env.fallarGuardar = null;
      await expect(sendShippingNotice(VECTOR_REQUEST, AT_VECTOR_TS)).resolves.toEqual({ status: 'ok' });
      await expect(sendShippingNotice(VECTOR_REQUEST, { now: () => VECTOR.ts * 1000 + 1000 })).resolves.toEqual({ status: 'duplicate' });
      expect(env.envios).toHaveLength(1);
    });

    it('falla el paso a «enviado»: ok; el mismo cuerpo y el reintento responden uncertain (pendiente), sin un segundo correo', async () => {
      env.fallarGuardar = 'enviado:';
      await expect(sendShippingNotice(VECTOR_REQUEST, AT_VECTOR_TS)).resolves.toEqual({ status: 'ok' });
      expect(env.guardadas['aviso:' + VECTOR_REQUEST.key]).toBe('pendiente:' + VECTOR.ts * 1000);
      expect(replay()).toEqual({ status: 'uncertain', reason: 'pendiente' });
      await expect(sendShippingNotice(VECTOR_REQUEST, { now: () => VECTOR.ts * 1000 + 1000 })).resolves.toEqual({
        status: 'uncertain',
        reason: 'clave pendiente en el relay (revisar Enviados)',
      });
      expect(env.envios).toHaveLength(1);
    });

    it('la ejecución se corta antes de Gmail (despacho): el mismo cuerpo y uno nuevo dan uncertain/pendiente, nunca duplicate', () => {
      // Corte real: el plazo de la VM termina la ejecución dentro de enviar, sin correr catch ni finally (como Apps Script).
      const context = gs as unknown as vm.Context & { cuerpoCorte: string; entornoCorte: CodeGsEnv };
      context.cuerpoCorte = buildRelayBody(VECTOR_REQUEST, VECTOR.secret, VECTOR.ts);
      vm.runInContext('entornoCorte = entornoDePrueba({}, []); entornoCorte.enviar = function () { for (;;) {} };', context);
      expect(() => vm.runInContext('procesar(cuerpoCorte, entornoCorte)', context, { timeout: 200 })).toThrow(/timed out/i);
      const cut = context.entornoCorte;
      expect(cut.envios).toHaveLength(0);
      expect(cut.guardadas['aviso:' + VECTOR_REQUEST.key]).toBe('pendiente:' + VECTOR.ts * 1000);
      cut.enviar = () => { throw new Error('no debería enviar'); };
      expect(gs.procesar(context.cuerpoCorte, cut)).toEqual({ status: 'uncertain', reason: 'pendiente' });
      expect(gs.procesar(buildRelayBody(VECTOR_REQUEST, VECTOR.secret, VECTOR.ts + 1), cut)).toEqual({ status: 'uncertain', reason: 'pendiente' });
      expect(cut.huellas).toEqual({});
    });

    it('la ejecución se corta antes de Gmail (vista previa): el mismo cuerpo da rejected/reenvio (nunca «salió»); uno nuevo sale', () => {
      const context = gs as unknown as vm.Context & { cuerpoCorte: string; entornoCorte: CodeGsEnv };
      const preview: ShippingNoticeRequest = { ...VECTOR_REQUEST, action: 'preview', to: '' };
      context.cuerpoCorte = buildRelayBody(preview, VECTOR.secret, VECTOR.ts);
      vm.runInContext('entornoCorte = entornoDePrueba({}, []); entornoCorte.enviar = function () { for (;;) {} };', context);
      expect(() => vm.runInContext('procesar(cuerpoCorte, entornoCorte)', context, { timeout: 200 })).toThrow(/timed out/i);
      const cut = context.entornoCorte;
      expect(cut.envios).toHaveLength(0);
      expect(gs.procesar(context.cuerpoCorte, cut)).toEqual({ status: 'rejected', reason: 'reenvio' });
      cut.enviar = () => {}; // sin el bucle del corte
      expect(gs.procesar(buildRelayBody(preview, VECTOR.secret, VECTOR.ts + 1), cut)).toEqual({ status: 'ok' });
    });

    it('vista previa: Gmail falla y no se puede borrar la huella; sin caché para leer o guardar, no sale', async () => {
      const preview: ShippingNoticeRequest = { ...VECTOR_REQUEST, action: 'preview', to: '' };
      env.fallar = true;
      env.fallarCache = 'remove';
      await expect(sendShippingNotice(preview, AT_VECTOR_TS)).resolves.toEqual({ status: 'rejected', reason: 'Gmail no aceptó el envío' });
      env.fallar = false;
      expect(replay()).toEqual({ status: 'rejected', reason: 'reenvio' });
      expect(env.envios).toHaveLength(0);
      for (const falla of ['get', 'put', 'abrir'] as const) {
        const other = gs.entornoDePrueba({}, []);
        other.fallarCache = falla;
        env = other;
        await expect(sendShippingNotice(preview, AT_VECTOR_TS), falla).resolves.toEqual({ status: 'rejected', reason: 'caché del relay no disponible' });
        expect(other.envios, falla).toHaveLength(0);
        // El despacho no usa la caché: sale igual.
        await expect(sendShippingNotice(VECTOR_REQUEST, AT_VECTOR_TS), falla).resolves.toEqual({ status: 'ok' });
      }
    });

    it('reserva trabada de una ejecución que se cortó: uncertain, sin enviar', async () => {
      env.guardadas['aviso:' + VECTOR_REQUEST.key] = 'pendiente:' + (VECTOR.ts * 1000 - 60_000);
      await expect(sendShippingNotice(VECTOR_REQUEST, AT_VECTOR_TS)).resolves.toEqual({
        status: 'uncertain',
        reason: 'clave pendiente en el relay (revisar Enviados)',
      });
      expect(env.envios).toHaveLength(0);
    });

    it('una limpieza que falla no detiene el aviso', async () => {
      env.fallarLeer = true;
      await expect(sendShippingNotice(VECTOR_REQUEST, AT_VECTOR_TS)).resolves.toEqual({ status: 'ok' });
      expect(env.envios).toHaveLength(1);
    });

    it('el mismo cuerpo firmado otra vez: despacho duplicate (por la clave), vista previa rejected/reenvio; un sobre nuevo de vista previa sí sale', async () => {
      await expect(sendShippingNotice(VECTOR_REQUEST, AT_VECTOR_TS)).resolves.toEqual({ status: 'ok' });
      expect(replay()).toEqual({ status: 'duplicate' });
      const preview: ShippingNoticeRequest = { ...VECTOR_REQUEST, action: 'preview', to: '' };
      await expect(sendShippingNotice(preview, AT_VECTOR_TS)).resolves.toEqual({ status: 'ok' });
      expect(replay()).toEqual({ status: 'rejected', reason: 'reenvio' });
      await expect(sendShippingNotice(preview, { now: () => VECTOR.ts * 1000 + 1000 })).resolves.toEqual({ status: 'ok' });
      expect(env.envios.map((s) => s.para)).toEqual(['cliente.prueba@example.com', 'dueno.prueba@example.com', 'dueno.prueba@example.com']);
      // Solo la vista previa deja huella: dura lo que le queda a su ts dentro de los 5 minutos, más 60 s (el reloj del relay está fijo).
      expect(Object.values(env.huellas).map((h) => h.segundos)).toEqual([360, 361]);
    });
  });

  it('doGet responde el nombre del servicio, sin datos', () => {
    expect(JSON.parse(loadCodeGs().doGet().getContent())).toEqual({ servicio: 'aviso-despacho', version: 1 });
  });
});
