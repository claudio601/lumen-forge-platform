// api/_tests/shipping-notice.test.ts
// Aviso de despacho de punta a punta (spec Nivel 2, §3, §8 y §10 «Integración»): el webhook de
// Pipedrive y processShippingNotice con Upstash, Pipedrive y el relay SIMULADOS
// (fakeUpstash.ts, fakePipedrive.ts). Nunca el relay ni el Pipedrive reales; datos ficticios
// (shippingFixture.ts) y un catálogo inventado. Cada fila de la tabla de la §8 tiene su caso, y
// después de cada prueba se revisa que los registros no lleven el nombre, el correo, el teléfono,
// la orden ni los nombres de archivo. El dominio (SITE_URL distinto de elights.cl) va aparte, en
// shipping-notice-domain.test.ts. Vive en api/_tests/ para que Vercel no lo despliegue.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { pending } = vi.hoisted(() => ({ pending: [] as Promise<unknown>[] }));
vi.mock('@vercel/functions', () => ({ waitUntil: vi.fn((p: Promise<unknown>) => { pending.push(p); }) }));
vi.mock('../_lib/catalog/product-links.generated.js', async () => ({ SNAPSHOT_HASH: 'prueba', productLinks: (await import('./shippingFixture')).PRODUCT_LINKS }));
vi.mock('../_lib/catalog/price-index.generated.js', async () => ({ SNAPSHOT_HASH: 'prueba', priceIndex: (await import('./shippingFixture')).PRICE_INDEX }));
// Las escrituras y el relay, envueltos para ver sus argumentos (siguen siendo los de verdad).
vi.mock('../_lib/pipedrive/deals.js', async (importOriginal) => {
  const m = await importOriginal<typeof import('../_lib/pipedrive/deals.js')>();
  return { ...m, createDealNote: vi.fn(m.createDealNote), putDealFields: vi.fn(m.putDealFields) };
});
vi.mock('../_lib/notify/shippingRelay.js', async (importOriginal) => {
  const m = await importOriginal<typeof import('../_lib/notify/shippingRelay.js')>();
  return { ...m, sendShippingNotice: vi.fn(m.sendShippingNotice) };
});
vi.mock('../_lib/notify/salesEmail.js', async (importOriginal) => {
  const m = await importOriginal<typeof import('../_lib/notify/salesEmail.js')>();
  return { ...m, notifySales: vi.fn(m.notifySales) };
});

import handler from '../pipedrive/webhook';
import { createDealNote, putDealFields } from '../_lib/pipedrive/deals.js';
import { findDealFieldByName } from '../_lib/pipedrive/fieldOptions.js';
import { sendShippingNotice } from '../_lib/notify/shippingRelay.js';
import { notifySales } from '../_lib/notify/salesEmail.js';
import { SHIPPING_FIELD_NAMES } from '../_lib/shipping/fields.js';
import { MAX_DOCUMENT_BYTES } from '../_lib/shipping/files.js';
import { shippingNoticeKey } from '../_lib/shipping/key.js';
import {
  noticeDeadline,
  noticeEventKey,
  noticeLockKey,
  noticeStateKey,
  previewCountKey,
  previewMarkKey,
  processShippingNotice,
  MIN_RELAY_WINDOW_MS,
  NOTICE_EVENT_TTL_S,
  NOTICE_MAX_DURATION_S,
  PREVIEW_LIMIT,
} from '../_lib/shipping/notice.js';
import { jpgBytes, pdfBytes, pipedriveTime } from './fakePipedrive';
import { DEAL_ID, EMAIL, K, nextUpdateTime, NOW, OPT, OWNER_USER_ID, PERSONAL, PERSON_ID, requestNote, setupNoticeWorld, teardownNoticeWorld, type NoticeWorld } from './shippingFixture';
import { readFileSync } from 'node:fs';

let w: NoticeWorld;
const KEY = shippingNoticeKey(DEAL_ID, 'starken', '123456789');

beforeEach(() => {
  pending.length = 0;
  w = setupNoticeWorld();
  vi.mocked(createDealNote).mockClear();
  vi.mocked(putDealFields).mockClear();
  vi.mocked(sendShippingNotice).mockClear();
  vi.mocked(notifySales).mockClear();
});

afterEach(() => {
  // Privacidad (§7): en ningún caso los registros llevan datos del cliente, la orden ni archivos.
  const text = w.logs.join('\n');
  for (const secret of [...PERSONAL, 'token-ficticio-pipedrive', 'api_token']) expect(text, secret).not.toContain(secret);
  teardownNoticeWorld();
});

/**
 * El dueño elige una opción del disparador y llega el webhook (directo a processShippingNotice).
 * Cada elección trae otro `update_time`; para una reentrega, se pasa el mismo.
 */
function choose(option: 'preview' | 'send', startedAt = Date.now(), eventUpdateTime: string | null = nextUpdateTime()) {
  w.deal()[K.trigger] = OPT[option];
  return processShippingNotice({ dealId: DEAL_ID, triggerKey: K.trigger, triggerOptionId: OPT[option], startedAt, eventUpdateTime });
}

const lastNote = () => w.notes().at(-1) ?? '';
const despachos = () => w.relay.sent.filter((m) => m.action === 'despacho');
const previews = () => w.relay.sent.filter((m) => m.action === 'preview');
const noticeLog = () => w.logs.filter((l) => l.startsWith('[aviso-despacho] negocio='));

// ── Webhook ─────────────────────────────────────────────────────────────────

const USER = 'usuario-prueba';
const PASSWORD = 'clave-prueba';

/** `update_time` de los cuerpos del webhook (el mismo cuerpo dos veces es una reentrega). */
const EVENT_TIME = '2026-11-18T15:00:00Z';

function webhookBody(
  optionId: number | null,
  previousOption: number | null = null,
  extra: { previous?: Record<string, unknown>; data?: Record<string, unknown>; meta?: Record<string, unknown> } = {},
) {
  return {
    meta: { action: 'change', entity: 'deal', entity_id: String(DEAL_ID), company_id: '777001', is_bulk_edit: false, version: '2.0', change_source: 'app', attempt: 1, ...extra.meta },
    data: {
      id: DEAL_ID, status: 'open', stage_id: 21, pipeline_id: 2, update_time: EVENT_TIME,
      custom_fields: { [K.trigger]: optionId === null ? null : { type: 'enum', id: optionId } },
      ...extra.data,
    },
    previous: extra.previous ?? { custom_fields: { [K.trigger]: previousOption === null ? null : { type: 'enum', id: previousOption } } },
  };
}

async function webhook(body: unknown) {
  const res = { statusCode: 0, status(code: number) { this.statusCode = code; return this; }, json() { return this; } };
  const auth = 'Basic ' + Buffer.from(`${USER}:${PASSWORD}`).toString('base64');
  await handler({ method: 'POST', headers: { authorization: auth }, body } as never, res as never);
  return res;
}

async function flush() {
  while (pending.length) await Promise.all(pending.splice(0));
}

describe('webhook → aviso', () => {
  beforeEach(() => {
    vi.stubEnv('PIPEDRIVE_WEBHOOK_USER', USER);
    vi.stubEnv('PIPEDRIVE_WEBHOOK_PASSWORD', PASSWORD);
    vi.stubEnv('PIPEDRIVE_PIPELINE_ID', '2');
  });

  it('el webhook responde 200 y el aviso sale en segundo plano', async () => {
    w.deal()[K.trigger] = OPT.send;
    const res = await webhook(webhookBody(OPT.send));
    expect(res.statusCode).toBe(200);
    await flush();
    expect(despachos()).toHaveLength(1);
    expect(w.deal()[K.trigger]).toBeNull();
  });

  it('§8 doble webhook (reintento o doble guardado): dos en paralelo dejan un solo envío', async () => {
    w.deal()[K.trigger] = OPT.send;
    await Promise.all([webhook(webhookBody(OPT.send)), webhook(webhookBody(OPT.send))]);
    await flush();
    expect(despachos()).toHaveLength(1);
    expect(w.relay.calls).toBe(1);
    expect(w.notes().filter((n) => n.startsWith('Aviso de despacho enviado'))).toHaveLength(1);
    expect(noticeLog().filter((l) => l.includes('resultado=candado_tomado'))).toHaveLength(1);
  });

  it('§8 un disparador que quedó puesto y el dueño edita otro campo: nada', async () => {
    w.deal()[K.trigger] = OPT.send;
    await webhook(webhookBody(OPT.send, null, {
      data: { custom_fields: { [K.trigger]: { type: 'enum', id: OPT.send }, [K.order]: { type: 'varchar', value: 'x' } } },
      previous: { custom_fields: { [K.order]: { type: 'varchar', value: 'y' } } },
    }));
    await flush();
    expect(w.relay.calls).toBe(0);
    expect(w.notes()).toEqual([]);
    expect(w.deal()[K.trigger]).toBe(OPT.send);
  });

  it('§8 etapa movida a mano a «Despachado»: nada (el disparador es el campo)', async () => {
    await webhook(webhookBody(null, null, { data: { stage_id: 25, custom_fields: {} }, previous: { stage_id: 21 } }));
    await flush();
    expect(w.relay.calls).toBe(0);
    expect(w.notes()).toEqual([]);
    expect(w.pd.requests.filter((r) => r.method !== 'GET')).toEqual([]);
  });

  it('el disparador vaciado por el servidor no vuelve a procesar (sin bucle)', async () => {
    await choose('send');
    await webhook(webhookBody(null, OPT.send));
    await flush();
    expect(w.relay.calls).toBe(1);
  });
});

// ── Vista previa ────────────────────────────────────────────────────────────

describe('vista previa', () => {
  it('va solo a la acción preview (sin el correo del cliente), deja la nota corta y vacía el disparador', async () => {
    expect(await choose('preview')).toBe('vista_previa_enviada');
    expect(previews()).toHaveLength(1);
    expect(despachos()).toHaveLength(0);
    const mail = previews()[0];
    expect(mail.to).toBeNull();
    expect(mail.subject).toMatch(/^\[Vista previa\] /);
    expect(mail.attachments.map((a) => a.name)).toEqual(['Factura-1234.pdf', 'Comprobante-Starken-123456789.jpg']);
    expect(lastNote()).toMatch(/^Vista previa enviada a tu correo \(2026-11-18 12:00, hora de Chile\)/);
    expect(lastNote()).toContain('Adjuntos: Factura-1234.pdf (2 KB), Comprobante-Starken-123456789.jpg (4 KB)');
    expect(lastNote()).toContain('Para enviarlo al cliente, elige «Enviar al cliente»');
    expect(w.deal()[K.trigger]).toBeNull();
    // La vista previa no escribe «Aviso enviado» ni cambia la etapa, y no usa la clave de envío.
    expect(w.deal()[K.sentLog]).toBeNull();
    expect(w.deal().stage_id).toBe(21);
    expect(w.redis.data.has(noticeStateKey(KEY))).toBe(false);
    expect(w.redis.data.get(previewMarkKey(KEY))?.ttl).toBe(86_400);
    expect(w.redis.data.has(noticeLockKey(DEAL_ID))).toBe(false);
  });

  it(`hasta ${PREVIEW_LIMIT} por negocio por hora (contador en Redis)`, async () => {
    for (let i = 0; i < PREVIEW_LIMIT; i++) expect(await choose('preview')).toBe('vista_previa_enviada');
    expect(await choose('preview')).toBe('limite_vistas_previas');
    expect(previews()).toHaveLength(PREVIEW_LIMIT);
    expect(lastNote()).toContain(`ya van ${PREVIEW_LIMIT} vistas previas`);
    expect(w.deal()[K.trigger]).toBeNull();
    expect(w.redis.data.get(previewCountKey(DEAL_ID))?.ttl).toBe(3_600);
  });

  it('sin «Despacho · Productos», usa los productos de la solicitud RC- (por id, nunca su nombre ni su url)', async () => {
    w.deal()[K.products] = null;
    w.pd.notes.push({ id: 10, deal_id: DEAL_ID, content: requestNote(), add_time: pipedriveTime(new Date(NOW.getTime() - 86_400_000)) });
    await choose('preview');
    expect(previews()[0].text).toContain('Proyector prueba 50W – cálida 3000K');
    expect(previews()[0].text).not.toContain('IGNORADO');
    expect(previews()[0].html).not.toContain('otro.example');
    expect(lastNote()).toContain('Productos: los de la solicitud RC-ab12c');
    expect(lastNote()).toContain('vale para «Enviar al cliente» durante 24 horas');
  });

  it('el relay responde quota o rejected: nota, ATENCIÓN a ventas@ y el disparador vacío', async () => {
    w.relay.mode = 'quota';
    expect(await choose('preview')).toBe('vista_previa_rechazada');
    expect(lastNote()).toContain('Vista previa NO enviada: se acabó la cuota diaria');
    expect(w.redis.mails).toHaveLength(1);
    expect(w.redis.mails[0].items_lista).toMatch(/^ATENCIÓN: la vista previa del aviso de despacho NO salió/);
    expect(w.deal()[K.trigger]).toBeNull();
  });

  it('el relay rechaza con «reenvio» o «cache»: no salió, «reintenta en unos minutos», sin ATENCIÓN', async () => {
    w.relay.mode = 'rejected';
    for (const [code, reason] of [['reenvio', 'reenvío del mismo cuerpo firmado'], ['cache', 'caché del relay no disponible']]) {
      w.relay.rejectReason = code;
      expect(await choose('preview')).toBe('reintentar');
      expect(lastNote()).toContain(`Aviso de despacho NO enviado («Vista previa»): el relay no la envió ahora (${reason}).`);
      expect(lastNote()).toContain('Reintenta en unos minutos');
      expect(w.deal()[K.trigger]).toBeNull();
    }
    expect(w.redis.mails).toHaveLength(0);
    expect(w.redis.data.has(previewMarkKey(KEY))).toBe(false);
  });

  it('una opción de operador recién agregada refresca /dealFields una vez y sale', async () => {
    await findDealFieldByName(SHIPPING_FIELD_NAMES.trigger);
    w.pd.dealFields = (await import('./shippingFixture')).dealFields({ withMena: true });
    w.deal()[K.carrier] = OPT.mena;
    expect(await choose('preview')).toBe('vista_previa_enviada');
    expect(previews()[0].attachments[1].name).toBe('Comprobante-Transportes-Mena-123456789.jpg');
    expect(w.pd.requests.filter((r) => r.path === '/dealFields')).toHaveLength(2);
    expect(noticeLog().at(-1)).toContain('campos=refresco');
  });
});

// ── Enviar al cliente ───────────────────────────────────────────────────────

describe('enviar al cliente', () => {
  it('un correo al cliente, la nota completa, «Aviso enviado», la etapa «Despachado» y el disparador vacío, en un solo PUT', async () => {
    expect(await choose('send')).toBe('enviado');
    expect(despachos()).toHaveLength(1);
    const mail = despachos()[0];
    expect(mail.to).toBe(EMAIL);
    expect(mail.key).toBe(KEY);
    expect(mail.subject).not.toContain('[Vista previa]');
    expect(mail.text).toContain('Hola Juana,');
    expect(mail.text).toContain('Panel prueba 60X60');
    expect(w.notes()).toHaveLength(1);
    expect(w.notes()[0].split('\n')).toEqual([
      'Aviso de despacho enviado (2026-11-18 12:00, hora de Chile)',
      'Operador: Starken | Orden de flete: 123.456.789',
      'Entrega: Retiro en agencia, Temuco | Estimada: sin fecha',
      'Flete: Por pagar, $14.460 (lo cobra el operador; no es parte del negocio)',
      'Bultos: 1 | Kilos: 3,2 | Factura N° 1234',
      `Productos (de «${SHIPPING_FIELD_NAMES.products}»):`,
      '- 10 x PAN60 Panel prueba 60X60',
      'Adjuntos: Factura-1234.pdf (2 KB), Comprobante-Starken-123456789.jpg (4 KB)',
      'Enviado al correo principal de la persona del negocio (o al primero de su lista, si ninguno es principal).',
      'Etapa: «Despachado».',
      `aviso_despacho_key: ${KEY}`,
    ]);
    const puts = vi.mocked(putDealFields).mock.calls;
    expect(puts).toHaveLength(1);
    expect(puts[0][1]).toEqual({ [K.sentLog]: '2026-11-18 12:00 -03:00 · Starken 123456789', [K.trigger]: null, stage_id: 25 });
    expect(w.deal()[K.sentLog]).toBe('2026-11-18 12:00 -03:00 · Starken 123456789');
    expect(w.deal()[K.trigger]).toBeNull();
    expect(w.deal().stage_id).toBe(25);
    // El valor del negocio nunca se toca (sigue CON IVA).
    expect(w.deal().value).toBe(123456);
    for (const r of w.pd.requests) expect(r.body ?? {}).not.toHaveProperty('value');
    expect(w.redis.data.get(noticeStateKey(KEY))?.value).toBe(`sent:${NOW.toISOString()}`);
    expect(w.redis.data.get(noticeStateKey(KEY))?.ttl).toBe(400 * 86_400);
    expect(noticeLog().at(-1)).toBe(`[aviso-despacho] negocio=${DEAL_ID} accion=send clave=${KEY.slice(0, 8)} resultado=enviado estado=none productos=field:1 adjuntos=2 relay=ok etapa=ok nota=ok put=ok`);
  });

  it('un negocio del embudo 1 pasa a su «Despachado»; uno del embudo 3 (sin esa etapa) solo deja la nota', async () => {
    w.deal().pipeline_id = 1;
    w.deal().stage_id = 20;
    await choose('send');
    expect(w.deal().stage_id).toBe(24);

    w.deal().pipeline_id = 3;
    w.deal().stage_id = 30;
    w.deal()[K.order] = '555';
    vi.setSystemTime(NOW.getTime() + 5 * 60_000);
    w.addFile('factura-1234-b.pdf', pdfBytes(), { add_time: pipedriveTime(new Date(NOW.getTime() + 2 * 60_000)) });
    w.addFile('voucher-starken-b.jpg', jpgBytes(), { add_time: pipedriveTime(new Date(NOW.getTime() + 2 * 60_000)) });
    expect(await choose('send')).toBe('enviado');
    expect(w.deal().stage_id).toBe(30);
    expect(lastNote()).toContain('Etapa: sin cambio (este embudo no tiene una etapa «Despachado»).');
    expect(vi.mocked(putDealFields).mock.calls.at(-1)?.[1]).not.toHaveProperty('stage_id');
  });

  it('guía de despacho: el asunto, el adjunto y la nota la nombran', async () => {
    w.deal()[K.documentType] = OPT.guia;
    w.deal()[K.documentNumber] = '291';
    w.pd.files[0].name = 'guia-291.pdf';
    await choose('send');
    expect(despachos()[0].subject).toContain('Guía de despacho N° 291');
    expect(despachos()[0].attachments[0].name).toBe('Guia-de-despacho-291.pdf');
    expect(w.notes()[0]).toContain('Bultos: 1 | Kilos: 3,2 | Guía de despacho N° 291');
  });

  it('sin productos (ni campo ni vista previa): sale igual, con la línea del documento adjunto', async () => {
    w.deal()[K.products] = null;
    w.pd.notes.push({ id: 10, deal_id: DEAL_ID, content: requestNote(), add_time: pipedriveTime(NOW) });
    expect(await choose('send')).toBe('enviado');
    expect(despachos()[0].text).toContain('Qué va en tu envío (1 bulto, 3,2 kg): el detalle de los productos va en la factura N° 1234 adjunta.');
    expect(despachos()[0].text).not.toContain('Proyector prueba');
    expect(lastNote()).toContain('Productos: sin lista (el correo dice que el detalle va en la factura N° 1234).');
    // Sin la marca de la vista previa, las notas no se leen.
    expect(w.pd.requests.some((r) => r.path === '/notes' && r.method === 'GET')).toBe(false);
  });

  it('sin el PDF de la factura (se envía antes del despacho, 19-11-2026): sale solo con la foto del comprobante', async () => {
    w.pd.files.splice(0, 1);
    w.deal()[K.products] = null;
    expect(await choose('send')).toBe('enviado');
    const sent = despachos()[0];
    expect(sent.attachments).toHaveLength(1);
    expect(sent.attachments[0].name).toMatch(/^Comprobante-Starken-\d+\.jpg$/);
    expect(sent.text).toContain('\nTe adjuntamos el comprobante de Starken.\n');
    expect(sent.text).toContain('el detalle de los productos va en la factura N° 1234.');
    expect(sent.text).not.toMatch(/en PDF|adjunta\b/);
    expect(lastNote()).toContain('Productos: sin lista (el correo dice que el detalle va en la factura N° 1234).');
  });

  it('vista previa y «Enviar al cliente» 30 s después: sí envía (el candado se soltó), con la lista de la solicitud', async () => {
    w.deal()[K.products] = null;
    w.pd.notes.push({ id: 10, deal_id: DEAL_ID, content: requestNote(), add_time: pipedriveTime(new Date(NOW.getTime() - 3_600_000)) });
    expect(await choose('preview')).toBe('vista_previa_enviada');
    vi.setSystemTime(NOW.getTime() + 30_000);
    expect(await choose('send')).toBe('enviado');
    expect(despachos()).toHaveLength(1);
    expect(despachos()[0].text).toContain('Proyector prueba 50W – cálida 3000K');
    expect(lastNote()).toContain('Productos (de la solicitud RC-ab12c):');
    expect(lastNote()).toContain('- 3 x Proyector prueba 50W – cálida 3000K');
  });

  it('la marca de la vista previa vence a las 24 h: después sale sin lista', async () => {
    w.deal()[K.products] = null;
    w.pd.notes.push({ id: 10, deal_id: DEAL_ID, content: requestNote(), add_time: pipedriveTime(new Date(NOW.getTime() - 3_600_000)) });
    await choose('preview');
    vi.setSystemTime(NOW.getTime() + 25 * 3_600_000);
    // Los archivos del día anterior siguen dentro de los 7 días.
    expect(await choose('send')).toBe('enviado');
    expect(despachos()[0].text).toContain('el detalle de los productos va en la factura N° 1234 adjunta.');
  });

  it('§8 el dueño elige «Enviar al cliente» otra vez con la misma orden: no envía y la nota dice cuándo salió', async () => {
    await choose('send');
    vi.setSystemTime(NOW.getTime() + 10 * 60_000);
    expect(await choose('send')).toBe('ya_enviado');
    expect(despachos()).toHaveLength(1);
    expect(w.relay.calls).toBe(1);
    expect(lastNote()).toBe('Aviso de despacho NO enviado: ya se envió el 2026-11-18 12:00 (hora de Chile) con Starken 123.456.789.\nPara corregir algo, escríbele desde Gmail.');
    expect(w.deal()[K.trigger]).toBeNull();
  });

  it('§8 capa 1 (Redis): aunque alguien borre «Aviso enviado», la clave en `sent` no deja reenviar', async () => {
    await choose('send');
    w.deal()[K.sentLog] = null;
    vi.setSystemTime(NOW.getTime() + 10 * 60_000);
    expect(await choose('send')).toBe('ya_enviado');
    expect(w.relay.calls).toBe(1);
    expect(lastNote()).toContain('ya se envió el 2026-11-18 12:00 (hora de Chile)');
  });

  it('§8 capa 3 (relay): sin Redis ni «Aviso enviado» al día, el relay responde duplicate: se registra sin un correo nuevo, y la nota lo dice', async () => {
    await choose('send');
    w.redis.data.delete(noticeStateKey(KEY));
    w.deal()[K.sentLog] = null;
    vi.setSystemTime(NOW.getTime() + 10 * 60_000);
    expect(await choose('send')).toBe('ya_habia_salido');
    expect(despachos()).toHaveLength(1);
    expect(w.relay.calls).toBe(2);
    expect(noticeLog().at(-1)).toMatch(/resultado=ya_habia_salido .*relay=duplicate/);
    const note = lastNote().split('\n');
    expect(note.slice(0, 2)).toEqual([
      'No salió un correo nuevo: el relay confirmó que el aviso anterior de este despacho ya había salido.',
      'Aviso de despacho ya había salido: registrado el 2026-11-18 12:10 (hora de Chile)',
    ]);
    expect(note).not.toContain('Enviado al correo principal de la persona del negocio (o al primero de su lista, si ninguno es principal).');
    // Se registra igual, para que no se reintente.
    expect(w.deal()[K.sentLog]).toBe('2026-11-18 12:10 -03:00 · Starken 123456789');
  });

  it('§8 dos envíos del mismo negocio: otra orden da otra clave y sale; «Aviso enviado» queda con el último', async () => {
    await choose('send');
    vi.setSystemTime(NOW.getTime() + 5 * 60_000);
    w.deal()[K.order] = '987654321';
    w.deal()[K.documentNumber] = '1250';
    w.addFile('factura-1250.pdf', pdfBytes(), { add_time: pipedriveTime(new Date(NOW.getTime() + 2 * 60_000)) });
    w.addFile('voucher-2.jpg', jpgBytes(), { add_time: pipedriveTime(new Date(NOW.getTime() + 2 * 60_000)) });
    expect(await choose('send')).toBe('enviado');
    expect(despachos()).toHaveLength(2);
    expect(despachos()[1].key).toBe(shippingNoticeKey(DEAL_ID, 'starken', '987654321'));
    expect(despachos()[1].attachments.map((a) => a.name)).toEqual(['Factura-1250.pdf', 'Comprobante-Starken-987654321.jpg']);
    expect(w.notes().filter((n) => n.startsWith('Aviso de despacho enviado'))).toHaveLength(2);
    expect(w.deal()[K.sentLog]).toBe('2026-11-18 12:05 -03:00 · Starken 987654321');
    // La etapa ya era «Despachado»: el segundo PUT no la repite.
    expect(vi.mocked(putDealFields).mock.calls[1][1]).toEqual({ [K.sentLog]: '2026-11-18 12:05 -03:00 · Starken 987654321', [K.trigger]: null });
  });

  it('segundo envío solo con la foto nueva (sin PDF): sale; sin foto nueva, no (la del primer aviso no vuelve a contar)', async () => {
    await choose('send');
    vi.setSystemTime(NOW.getTime() + 5 * 60_000);
    w.deal()[K.order] = '987654321';
    w.deal()[K.documentNumber] = '1250';
    expect(await choose('send')).toBe('datos_incompletos');
    expect(lastNote()).toContain('- Falta la foto del comprobante del operador: súbela en JPG o PNG a Archivos del negocio (cuenta solo una agregada después del último aviso; no cuentan los adjuntos de correos).');
    w.addFile('voucher-2.jpg', jpgBytes(), { add_time: pipedriveTime(new Date(NOW.getTime() + 2 * 60_000)) });
    expect(await choose('send')).toBe('enviado');
    expect(despachos()[1].attachments.map((a) => a.name)).toEqual(['Comprobante-Starken-987654321.jpg']);
    expect(despachos()[1].text).toContain('\nTe adjuntamos el comprobante de Starken.\n');
  });

  it('vista previa sin el PDF: llega solo con la foto y sin «adjunta»', async () => {
    w.pd.files.splice(0, 1);
    w.deal()[K.products] = null;
    expect(await choose('preview')).toBe('vista_previa_enviada');
    const sent = previews().at(-1)!;
    expect(sent.attachments.map((a) => a.name)).toEqual([expect.stringMatching(/^Comprobante-Starken-\d+\.jpg$/)]);
    expect(sent.text).not.toMatch(/en PDF|adjunta\b/);
  });

  it('si el dueño ya eligió otra opción mientras salía el aviso, el disparador no se toca', async () => {
    w.relay.onCall = () => { w.deal()[K.trigger] = OPT.preview; };
    expect(await choose('send')).toBe('enviado');
    expect(w.deal()[K.trigger]).toBe(OPT.preview);
    expect(vi.mocked(putDealFields).mock.calls[0][1]).not.toHaveProperty(K.trigger);
    expect(w.deal()[K.sentLog]).toBe('2026-11-18 12:00 -03:00 · Starken 123456789');
  });

  it('el disparador ya cambió cuando llega el webhook: no hace nada (la fuente de verdad es el negocio)', async () => {
    w.deal()[K.trigger] = OPT.preview;
    expect(await processShippingNotice({ dealId: DEAL_ID, triggerKey: K.trigger, triggerOptionId: OPT.send, startedAt: Date.now(), eventUpdateTime: nextUpdateTime() })).toBe('disparador_cambio');
    expect(w.relay.calls).toBe(0);
    expect(w.notes()).toEqual([]);
    expect(w.deal()[K.trigger]).toBe(OPT.preview);
  });
});

// ── Campos opcionales (dueño, 24-11-2026) ───────────────────────────────────

describe('campos opcionales (dueño, 24-11-2026): orden, entrega, agencia o comuna, flete y kilos', () => {
  /** Sin orden de flete, el documento identifica el despacho: `{negocio}:starken:-factura1234`. */
  const KEY_NO_ORDER = shippingNoticeKey(DEAL_ID, 'starken', '-factura1234');

  /** El caso que lo motivó: sin orden de flete, sin saber si es retiro o domicilio, ni el flete ni los kilos. */
  function emptyOptional() {
    Object.assign(w.deal(), { [K.order]: '', [K.delivery]: null, [K.place]: '', [K.freight]: null, [K.freightAmount]: null, [K.kilos]: null, [K.packages]: 5 });
  }

  it('los cinco vacíos: la vista previa y el envío salen, sin esas líneas', async () => {
    emptyOptional();
    expect(await choose('preview')).toBe('vista_previa_enviada');
    expect(previews()[0].subject).toBe('[Vista previa] Tu pedido va en camino — Factura N° 1234, Starken');
    expect(lastNote().split('\n')[1]).toBe(`Starken, sin orden de flete · Factura N° 1234 · Productos: 1 de «${SHIPPING_FIELD_NAMES.products}».`);

    vi.setSystemTime(NOW.getTime() + 60_000);
    expect(await choose('send')).toBe('enviado');
    const mail = despachos()[0];
    expect(mail.key).toBe(KEY_NO_ORDER);
    expect(mail.subject).toBe('Tu pedido va en camino — Factura N° 1234, Starken');
    expect(mail.attachments.map((a) => a.name)).toEqual(['Factura-1234.pdf', 'Comprobante-Starken.jpg']);
    expect(mail.text).toBe(
      [
        'Hola Juana,',
        '',
        'Tu pedido ya va en camino: lo entregamos a Starken el miércoles 18 de noviembre.',
        '',
        'Qué va en tu envío (5 bultos):',
        '- 10 Panel prueba 60X60',
        '  Ficha técnica: https://elights.cl/producto/panel-prueba-60x60',
        '',
        'Te adjuntamos la factura N° 1234 en PDF y el comprobante de Starken.',
        '',
        'Al recibirlo: revisa que las cajas estén en buen estado antes de firmar. Si ves algún daño, déjalo anotado con Starken y escríbenos el mismo día con fotos.',
        '',
        'Quedo atento.',
        '',
        'Saludos cordiales,',
        'Claudio Quero',
        'eLIGHTS.cl SpA',
        'claudio@elights.cl',
        '',
        '¿Dudas con tu pedido? Responde este correo o llámanos al +56 9 9127 3128.',
        'eLIGHTS.cl SpA · RUT 76.947.784-5 · claudio@elights.cl · elights.cl',
        '',
      ].join('\n'),
    );
    expect(mail.html).not.toMatch(/Seguir mi envío|>Flete<\/h2>|orden de flete/);
    expect(lastNote().split('\n')).toEqual([
      'Aviso de despacho enviado (2026-11-18 12:01, hora de Chile)',
      'Operador: Starken | Orden de flete: sin dato',
      'Entrega: sin dato | Estimada: sin fecha',
      'Flete: sin dato',
      'Bultos: 5 | Kilos: sin dato | Factura N° 1234',
      `Productos (de «${SHIPPING_FIELD_NAMES.products}»):`,
      '- 10 x PAN60 Panel prueba 60X60',
      'Adjuntos: Factura-1234.pdf (2 KB), Comprobante-Starken.jpg (4 KB)',
      'Enviado al correo principal de la persona del negocio (o al primero de su lista, si ninguno es principal).',
      'Etapa: «Despachado».',
      `aviso_despacho_key: ${KEY_NO_ORDER}`,
    ]);
    expect(w.deal()[K.sentLog]).toBe('2026-11-18 12:01 -03:00 · Starken · sin orden · factura 1234');
    expect(w.deal()[K.trigger]).toBeNull();
    expect(w.redis.data.get(noticeStateKey(KEY_NO_ORDER))?.value).toBe(`sent:${new Date(NOW.getTime() + 60_000).toISOString()}`);
  });

  const partial: Array<[string, (w: NoticeWorld) => void, string[], string[], string]> = [
    [
      'solo sin orden',
      (w) => { w.deal()[K.order] = ''; },
      ['- Entrega: retiro en la agencia Starken de Temuco.\n- Flete: por pagar, $14.460. Lo pagas a Starken al retirarlo.\n', 'Al retirarlo: lleva tu cédula de identidad. Tienes 10 días', 'Te adjuntamos la factura N° 1234 en PDF y el comprobante de Starken.'],
      ['Seguimiento', 'orden de flete', '123.456.789'],
      'Operador: Starken | Orden de flete: sin dato',
    ],
    [
      'con entrega y sin agencia o comuna',
      (w) => { w.deal()[K.place] = ''; },
      ['\n- Entrega: retiro en la agencia Starken.\n', '- Seguimiento: orden de flete N° 123.456.789'],
      ['Temuco'],
      'Entrega: Retiro en agencia | Estimada: sin fecha',
    ],
    [
      'sin kilos',
      (w) => { w.deal()[K.kilos] = null; },
      ['\nQué va en tu envío (1 bulto):\n'],
      [' kg'],
      'Bultos: 1 | Kilos: sin dato | Factura N° 1234',
    ],
    [
      'sin entrega ni flete',
      (w) => { Object.assign(w.deal(), { [K.delivery]: null, [K.place]: '', [K.freight]: null, [K.freightAmount]: null }); },
      ['\nAl recibirlo: revisa que la caja esté en buen estado antes de firmar. Si ves algún daño, déjalo anotado con Starken y escríbenos el mismo día con fotos.\n'],
      ['- Entrega:', '- Flete:', 'Temuco', 'cédula'],
      'Entrega: sin dato | Estimada: sin fecha',
    ],
  ];

  it.each(partial)('%s: sale, sin esa línea', async (_label, arrange, contains, absent, noteLine) => {
    arrange(w);
    expect(await choose('send')).toBe('enviado');
    const mail = despachos()[0];
    for (const text of contains) expect(mail.text, text).toContain(text);
    for (const text of absent) expect(`${mail.subject}\n${mail.text}`, text).not.toContain(text);
    expect(lastNote().split('\n')).toContain(noteLine);
  });

  it('el operador vacío sigue dando «Falta»; los cinco opcionales vacíos, no', async () => {
    emptyOptional();
    w.deal()[K.carrier] = null;
    expect(await choose('send')).toBe('datos_incompletos');
    expect(lastNote().split('\n')).toEqual([
      'Aviso de despacho NO enviado («Enviar al cliente»). Falta o hay que corregir:',
      `- Falta «${SHIPPING_FIELD_NAMES.carrier}».`,
      `Cuando esté listo, vuelve a elegir «Enviar al cliente» en «${SHIPPING_FIELD_NAMES.trigger}».`,
    ]);
    expect(w.relay.calls).toBe(0);
  });

  /** El despacho siguiente, `days` días después: el documento indicado y una foto nueva del comprobante. */
  function nextDispatch(days: number, documentNumber: string, packages: number) {
    vi.setSystemTime(NOW.getTime() + days * 86_400_000);
    Object.assign(w.deal(), { [K.documentNumber]: documentNumber, [K.packages]: packages });
    w.addFile(`comprobante-${days}.jpg`, jpgBytes(), { add_time: pipedriveTime(new Date(Date.now() - 60_000)) });
  }

  const NO_ORDER_DUPLICATE_LINE =
    'No salió un correo nuevo: el relay ya tenía un aviso con la factura N° 1234 con Starken. Si este es otro despacho de esa factura, escríbele desde Gmail.';

  const SAME_DOCUMENT_NOTE = [
    'Aviso de despacho NO enviado: ya se envió el 2026-11-18 12:00 (hora de Chile) con Starken, sin orden de flete, Factura N° 1234.',
    'Sin orden de flete, el aviso va por documento: para otro despacho de la factura N° 1234 con Starken, o para corregir algo, escríbele desde Gmail.',
  ];

  it('el mismo despacho sin orden, elegido otra vez: no sale otro correo (el campo, Redis y el relay)', async () => {
    emptyOptional();
    expect(await choose('send')).toBe('enviado');
    // Capa 2: «Aviso enviado» dice «· sin orden · factura 1234» del mismo operador.
    vi.setSystemTime(NOW.getTime() + 10 * 60_000);
    expect(await choose('send')).toBe('ya_enviado');
    expect(lastNote().split('\n')).toEqual(SAME_DOCUMENT_NOTE);
    // Capa 1: aunque alguien borre «Aviso enviado», la clave sin orden está en `sent`.
    w.deal()[K.sentLog] = null;
    expect(await choose('send')).toBe('ya_enviado');
    // Capa 3: sin Redis ni el campo, el relay responde duplicate por la misma clave (y no manda otro correo).
    w.redis.data.delete(noticeStateKey(KEY_NO_ORDER));
    w.deal()[K.sentLog] = null;
    expect(await choose('send')).toBe('ya_habia_salido');
    expect(noticeLog().at(-1)).toContain('relay=duplicate');
    expect(lastNote().split('\n')[0]).toBe(NO_ORDER_DUPLICATE_LINE);
    expect(despachos()).toHaveLength(1);
    expect(w.relay.calls).toBe(2);
  });

  it('dos despachos sin orden del mismo operador, con documentos distintos: salen los dos correos', async () => {
    emptyOptional();
    expect(await choose('send')).toBe('enviado');
    nextDispatch(3, '5678', 2);
    expect(await choose('send')).toBe('enviado');
    expect(despachos().map((m) => m.key)).toEqual([KEY_NO_ORDER, shippingNoticeKey(DEAL_ID, 'starken', '-factura5678')]);
    expect(despachos()[1].subject).toBe('Tu pedido va en camino — Factura N° 5678, Starken');
    expect(despachos()[1].text).toContain('\nQué va en tu envío (2 bultos):\n');
    expect(w.deal()[K.sentLog]).toBe('2026-11-21 12:00 -03:00 · Starken · sin orden · factura 5678');
    // Una guía de despacho con el mismo número es otro documento: también sale.
    nextDispatch(4, '5678', 1);
    w.deal()[K.documentType] = OPT.guia;
    expect(await choose('send')).toBe('enviado');
    expect(despachos()).toHaveLength(3);
    expect(despachos()[2].key).toBe(shippingNoticeKey(DEAL_ID, 'starken', '-guia5678'));
    expect(despachos()[2].subject).toBe('Tu pedido va en camino — Guía de despacho N° 5678, Starken');
    expect(w.deal()[K.sentLog]).toBe('2026-11-22 12:00 -03:00 · Starken · sin orden · guía de despacho 5678');
    expect(w.relay.calls).toBe(3);
  });

  it('revisión de la PR 215: el primero quedó incierto (sí salió) y el siguiente lleva otro documento: el segundo correo sale de verdad', async () => {
    emptyOptional();
    w.relay.mode = 'sent_then_timeout';
    expect(await choose('send')).toBe('incierto');
    w.relay.mode = 'normal';
    expect(w.redis.data.get(noticeStateKey(KEY_NO_ORDER))?.value).toBe('uncertain');
    nextDispatch(8, '5678', 2);
    expect(await choose('send')).toBe('enviado');
    expect(noticeLog().at(-1)).toContain('relay=ok');
    expect(despachos()).toHaveLength(2);
    expect(despachos()[1].text).toContain('\nQué va en tu envío (2 bultos):\n');
  });

  it('revisión de la PR 215: se perdió el «sent» del primero y hubo uno con orden entremedio: el tercero, sin orden y con otro documento, sale de verdad', async () => {
    emptyOptional();
    w.redis.intercept = (cmd, args) => (cmd === 'SET' && args[0] === noticeStateKey(KEY_NO_ORDER) && String(args[1]).startsWith('sent:') ? 'fail' : undefined);
    expect(await choose('send')).toBe('enviado');
    w.redis.intercept = undefined;
    nextDispatch(1, '1234', 1);
    w.deal()[K.order] = '555';
    expect(await choose('send')).toBe('enviado');
    nextDispatch(3, '5678', 2);
    w.deal()[K.order] = '';
    expect(await choose('send')).toBe('enviado');
    expect(noticeLog().at(-1)).toContain('relay=ok');
    expect(despachos()).toHaveLength(3);
    expect(w.relay.calls).toBe(3);
    expect(despachos()[2].key).toBe(shippingNoticeKey(DEAL_ID, 'starken', '-factura5678'));
  });

  it('el mismo documento y el mismo operador, sin orden, son un solo aviso: el segundo despacho se escribe desde Gmail', async () => {
    emptyOptional();
    expect(await choose('send')).toBe('enviado');
    nextDispatch(3, '1234', 2);
    expect(await choose('send')).toBe('ya_enviado');
    expect(lastNote().split('\n')).toEqual(SAME_DOCUMENT_NOTE);
    expect(despachos()).toHaveLength(1);
    expect(w.relay.calls).toBe(1);
  });

  it('el mismo documento y el mismo operador, sin orden, con el primero incierto: el relay lo trata como el mismo aviso y no manda otro correo', async () => {
    emptyOptional();
    w.relay.mode = 'sent_then_timeout';
    expect(await choose('send')).toBe('incierto');
    w.relay.mode = 'normal';
    nextDispatch(8, '1234', 2);
    // Es la misma clave: no se distingue de reintentar el primero, que sí había salido. Se registra
    // (para que no se reintente), pero la nota dice que no salió un correo nuevo y manda a Gmail.
    expect(await choose('send')).toBe('ya_habia_salido');
    expect(noticeLog().at(-1)).toMatch(/resultado=ya_habia_salido .*relay=duplicate/);
    expect(despachos()).toHaveLength(1);
    expect(lastNote().split('\n')).toEqual([
      NO_ORDER_DUPLICATE_LINE,
      'Aviso de despacho ya había salido: registrado el 2026-11-26 12:00 (hora de Chile)',
      'Operador: Starken | Orden de flete: sin dato',
      'Entrega: sin dato | Estimada: sin fecha',
      'Flete: sin dato',
      'Bultos: 2 | Kilos: sin dato | Factura N° 1234',
      `Productos (de «${SHIPPING_FIELD_NAMES.products}»):`,
      '- 10 x PAN60 Panel prueba 60X60',
      'Adjuntos: Comprobante-Starken.jpg (4 KB)',
      'Etapa: «Despachado».',
      `aviso_despacho_key: ${KEY_NO_ORDER}`,
    ]);
    expect(w.deal()[K.sentLog]).toBe('2026-11-26 12:00 -03:00 · Starken · sin orden · factura 1234');
  });

  it('sin orden y después con la orden: es otra clave; sale un segundo correo solo con una foto nueva del comprobante', async () => {
    emptyOptional();
    expect(await choose('send')).toBe('enviado');
    vi.setSystemTime(NOW.getTime() + 5 * 60_000);
    w.deal()[K.order] = '987654321';
    // El campo no calza (otra orden) ni Redis (otra clave); la foto del primer aviso ya no cuenta.
    expect(await choose('send')).toBe('datos_incompletos');
    expect(lastNote()).toContain('- Falta la foto del comprobante del operador');
    expect(w.relay.calls).toBe(1);
    // Con una foto nueva, sale el segundo correo, ahora con la orden.
    w.addFile('voucher-2.jpg', jpgBytes(), { add_time: pipedriveTime(new Date(NOW.getTime() + 2 * 60_000)) });
    expect(await choose('send')).toBe('enviado');
    expect(despachos()).toHaveLength(2);
    expect(despachos()[1].key).toBe(shippingNoticeKey(DEAL_ID, 'starken', '987654321'));
    expect(despachos()[1].subject).toBe('Tu pedido va en camino — Factura N° 1234, Starken orden de flete 987654321');
    expect(w.deal()[K.sentLog]).toBe('2026-11-18 12:05 -03:00 · Starken 987654321');
  });
});

// ── Lo que detiene el aviso (§8) ────────────────────────────────────────────

describe('§8 falta algo: nota «NO enviado» con la lista exacta y el disparador vacío', () => {
  const cases: Array<[string, (w: NoticeWorld) => void, string[]]> = [
    // La orden de flete es opcional desde el 24-11-2026: solo falta el operador.
    ['falta el operador (la orden vacía ya no cuenta)', (w) => { w.deal()[K.carrier] = null; w.deal()[K.order] = ''; }, [`- Falta «${SHIPPING_FIELD_NAMES.carrier}».`]],
    ['faltan los bultos', (w) => { w.deal()[K.packages] = null; }, [`- Falta «${SHIPPING_FIELD_NAMES.packages}».`]],
    ['falta el N° de documento', (w) => { w.deal()[K.documentNumber] = ''; }, [`- Falta «${SHIPPING_FIELD_NAMES.documentNumber}».`]],
    ['una orden sin letras ni dígitos', (w) => { w.deal()[K.order] = '---'; }, [`- «${SHIPPING_FIELD_NAMES.order}» no trae letras ni dígitos.`]],
    ['una agencia o comuna de más de 80 caracteres', (w) => { w.deal()[K.place] = 'x'.repeat(81); }, [`- «${SHIPPING_FIELD_NAMES.place}» tiene más de 80 caracteres.`]],
    ['kilos en 0', (w) => { w.deal()[K.kilos] = 0; }, [`- «${SHIPPING_FIELD_NAMES.kilos}» tiene que ser un número mayor que 0 (tiene «0»).`]],
    ['«Por pagar» sin el monto', (w) => { w.deal()[K.freightAmount] = null; }, [`- Falta «${SHIPPING_FIELD_NAMES.freightAmount}»: con «Por pagar» va el monto del comprobante del operador.`]],
    // Nada se descarta sin avisar: el lugar sin la entrega y el monto sin el flete detienen el aviso.
    ['«Agencia o comuna» con texto y «Entrega» vacía', (w) => { w.deal()[K.delivery] = null; }, [`- «${SHIPPING_FIELD_NAMES.place}» tiene texto, pero «${SHIPPING_FIELD_NAMES.delivery}» está vacía: elige «Retiro en agencia» o «A domicilio», o borra el lugar.`]],
    ['«Flete por pagar» con monto y «Flete» vacío', (w) => { w.deal()[K.freight] = null; }, [`- «${SHIPPING_FIELD_NAMES.freightAmount}» tiene monto, pero «${SHIPPING_FIELD_NAMES.freight}» está vacío: elige «Por pagar» o borra el monto.`]],
    ['una entrega que no está en las opciones', (w) => { w.deal()[K.delivery] = 999; }, [`- «${SHIPPING_FIELD_NAMES.delivery}» trae una opción que no está en Pipedrive: vuelve a elegirla.`]],
    ['la persona no tiene correo', (w) => { w.pd.persons.get(PERSON_ID)!.email = []; }, ['- La persona del negocio no tiene correo: agrégalo en la persona.']],
    ['la persona ya no existe', (w) => { w.pd.persons.delete(PERSON_ID); }, ['- La persona del negocio ya no existe en Pipedrive: agrega la persona del cliente, con su correo.']],
    ['un SKU desconocido sin texto', (w) => { w.deal()[K.products] = '10 PAN60\n2 NOEXISTE'; }, [`- «${SHIPPING_FIELD_NAMES.products}», línea 2 («2 NOEXISTE»): el SKU NOEXISTE no está en el catálogo publicado. Corrígelo o agrega « — <texto como en la factura>».`]],
    ['el PDF pesa demasiado (por file_size, sin descargar)', (w) => { w.pd.files[0].file_size = MAX_DOCUMENT_BYTES + 1; }, ['- El PDF «factura-1234.pdf» supera el máximo de 3 MB (pesa 3.145.729 bytes).']],
    ['el «PDF» es una foto (tipo por los primeros bytes)', (w) => { w.pd.files[0].bytes = jpgBytes(2048); }, ['- El PDF «factura-1234.pdf» no es un PDF: adjunta la factura N° 1234 en PDF.']],
    ['hay 2 PDF con el número en el nombre', (w) => { w.addFile('factura-1234 copia.pdf', pdfBytes()); }, ['- Hay 2 PDF con el N° 1234 en el nombre («factura-1234 copia.pdf», «factura-1234.pdf»): deja solo el de la factura N° 1234.']],
    ['2 fotos candidatas a comprobante', (w) => { w.pd.files[1].name = 'foto-1.jpg'; w.addFile('foto-2.jpg', jpgBytes()); }, ['- Hay 2 fotos («foto-2.jpg», «foto-1.jpg») y ninguna dice «comprobante» o «voucher» en el nombre: deja solo la del comprobante.']],
    ['falta la foto del comprobante (una de hace 10 días no cuenta)', (w) => { w.pd.files[1].add_time = pipedriveTime(new Date(NOW.getTime() - 10 * 86_400_000)); }, ['- Falta la foto del comprobante del operador: súbela en JPG o PNG a Archivos del negocio (cuenta solo una agregada en los últimos 7 días; no cuentan los adjuntos de correos).']],
    ['«Aviso enviado» editado a mano (ilegible)', (w) => { w.deal()[K.sentLog] = 'ayer'; }, []],
    ['una fecha de envío futura', (w) => { w.deal()[K.shipDate] = '2026-11-19'; }, [`- «${SHIPPING_FIELD_NAMES.shipDate}» (jueves 19 de noviembre) es posterior a hoy: el aviso diría que ya se entregó.`]],
  ];

  it.each(cases)('%s', async (_label, arrange, expected) => {
    arrange(w);
    expect(await choose('send')).toBe('datos_incompletos');
    expect(w.relay.calls).toBe(0);
    const note = lastNote().split('\n');
    expect(note[0]).toBe('Aviso de despacho NO enviado («Enviar al cliente»). Falta o hay que corregir:');
    for (const line of expected) expect(note, note.join('\n')).toContain(line);
    expect(note.at(-1)).toBe(`Cuando esté listo, vuelve a elegir «Enviar al cliente» en «${SHIPPING_FIELD_NAMES.trigger}».`);
    expect(w.deal()[K.trigger]).toBeNull();
    expect(w.deal()[K.sentLog] === null || w.deal()[K.sentLog] === 'ayer').toBe(true);
    expect(w.redis.data.has(noticeStateKey(KEY))).toBe(false);
    expect(noticeLog().at(-1)).toMatch(/ resultado=datos_incompletos .*problemas=\S+/);
  });

  it('más de 500 archivos (lista incompleta): no elige sobre una lista cortada', async () => {
    // Las 5 páginas ven un PDF nuevo con el N° 1234 y el comprobante; la sexta, la factura original.
    const old = pipedriveTime(new Date(NOW.getTime() - 30 * 86_400_000));
    for (let i = 0; i < 498; i++) w.addFile(`viejo-${i}.pdf`, pdfBytes(16), { add_time: old });
    w.addFile('factura-1234-copia.pdf', pdfBytes());
    expect(w.pd.files).toHaveLength(501);
    expect(await choose('send')).toBe('datos_incompletos');
    expect(w.relay.calls).toBe(0);
    expect(lastNote()).toContain('- El negocio tiene demasiados archivos para revisarlos todos (el aviso revisa hasta 500): no se puede saber si hay otro PDF o comprobante. Avísale a Claude.');
    expect(w.deal()[K.trigger]).toBeNull();
  });

  it('con 500 archivos la lista está completa y sale', async () => {
    const old = pipedriveTime(new Date(NOW.getTime() - 30 * 86_400_000));
    for (let i = 0; i < 498; i++) w.addFile(`viejo-${i}.pdf`, pdfBytes(16), { add_time: old });
    expect(w.pd.files).toHaveLength(500);
    expect(await choose('send')).toBe('enviado');
  });

  it('un archivo borrado entre la lista y la descarga (404) cuenta como faltante', async () => {
    w.pd.intercept = (r) => (r.path.endsWith('/download') ? new Response('{"success":false}', { status: 404 }) : undefined);
    expect(await choose('send')).toBe('datos_incompletos');
    expect(lastNote()).toContain('- El PDF «factura-1234.pdf» ya no está en el negocio: vuelve a adjuntarlo.');
    expect(w.relay.calls).toBe(0);
  });

  it('un archivo que no se pudo descargar (error de Pipedrive): «reintenta en unos minutos»', async () => {
    w.pd.intercept = (r) => (r.path.endsWith('/download') ? new Response('error', { status: 502 }) : undefined);
    expect(await choose('send')).toBe('reintentar');
    expect(lastNote()).toBe('Aviso de despacho NO enviado («Enviar al cliente»): Pipedrive no entregó el archivo del documento.\nReintenta en unos minutos: vuelve a elegir «Enviar al cliente» en «Despacho · Aviso».');
    expect(w.redis.data.has(noticeStateKey(KEY))).toBe(false);
  });

  it('un campo «Despacho · …» que falta en Pipedrive: la nota lo nombra', async () => {
    w.pd.dealFields = w.pd.dealFields.filter((f) => f.name !== SHIPPING_FIELD_NAMES.kilos);
    expect(await choose('preview')).toBe('datos_incompletos');
    expect(lastNote()).toContain(`- Falta el campo «${SHIPPING_FIELD_NAMES.kilos}» en Pipedrive (el nombre tiene que ser exacto, con el «·»).`);
    expect(w.relay.calls).toBe(0);
  });
});

// ── Redis, plazo, candado y relay (§8) ──────────────────────────────────────

describe('§8 Redis, plazo, candado y respuestas del relay', () => {
  it('Redis no responde: no envía al cliente; nota «reintenta en unos minutos» y el disparador vacío', async () => {
    w.redis.down = true;
    expect(await choose('send')).toBe('reintentar');
    expect(w.relay.calls).toBe(0);
    expect(lastNote()).toBe('Aviso de despacho NO enviado («Enviar al cliente»): el registro contra el envío doble (Redis) no respondió.\nReintenta en unos minutos: vuelve a elegir «Enviar al cliente» en «Despacho · Aviso».');
    expect(w.deal()[K.trigger]).toBeNull();
  });

  it('Redis no responde: la vista previa sí sale, sin candado ni contador, y no deja la marca', async () => {
    w.redis.down = true;
    expect(await choose('preview')).toBe('vista_previa_enviada');
    expect(previews()).toHaveLength(1);
    expect(w.redis.data.size).toBe(0);
    expect(noticeLog().at(-1)).toContain('redis=caido');
  });

  it('Redis responde al candado pero falla al leer el estado: no envía', async () => {
    w.redis.intercept = (cmd, args) => (cmd === 'GET' && args[0] === noticeStateKey(KEY) ? 'fail' : undefined);
    expect(await choose('send')).toBe('reintentar');
    expect(w.relay.calls).toBe(0);
  });

  it('la clave está en `sending` (otro aviso en curso o una función cortada): no envía', async () => {
    w.redis.data.set(noticeStateKey(KEY), { value: 'sending', ttl: 600, expiresAt: Date.now() + 600_000 });
    expect(await choose('send')).toBe('en_curso');
    expect(w.relay.calls).toBe(0);
    expect(lastNote()).toBe('Aviso de despacho NO enviado: hay un envío en curso o sin confirmar.\nRevisa Enviados (el asunto sin «[Vista previa]») en 10 minutos; si no está, vuelve a elegir «Enviar al cliente». Si ya había salido, el relay no lo repite.');
    expect(w.deal()[K.trigger]).toBeNull();
  });

  it('con orden: el relay no responde a tiempo (`uncertain`, nota «no sé si salió», sin reintento); al reintentar, duplicate se registra sin un segundo correo y la nota lo dice', async () => {
    w.relay.mode = 'sent_then_timeout';
    expect(await choose('send')).toBe('incierto');
    expect(w.relay.calls).toBe(1);
    expect(w.redis.data.get(noticeStateKey(KEY))?.value).toBe('uncertain');
    expect(lastNote()).toBe('Aviso de despacho: no sé si salió (sin respuesta a tiempo).\nRevisa Enviados (el asunto sin «[Vista previa]»); si no está, vuelve a elegir «Enviar al cliente». Si ya había salido, el relay no lo repite.');
    expect(w.deal()[K.trigger]).toBeNull();
    expect(w.deal()[K.sentLog]).toBeNull();

    w.relay.mode = 'normal';
    vi.setSystemTime(NOW.getTime() + 15 * 60_000);
    expect(await choose('send')).toBe('ya_habia_salido');
    expect(despachos()).toHaveLength(1);
    expect(w.relay.calls).toBe(2);
    expect(noticeLog().at(-1)).toMatch(/resultado=ya_habia_salido .*relay=duplicate/);
    const note = lastNote().split('\n');
    expect(note.slice(0, 3)).toEqual([
      'No salió un correo nuevo: el relay confirmó que el aviso anterior de este despacho ya había salido.',
      'Aviso de despacho ya había salido: registrado el 2026-11-18 12:15 (hora de Chile)',
      'Operador: Starken | Orden de flete: 123.456.789',
    ]);
    expect(note).not.toContain('Enviado al correo principal de la persona del negocio (o al primero de su lista, si ninguno es principal).');
    expect(note.filter((l) => /enviado/i.test(l))).toEqual([]);
    expect(w.deal()[K.sentLog]).toBe('2026-11-18 12:15 -03:00 · Starken 123456789');
    expect(w.deal()[K.trigger]).toBeNull();
  });

  it('una respuesta HTML del relay (puede llegar después del envío): `uncertain`', async () => {
    w.relay.mode = 'sent_then_html';
    expect(await choose('send')).toBe('incierto');
    expect(lastNote()).toContain('no sé si salió (respuesta no JSON (HTTP 500))');
  });

  it('`uncertain` con el motivo «pendiente» va a la misma fila (sin reintento)', async () => {
    w.relay.mode = 'pending';
    expect(await choose('send')).toBe('incierto');
    expect(lastNote()).toContain('no sé si salió (clave pendiente en el relay (revisar Enviados))');
    expect(w.relay.calls).toBe(1);
    expect(w.redis.data.get(noticeStateKey(KEY))?.value).toBe('uncertain');
  });

  it('`rejected` en el envío al cliente (aunque sea «reenvio»): no salió, nota y ATENCIÓN', async () => {
    w.relay.mode = 'rejected';
    w.relay.rejectReason = 'reenvio';
    expect(await choose('send')).toBe('rechazado');
    expect(w.redis.mails).toHaveLength(1);
  });

  it('el relay responde quota o rejected: no envía; nota, ATENCIÓN a ventas@ y «enviando» se borra', async () => {
    for (const mode of ['quota', 'rejected'] as const) {
      w.relay.mode = mode;
      expect(await choose('send')).toBe('rechazado');
      expect(w.redis.data.has(noticeStateKey(KEY))).toBe(false);
      expect(w.deal()[K.trigger]).toBeNull();
    }
    expect(w.notes()[0]).toContain('Aviso de despacho NO enviado: se acabó la cuota diaria de correos de Gmail; reintenta mañana. Se avisó a ventas@.');
    expect(w.notes()[1]).toContain('el relay rechazó el pedido (falta configuración en el relay)');
    expect(w.redis.mails).toHaveLength(2);
    expect(w.redis.mails[0].items_lista).toMatch(/^ATENCIÓN: el aviso de despacho NO salió: se acabó la cuota/);
    expect(despachos()).toHaveLength(0);
  });

  it('sin configuración del relay (sin secreto): `config`, nota y ATENCIÓN', async () => {
    vi.stubEnv('SHIPPING_RELAY_SECRET', '');
    expect(await choose('send')).toBe('rechazado');
    expect(lastNote()).toContain('falta configuración en el servidor (falta SHIPPING_RELAY_SECRET)');
    expect(w.relay.calls).toBe(0);
  });

  it('no alcanza el plazo (quedan menos de 40 s antes del relay): no envía, «reintenta», con el plazo que queda en cada escritura', async () => {
    // Llegó hace 45 s: quedan 5 s hasta el plazo de 50 s. /dealFields ya está en caché (el webhook lo
    // consultó para reconocer el disparador).
    await findDealFieldByName(SHIPPING_FIELD_NAMES.trigger);
    const startedAt = Date.now() - 45_000;
    expect(noticeDeadline(startedAt) - Date.now()).toBe(5_000);
    expect(await choose('send', startedAt)).toBe('reintentar');
    expect(w.relay.calls).toBe(0);
    expect(lastNote()).toBe('Aviso de despacho NO enviado («Enviar al cliente»): no alcanzó el tiempo de la función para enviarlo.\nReintenta en unos minutos: vuelve a elegir «Enviar al cliente» en «Despacho · Aviso».');
    expect(w.deal()[K.trigger]).toBeNull();
    // La nota y el PUT usan los 5 s que quedan, no los 15 s fijos del cliente.
    expect(vi.mocked(createDealNote).mock.calls[0][2]).toBe(5_000);
    expect(vi.mocked(putDealFields).mock.calls[0][2]).toBe(5_000);
  });

  it('justo en el límite (quedan 40 s) el relay sí empieza, con un plazo de 30 s', async () => {
    const startedAt = Date.now() - (NOTICE_MAX_DURATION_S * 1000 - 10_000 - MIN_RELAY_WINDOW_MS);
    expect(await choose('send', startedAt)).toBe('enviado');
    expect(vi.mocked(sendShippingNotice).mock.calls[0][1]).toEqual({ timeoutMs: 30_000 });
  });

  it('en el límite, si guardar `sending` demora 1,5 s, el relay no empieza: se retira la reserva y «reintenta»', async () => {
    const startedAt = Date.now() - (NOTICE_MAX_DURATION_S * 1000 - 10_000 - MIN_RELAY_WINDOW_MS);
    w.redis.intercept = (cmd, args) => {
      if (cmd === 'SET' && args[0] === noticeStateKey(KEY) && args[1].startsWith('sending:')) vi.setSystemTime(Date.now() + 1_500);
      return undefined;
    };
    expect(await choose('send', startedAt)).toBe('reintentar');
    expect(w.relay.calls).toBe(0);
    expect(w.redis.data.has(noticeStateKey(KEY))).toBe(false);
    expect(lastNote()).toBe('Aviso de despacho NO enviado («Enviar al cliente»): no alcanzó el tiempo de la función para enviarlo.\nReintenta en unos minutos: vuelve a elegir «Enviar al cliente» en «Despacho · Aviso».');
    expect(w.deal()[K.trigger]).toBeNull();
  });

  it('la reserva `sending` de otra ejecución no se retira', async () => {
    const startedAt = Date.now() - (NOTICE_MAX_DURATION_S * 1000 - 10_000 - MIN_RELAY_WINDOW_MS);
    w.redis.intercept = (cmd, args) => {
      if (cmd === 'SET' && args[0] === noticeStateKey(KEY) && args[1].startsWith('sending:')) vi.setSystemTime(Date.now() + 1_500);
      // Antes de retirarla, otra ejecución (sin el candado, p. ej. tras una función cortada) la reemplazó.
      if (cmd === 'EVAL' && args.includes(noticeStateKey(KEY))) {
        w.redis.data.set(noticeStateKey(KEY), { value: 'sending:otra', ttl: 600, expiresAt: Date.now() + 600_000 });
      }
      return undefined;
    };
    expect(await choose('send', startedAt)).toBe('reintentar');
    expect(w.redis.data.get(noticeStateKey(KEY))?.value).toBe('sending:otra');
  });

  it('las escrituras no empiezan con el plazo vencido y el ATENCIÓN recibe lo que queda menos el margen', async () => {
    const startedAt = Date.now();
    // El correo sale y la nota demora hasta los 50,001 s (pasado el plazo de las escrituras).
    w.pd.intercept = (r) => {
      if (r.method === 'POST' && r.path === '/notes') {
        vi.setSystemTime(startedAt + 50_001);
        return new Response('error', { status: 500 });
      }
      return undefined;
    };
    expect(await choose('send', startedAt)).toBe('enviado_sin_registro');
    expect(despachos()).toHaveLength(1);
    // Ni la relectura ni el PUT empiezan.
    expect(w.pd.requests.filter((r) => r.method === 'PUT')).toEqual([]);
    expect(w.pd.requests.filter((r) => r.method === 'GET' && r.path === `/deals/${DEAL_ID}`)).toHaveLength(1);
    // 60 s de la función − 2 s para terminar − 50,001 s = 7,999 s (no los 10 s fijos de notifySales).
    expect(vi.mocked(notifySales).mock.calls[0][2]).toEqual({ timeoutMs: 7_999 });
    expect(w.redis.mails[0].items_lista).toContain(`Falta registrar a mano: la nota del aviso, «${SHIPPING_FIELD_NAMES.sentLog}», la etapa «Despachado» y vaciar «${SHIPPING_FIELD_NAMES.trigger}».`);
    expect(noticeLog().at(-1)).toContain('put=sin_plazo');
  });

  it('el candado del negocio está tomado: nada (sin nota; el disparador no se vacía)', async () => {
    w.redis.data.set(noticeLockKey(DEAL_ID), { value: 'otro-proceso', ttl: 90_000, expiresAt: Date.now() + 90_000 });
    expect(await choose('send')).toBe('candado_tomado');
    expect(w.relay.calls).toBe(0);
    expect(w.notes()).toEqual([]);
    expect(w.deal()[K.trigger]).toBe(OPT.send);
    expect(w.pd.requests).toEqual([]);
    // El candado de otro no se suelta.
    expect(w.redis.data.get(noticeLockKey(DEAL_ID))?.value).toBe('otro-proceso');
  });

  it('el candado se toma con NX y 90 s, y se suelta al terminar (también si el aviso no sale)', async () => {
    const seen: string[][] = [];
    w.redis.intercept = (cmd, args) => { if (cmd === 'SET' && args[0] === noticeLockKey(DEAL_ID)) seen.push(args); return undefined; };
    w.deal()[K.carrier] = null;
    expect(await choose('send')).toBe('datos_incompletos');
    expect(seen).toHaveLength(1);
    expect(seen[0].slice(2)).toEqual(['NX', 'PX', '90000']);
    expect(w.redis.data.has(noticeLockKey(DEAL_ID))).toBe(false);
  });
});

// ── El correo salió y Pipedrive falló (§3 paso 11) ──────────────────────────

describe('§8 el correo salió, pero falló Pipedrive', () => {
  it('falla la nota: ATENCIÓN a ventas@ y una tarea al dueño; la clave queda en `sent`', async () => {
    w.pd.intercept = (r) => (r.method === 'POST' && r.path === '/notes' ? new Response('error', { status: 500 }) : undefined);
    expect(await choose('send')).toBe('enviado_sin_registro');
    expect(despachos()).toHaveLength(1);
    expect(w.redis.data.get(noticeStateKey(KEY))?.value).toMatch(/^sent:/);
    expect(w.redis.mails).toHaveLength(1);
    const body = w.redis.mails[0].items_lista;
    expect(body.split('\n')[0]).toBe('ATENCIÓN: el aviso salió, pero no quedó en Pipedrive.');
    expect(body).toContain('Falta registrar a mano: la nota del aviso.');
    expect(w.pd.activities).toHaveLength(1);
    expect(w.pd.activities[0]).toMatchObject({ user_id: OWNER_USER_ID, deal_id: DEAL_ID, person_id: PERSON_ID, done: 0 });
    // El PUT sí quedó: «Aviso enviado» protege un segundo intento.
    expect(w.deal()[K.sentLog]).toBe('2026-11-18 12:00 -03:00 · Starken 123456789');
    expect(noticeLog().at(-1)).toContain('atencion=ok tarea=ok');
  });

  it('falla el PUT: ATENCIÓN con el valor que hay que escribir a mano', async () => {
    w.pd.intercept = (r) => (r.method === 'PUT' ? new Response('error', { status: 500 }) : undefined);
    expect(await choose('send')).toBe('enviado_sin_registro');
    const body = w.redis.mails[0].items_lista;
    expect(body).toContain(`Falta registrar a mano: «${SHIPPING_FIELD_NAMES.sentLog}», la etapa «Despachado» y vaciar «${SHIPPING_FIELD_NAMES.trigger}».`);
    expect(body).toContain(`En «${SHIPPING_FIELD_NAMES.sentLog}» va: 2026-11-18 12:00 -03:00 · Starken 123456789`);
    expect(w.notes()[0]).toMatch(/^Aviso de despacho enviado/);
  });

  it('el relay responde duplicate y falla el PUT: el ATENCIÓN tampoco dice que salió un correo nuevo', async () => {
    w.relay.mode = 'sent_then_timeout';
    expect(await choose('send')).toBe('incierto');
    w.relay.mode = 'normal';
    vi.setSystemTime(NOW.getTime() + 15 * 60_000);
    w.pd.intercept = (r) => (r.method === 'PUT' ? new Response('error', { status: 500 }) : undefined);
    expect(await choose('send')).toBe('ya_habia_salido_sin_registro');
    expect(despachos()).toHaveLength(1);
    expect(w.redis.mails).toHaveLength(1);
    const body = w.redis.mails[0].items_lista;
    const lines = body.split('\n');
    expect(lines[0]).toBe('ATENCIÓN: el aviso ya había salido (no salió un correo nuevo), pero no quedó en Pipedrive.');
    expect(lines).toContain('No salió un correo nuevo: el relay confirmó que el aviso anterior de este despacho ya había salido.');
    expect(lines).toContain('Registrado el 2026-11-18 12:15 (hora de Chile): Starken 123.456.789, Factura N° 1234.');
    expect(body).not.toContain('Enviado el');
    expect(w.notes().at(-1)).toMatch(/^No salió un correo nuevo/);
    expect(noticeLog().at(-1)).toMatch(/resultado=ya_habia_salido_sin_registro .*relay=duplicate/);
  });

  it('el ATENCIÓN es interno: responde a ventas@, sin el correo, el nombre ni el teléfono del cliente', async () => {
    w.pd.intercept = (r) => (r.method === 'PUT' ? new Response('error', { status: 500 }) : undefined);
    expect(await choose('send')).toBe('enviado_sin_registro');
    expect(w.redis.mails).toHaveLength(1);
    expect(w.redis.mails[0].reply_to).toBe('ventas@elights.cl');
    const mail = JSON.stringify(w.redis.mails[0]);
    for (const secret of [EMAIL, 'Juana', '1111 2222']) expect(mail).not.toContain(secret);
    expect(vi.mocked(notifySales).mock.calls[0][0].email).toBe('ventas@elights.cl');
  });

  it('/stages falla: el correo salió, la etapa no cambió; ATENCIÓN y tarea', async () => {
    w.pd.intercept = (r) => (r.path === '/stages' ? new Response('error', { status: 500 }) : undefined);
    expect(await choose('send')).toBe('enviado_sin_registro');
    expect(despachos()).toHaveLength(1);
    expect(w.deal().stage_id).toBe(21);
    expect(w.deal()[K.sentLog]).toBe('2026-11-18 12:00 -03:00 · Starken 123456789');
    expect(w.deal()[K.trigger]).toBeNull();
    expect(lastNote()).toContain('Etapa: sin cambio (Pipedrive no entregó las etapas del embudo).');
    const body = w.redis.mails[0].items_lista;
    expect(body).toContain('Falta registrar a mano: la etapa «Despachado» (si el embudo la tiene).');
    // «Aviso enviado» sí quedó: el correo no repite su valor.
    expect(body).not.toContain(`En «${SHIPPING_FIELD_NAMES.sentLog}» va:`);
    expect(w.pd.activities).toHaveLength(1);
  });

  it('falla la relectura que vacía el disparador: «Aviso enviado» queda, el disparador no; ATENCIÓN y tarea', async () => {
    let dealReads = 0;
    w.pd.intercept = (r) => (r.method === 'GET' && r.path === `/deals/${DEAL_ID}` && ++dealReads === 2 ? new Response('error', { status: 500 }) : undefined);
    expect(await choose('send')).toBe('enviado_sin_registro');
    expect(w.deal()[K.sentLog]).toBe('2026-11-18 12:00 -03:00 · Starken 123456789');
    expect(w.deal()[K.trigger]).toBe(OPT.send);
    const body = w.redis.mails[0].items_lista;
    expect(body).toContain(`Falta registrar a mano: vaciar «${SHIPPING_FIELD_NAMES.trigger}».`);
    expect(w.pd.activities).toHaveLength(1);
    expect(noticeLog().at(-1)).toContain('disparador=sin_releer');
  });

  it('casos normales sin ATENCIÓN: el embudo sin «Despachado» y el disparador que el dueño ya cambió', async () => {
    w.deal().pipeline_id = 3;
    w.deal().stage_id = 30;
    w.relay.onCall = () => { w.deal()[K.trigger] = OPT.preview; };
    expect(await choose('send')).toBe('enviado');
    expect(w.redis.mails).toHaveLength(0);
    expect(w.pd.activities).toHaveLength(0);
  });

  it('sin PIPEDRIVE_OWNER_USER_ID: solo el ATENCIÓN', async () => {
    vi.stubEnv('PIPEDRIVE_OWNER_USER_ID', '');
    w.pd.intercept = (r) => (r.method === 'POST' && r.path === '/notes' ? 'timeout' : undefined);
    expect(await choose('send')).toBe('enviado_sin_registro');
    expect(w.redis.mails).toHaveLength(1);
    expect(w.pd.activities).toHaveLength(0);
    expect(noticeLog().at(-1)).toContain('tarea=sin_usuario');
  });
});

// ── Reentregas de Pipedrive: la identidad del evento ────────────────────────

describe('§8 reentregas de Pipedrive: la identidad del evento', () => {
  beforeEach(() => {
    vi.stubEnv('PIPEDRIVE_WEBHOOK_USER', USER);
    vi.stubEnv('PIPEDRIVE_WEBHOOK_PASSWORD', PASSWORD);
  });

  const failPut = (r: { method: string }) => (r.method === 'PUT' ? new Response('error', { status: 500 }) : undefined);

  it('se reserva bajo el candado con NX por 2 días: hash del negocio, la opción y el update_time', async () => {
    const seen: string[][] = [];
    w.redis.intercept = (cmd, args) => { if (cmd === 'SET' && args[0].startsWith('aviso-despacho:v1:evento:')) seen.push(args); return undefined; };
    expect(await choose('preview', Date.now(), EVENT_TIME)).toBe('vista_previa_enviada');
    const key = noticeEventKey(DEAL_ID, OPT.preview, EVENT_TIME);
    expect(key).toMatch(/^aviso-despacho:v1:evento:[0-9a-f]{64}$/);
    expect(seen).toEqual([[key, '1', 'NX', 'EX', String(NOTICE_EVENT_TTL_S)]]);
    expect(NOTICE_EVENT_TTL_S).toBe(172_800);
    expect(w.redis.data.get(key)?.ttl).toBe(172_800);
    expect(noticeEventKey(DEAL_ID, OPT.send, EVENT_TIME)).not.toBe(key);
  });

  it('Codex 1: falla el PUT, el dueño cambia la orden y Pipedrive reentrega el evento a los 150 s: no sale otro aviso', async () => {
    w.deal()[K.trigger] = OPT.send;
    w.pd.intercept = failPut;
    const body = webhookBody(OPT.send);
    await webhook(body);
    await flush();
    expect(despachos()).toHaveLength(1);
    expect(w.deal()[K.trigger]).toBe(OPT.send);
    expect(noticeLog().at(-1)).toContain('resultado=enviado_sin_registro');

    // Pipedrive ya responde; el dueño corrige la orden (otro campo: no dispara) y llega la reentrega.
    w.pd.intercept = undefined;
    w.deal()[K.order] = '987654321';
    vi.setSystemTime(NOW.getTime() + 150_000);
    await webhook({ ...body, meta: { ...body.meta, attempt: 4 } });
    await flush();
    expect(despachos()).toHaveLength(1);
    expect(w.relay.calls).toBe(1);
    expect(noticeLog().at(-1)).toContain('resultado=reentrega');
    expect(w.notes()).toHaveLength(1);
  });

  it('Codex 2: `uncertain` y falla vaciar el disparador; la reentrega a los 30 s no llama al relay; una elección nueva sí pasa', async () => {
    w.deal()[K.trigger] = OPT.send;
    w.relay.mode = 'sent_then_timeout';
    w.pd.intercept = failPut;
    const body = webhookBody(OPT.send);
    await webhook(body);
    await flush();
    expect(noticeLog().at(-1)).toContain('resultado=incierto');
    expect(w.deal()[K.trigger]).toBe(OPT.send);

    w.relay.mode = 'normal';
    w.pd.intercept = undefined;
    vi.setSystemTime(NOW.getTime() + 30_000);
    await webhook({ ...body, meta: { ...body.meta, attempt: 3 } });
    await flush();
    expect(w.relay.calls).toBe(1);
    expect(noticeLog().at(-1)).toContain('resultado=reentrega');

    // El dueño revisa Enviados, vacía el campo (no dispara) y vuelve a elegir: otro update_time.
    vi.setSystemTime(NOW.getTime() + 5 * 60_000);
    w.deal()[K.trigger] = null;
    await webhook(webhookBody(null, OPT.send, { data: { update_time: '2026-11-18T15:04:50Z' } }));
    w.deal()[K.trigger] = OPT.send;
    await webhook(webhookBody(OPT.send, null, { data: { update_time: '2026-11-18T15:05:00Z' } }));
    await flush();
    // Había salido: el relay responde duplicate, no hay un segundo correo y queda registrado.
    expect(w.relay.calls).toBe(2);
    expect(despachos()).toHaveLength(1);
    expect(noticeLog().at(-1)).toMatch(/resultado=ya_habia_salido .*relay=duplicate/);
    expect(w.deal()[K.trigger]).toBeNull();
    expect(w.deal()[K.sentLog]).toBe('2026-11-18 12:05 -03:00 · Starken 123456789');
  });

  it('un evento que llega por primera vez con intento 2 se procesa (el intento 1 pudo no correr)', async () => {
    w.deal()[K.trigger] = OPT.send;
    await webhook(webhookBody(OPT.send, null, { meta: { attempt: 2 } }));
    await flush();
    expect(despachos()).toHaveLength(1);
  });

  it('también en la vista previa: la reentrega no manda otra', async () => {
    w.pd.intercept = failPut;
    expect(await choose('preview', Date.now(), EVENT_TIME)).toBe('vista_previa_enviada');
    expect(await choose('preview', Date.now(), EVENT_TIME)).toBe('reentrega');
    expect(previews()).toHaveLength(1);
    expect(w.notes()).toHaveLength(1);
  });

  it('sin update_time: no envía al cliente; nota y el disparador vacío', async () => {
    expect(await choose('send', Date.now(), null)).toBe('sin_hora_evento');
    expect(w.relay.calls).toBe(0);
    expect(lastNote()).toBe('Aviso de despacho NO enviado: el aviso de Pipedrive llegó sin la hora del cambio (update_time) y sin ella no se puede distinguir de un reintento de Pipedrive.\nAvísale a Claude. Mientras tanto funciona «Vista previa».');
    expect(w.deal()[K.trigger]).toBeNull();
    expect(noticeLog().at(-1)).toContain('evento=sin_hora');
  });

  it('sin update_time, la vista previa sí sale (solo llega al dueño)', async () => {
    expect(await choose('preview', Date.now(), null)).toBe('vista_previa_enviada');
  });

  it('Redis falla al reservar la identidad: no envía al cliente', async () => {
    w.redis.intercept = (cmd, args) => (cmd === 'SET' && args[0].startsWith('aviso-despacho:v1:evento:') ? 'fail' : undefined);
    expect(await choose('send')).toBe('reintentar');
    expect(w.relay.calls).toBe(0);
    expect(noticeLog().at(-1)).toContain('evento=sin_reservar');
  });
});

describe('NOTICE_MAX_DURATION_S', () => {
  it('es el maxDuration de api/pipedrive/webhook.ts en vercel.json (60 s sin Fluid compute)', () => {
    const vercel = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf-8')) as { functions?: Record<string, { maxDuration?: number }> };
    expect(vercel.functions?.['api/pipedrive/webhook.ts']?.maxDuration).toBe(NOTICE_MAX_DURATION_S);
    expect(NOTICE_MAX_DURATION_S).toBe(60);
    expect(noticeDeadline(0)).toBe(50_000);
  });
});
