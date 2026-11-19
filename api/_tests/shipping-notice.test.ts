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

import handler from '../pipedrive/webhook';
import { createDealNote, putDealFields } from '../_lib/pipedrive/deals.js';
import { findDealFieldByName } from '../_lib/pipedrive/fieldOptions.js';
import { sendShippingNotice } from '../_lib/notify/shippingRelay.js';
import { SHIPPING_FIELD_NAMES } from '../_lib/shipping/fields.js';
import { MAX_DOCUMENT_BYTES } from '../_lib/shipping/files.js';
import { shippingNoticeKey } from '../_lib/shipping/key.js';
import {
  noticeDeadline,
  noticeLockKey,
  noticeStateKey,
  previewCountKey,
  previewMarkKey,
  processShippingNotice,
  MIN_RELAY_WINDOW_MS,
  NOTICE_MAX_DURATION_S,
  PREVIEW_LIMIT,
} from '../_lib/shipping/notice.js';
import { jpgBytes, pdfBytes, pipedriveTime } from './fakePipedrive';
import { DEAL_ID, EMAIL, K, NOW, OPT, OWNER_USER_ID, PERSONAL, PERSON_ID, requestNote, setupNoticeWorld, teardownNoticeWorld, type NoticeWorld } from './shippingFixture';
import { readFileSync } from 'node:fs';

let w: NoticeWorld;
const KEY = shippingNoticeKey(DEAL_ID, 'starken', '123456789');

beforeEach(() => {
  pending.length = 0;
  w = setupNoticeWorld();
  vi.mocked(createDealNote).mockClear();
  vi.mocked(putDealFields).mockClear();
  vi.mocked(sendShippingNotice).mockClear();
});

afterEach(() => {
  // Privacidad (§7): en ningún caso los registros llevan datos del cliente, la orden ni archivos.
  const text = w.logs.join('\n');
  for (const secret of [...PERSONAL, 'token-ficticio-pipedrive', 'api_token']) expect(text, secret).not.toContain(secret);
  teardownNoticeWorld();
});

/** El dueño elige una opción del disparador y llega el webhook (directo a processShippingNotice). */
function choose(option: 'preview' | 'send', startedAt = Date.now()) {
  w.deal()[K.trigger] = OPT[option];
  return processShippingNotice({ dealId: DEAL_ID, triggerKey: K.trigger, triggerOptionId: OPT[option], startedAt });
}

const lastNote = () => w.notes().at(-1) ?? '';
const despachos = () => w.relay.sent.filter((m) => m.action === 'despacho');
const previews = () => w.relay.sent.filter((m) => m.action === 'preview');
const noticeLog = () => w.logs.filter((l) => l.startsWith('[aviso-despacho] negocio='));

// ── Webhook ─────────────────────────────────────────────────────────────────

const USER = 'usuario-prueba';
const PASSWORD = 'clave-prueba';

function webhookBody(optionId: number | null, previousOption: number | null = null, extra: { previous?: Record<string, unknown>; data?: Record<string, unknown> } = {}) {
  return {
    meta: { action: 'change', entity: 'deal', entity_id: String(DEAL_ID), company_id: '777001', is_bulk_edit: false, version: '2.0', change_source: 'app', attempt: 1 },
    data: {
      id: DEAL_ID, status: 'open', stage_id: 21, pipeline_id: 2,
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
    expect(await choose('send')).toBe('enviado');
    expect(w.deal().stage_id).toBe(30);
    expect(lastNote()).toContain('Etapa: sin cambio (este embudo no tiene una etapa «Despachado»).');
    expect(vi.mocked(putDealFields).mock.calls.at(-1)?.[1]).not.toHaveProperty('stage_id');
  });

  it('guía de despacho: el asunto, el adjunto y la nota la nombran', async () => {
    w.deal()[K.documentType] = OPT.guia;
    w.deal()[K.documentNumber] = '291';
    w.pd.files[0].file_name = 'guia-291.pdf';
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
    expect(lastNote()).toContain('Productos: sin lista (el correo dice que el detalle va en la factura N° 1234 adjunta).');
    // Sin la marca de la vista previa, las notas no se leen.
    expect(w.pd.requests.some((r) => r.path === '/notes' && r.method === 'GET')).toBe(false);
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

  it('§8 capa 3 (relay): sin Redis ni «Aviso enviado» al día, el relay responde duplicate y cuenta como enviado', async () => {
    await choose('send');
    w.redis.data.delete(noticeStateKey(KEY));
    w.deal()[K.sentLog] = null;
    vi.setSystemTime(NOW.getTime() + 10 * 60_000);
    expect(await choose('send')).toBe('enviado');
    expect(despachos()).toHaveLength(1);
    expect(w.relay.calls).toBe(2);
    expect(noticeLog().at(-1)).toContain('relay=duplicate');
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

  it('si el dueño ya eligió otra opción mientras salía el aviso, el disparador no se toca', async () => {
    w.relay.onCall = () => { w.deal()[K.trigger] = OPT.preview; };
    expect(await choose('send')).toBe('enviado');
    expect(w.deal()[K.trigger]).toBe(OPT.preview);
    expect(vi.mocked(putDealFields).mock.calls[0][1]).not.toHaveProperty(K.trigger);
    expect(w.deal()[K.sentLog]).toBe('2026-11-18 12:00 -03:00 · Starken 123456789');
  });

  it('el disparador ya cambió cuando llega el webhook: no hace nada (la fuente de verdad es el negocio)', async () => {
    w.deal()[K.trigger] = OPT.preview;
    expect(await processShippingNotice({ dealId: DEAL_ID, triggerKey: K.trigger, triggerOptionId: OPT.send, startedAt: Date.now() })).toBe('disparador_cambio');
    expect(w.relay.calls).toBe(0);
    expect(w.notes()).toEqual([]);
    expect(w.deal()[K.trigger]).toBe(OPT.preview);
  });
});

// ── Lo que detiene el aviso (§8) ────────────────────────────────────────────

describe('§8 falta algo: nota «NO enviado» con la lista exacta y el disparador vacío', () => {
  const cases: Array<[string, (w: NoticeWorld) => void, string[]]> = [
    ['faltan el operador y la orden', (w) => { w.deal()[K.carrier] = null; w.deal()[K.order] = ''; }, [`- Falta «${SHIPPING_FIELD_NAMES.carrier}».`, `- Falta «${SHIPPING_FIELD_NAMES.order}».`]],
    ['la persona no tiene correo', (w) => { w.pd.persons.get(PERSON_ID)!.email = []; }, ['- La persona del negocio no tiene correo: agrégalo en la persona.']],
    ['la persona ya no existe', (w) => { w.pd.persons.delete(PERSON_ID); }, ['- La persona del negocio ya no existe en Pipedrive: agrega la persona del cliente, con su correo.']],
    ['un SKU desconocido sin texto', (w) => { w.deal()[K.products] = '10 PAN60\n2 NOEXISTE'; }, [`- «${SHIPPING_FIELD_NAMES.products}», línea 2 («2 NOEXISTE»): el SKU NOEXISTE no está en el catálogo publicado. Corrígelo o agrega « — <texto como en la factura>».`]],
    ['el PDF pesa demasiado (por file_size, sin descargar)', (w) => { w.pd.files[0].file_size = MAX_DOCUMENT_BYTES + 1; }, ['- El PDF «factura-1234.pdf» pesa 3 MB: el máximo es 3 MB.']],
    ['el «PDF» es una foto (tipo por los primeros bytes)', (w) => { w.pd.files[0].bytes = jpgBytes(2048); }, ['- El PDF «factura-1234.pdf» no es un PDF: adjunta la factura N° 1234 en PDF.']],
    ['hay 2 PDF sin el número en el nombre', (w) => { w.pd.files[0].file_name = 'doc-a.pdf'; w.addFile('doc-b.pdf', pdfBytes()); }, ['- Hay 2 PDF y ninguno lleva el N° 1234 en el nombre («doc-b.pdf», «doc-a.pdf»): deja solo el de la factura N° 1234 o ponle el número en el nombre.']],
    ['2 fotos candidatas a comprobante', (w) => { w.pd.files[1].file_name = 'foto-1.jpg'; w.addFile('foto-2.jpg', jpgBytes()); }, ['- Hay 2 fotos («foto-2.jpg», «foto-1.jpg») y ninguna dice «comprobante» o «voucher» en el nombre: deja solo la del comprobante.']],
    ['un PDF del cliente de /cotizador de hace 10 días no cuenta', (w) => { w.pd.files[0].add_time = pipedriveTime(new Date(NOW.getTime() - 10 * 86_400_000)); }, ['- Falta el PDF de la factura N° 1234: adjúntalo en Archivos del negocio (cuenta solo uno agregado en los últimos 7 días; no cuentan los adjuntos de correos).']],
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

  it('el relay no responde a tiempo: `uncertain`, nota «no sé si salió», sin reintento; al reintentar, duplicate cuenta como enviado sin un segundo correo', async () => {
    w.relay.mode = 'sent_then_timeout';
    expect(await choose('send')).toBe('incierto');
    expect(w.relay.calls).toBe(1);
    expect(w.redis.data.get(noticeStateKey(KEY))?.value).toBe('uncertain');
    expect(lastNote()).toBe('Aviso de despacho: no sé si salió (sin respuesta a tiempo).\nRevisa Enviados (el asunto sin «[Vista previa]»); si no está, vuelve a elegir «Enviar al cliente». Si ya había salido, el relay no lo repite.');
    expect(w.deal()[K.trigger]).toBeNull();
    expect(w.deal()[K.sentLog]).toBeNull();

    w.relay.mode = 'normal';
    vi.setSystemTime(NOW.getTime() + 15 * 60_000);
    expect(await choose('send')).toBe('enviado');
    expect(despachos()).toHaveLength(1);
    expect(w.relay.calls).toBe(2);
    expect(w.deal()[K.sentLog]).toBe('2026-11-18 12:15 -03:00 · Starken 123456789');
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
    w.deal()[K.order] = '';
    await choose('send');
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
    expect(body).toContain(`Falta registrar a mano: «${SHIPPING_FIELD_NAMES.sentLog}», la etapa y vaciar «${SHIPPING_FIELD_NAMES.trigger}».`);
    expect(body).toContain(`En «${SHIPPING_FIELD_NAMES.sentLog}» va: 2026-11-18 12:00 -03:00 · Starken 123456789`);
    expect(w.notes()[0]).toMatch(/^Aviso de despacho enviado/);
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

describe('NOTICE_MAX_DURATION_S', () => {
  it('es el maxDuration de api/pipedrive/webhook.ts en vercel.json (60 s sin Fluid compute)', () => {
    const vercel = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf-8')) as { functions?: Record<string, { maxDuration?: number }> };
    expect(vercel.functions?.['api/pipedrive/webhook.ts']?.maxDuration).toBe(NOTICE_MAX_DURATION_S);
    expect(NOTICE_MAX_DURATION_S).toBe(60);
    expect(noticeDeadline(0)).toBe(50_000);
  });
});
