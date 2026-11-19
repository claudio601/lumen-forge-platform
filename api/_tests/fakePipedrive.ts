// api/_tests/fakePipedrive.ts
// Pipedrive y relay del aviso de despacho simulados, en memoria, para las pruebas del aviso
// (api/_tests/shipping-notice.test.ts). Se instalan como fetch junto a fakeUpstash: lo que va a
// PIPEDRIVE_BASE_URL lo responde el Pipedrive simulado; lo que va a SHIPPING_RELAY_URL, el relay
// simulado; lo demás (Upstash y el relay de ventas@), fakeFetch de fakeUpstash.
//
// Pipedrive: GET y PUT /deals/{id}, GET /persons/{id}, GET y POST /notes (paginado y ordenado como
// listDealNotes), GET /deals/{id}/files (paginado), GET /files/{id}/download (los bytes),
// GET /dealFields, GET /stages?pipeline_id= y POST /activities.
// Relay: comprueba la firma HMAC con el secreto de prueba y la versión, deduplica `despacho` por
// clave (como PropertiesService en Code.gs) y guarda lo «enviado». `respond` simula fallas.
// Datos siempre ficticios. No es una prueba ni una función: vive en api/_tests/ para que Vercel no lo
// despliegue.

import { vi } from 'vitest';
import { signShippingPayload } from '../_lib/notify/shippingRelay.js';
import { fakeFetch, type FakeRedis } from './fakeUpstash.js';

export const PIPEDRIVE_URL = 'https://pipedrive.example/v1';
export const RELAY_URL = 'https://relay.example/macros/s/prueba/exec';
/** Secreto de prueba (no es de nadie): 64 caracteres. */
export const RELAY_SECRET = 'f'.repeat(64);

export interface FakeNote {
  id: number;
  deal_id: number;
  content: string;
  /** 'aaaa-mm-dd hh:mm:ss' en UTC. */
  add_time: string;
}

export interface FakeFile {
  id: number;
  deal_id: number;
  /** El nombre visible (con extensión). */
  name: string;
  /** Como la API real: la clave del almacenamiento, sin extensión. */
  file_name: string;
  add_time: string;
  file_size: number;
  active_flag: boolean;
  inline_flag?: boolean;
  remote_location?: string | null;
  mail_message_id?: number | null;
  bytes: Uint8Array;
}

export interface FakeRequest {
  method: string;
  path: string;
  body?: Record<string, unknown>;
}

export interface FakePipedrive {
  deals: Map<number, Record<string, unknown>>;
  persons: Map<number, Record<string, unknown>>;
  notes: FakeNote[];
  files: FakeFile[];
  dealFields: Record<string, unknown>[];
  stages: { id: number; name: string; pipeline_id: number; active_flag?: boolean }[];
  activities: Record<string, unknown>[];
  /** Cada llamada, sin la consulta (para contar y revisar el orden). */
  requests: FakeRequest[];
  /**
   * Falla simulada: una Response reemplaza la respuesta (sin aplicar la escritura); 'timeout' lanza
   * como un plazo agotado; 'after' aplica la escritura y después responde `response` (se perdió).
   */
  intercept?: (req: FakeRequest) => Response | 'timeout' | { after: Response } | undefined;
  nextId: number;
}

export function createFakePipedrive(): FakePipedrive {
  return {
    deals: new Map(),
    persons: new Map(),
    notes: [],
    files: [],
    dealFields: [],
    stages: [],
    activities: [],
    requests: [],
    nextId: 90_000,
  };
}

/** 'aaaa-mm-dd hh:mm:ss' en UTC, como lo guarda Pipedrive. */
export function pipedriveTime(at: Date): string {
  return at.toISOString().slice(0, 19).replace('T', ' ');
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const notFound = () => json({ success: false, error: 'Not found', errorCode: 404 }, 404);

function page<T>(items: T[], url: URL) {
  const start = Number(url.searchParams.get('start') ?? 0);
  const limit = Number(url.searchParams.get('limit') ?? 100);
  const slice = items.slice(start, start + limit);
  const more = start + limit < items.length;
  return json({
    success: true,
    data: slice.length ? slice : null,
    additional_data: { pagination: { start, limit, more_items_in_collection: more, ...(more ? { next_start: start + limit } : {}) } },
  });
}

function timeoutError(): Error {
  const err = new Error('This operation was aborted');
  err.name = 'AbortError';
  return err;
}

function pipedriveResponse(pd: FakePipedrive, method: string, url: URL, body: Record<string, unknown> | undefined): Response {
  const path = url.pathname.replace(/^\/v1/, '');
  let m: RegExpExecArray | null;

  if (method === 'GET' && (m = /^\/deals\/(\d+)$/.exec(path))) {
    const deal = pd.deals.get(Number(m[1]));
    return deal ? json({ success: true, data: structuredClone(deal) }) : notFound();
  }
  if (method === 'PUT' && (m = /^\/deals\/(\d+)$/.exec(path))) {
    const deal = pd.deals.get(Number(m[1]));
    if (!deal) return notFound();
    Object.assign(deal, body ?? {});
    return json({ success: true, data: structuredClone(deal) });
  }
  if (method === 'GET' && (m = /^\/persons\/(\d+)$/.exec(path))) {
    const person = pd.persons.get(Number(m[1]));
    return person ? json({ success: true, data: structuredClone(person) }) : notFound();
  }
  if (method === 'GET' && path === '/notes') {
    const dealId = Number(url.searchParams.get('deal_id'));
    const notes = pd.notes
      .filter((n) => n.deal_id === dealId)
      .sort((a, b) => b.add_time.localeCompare(a.add_time) || b.id - a.id);
    return page(notes, url);
  }
  if (method === 'POST' && path === '/notes') {
    const note: FakeNote = { id: pd.nextId++, deal_id: Number(body?.deal_id), content: String(body?.content ?? ''), add_time: pipedriveTime(new Date()) };
    pd.notes.push(note);
    return json({ success: true, data: note });
  }
  if (method === 'GET' && (m = /^\/deals\/(\d+)\/files$/.exec(path))) {
    const dealId = Number(m[1]);
    const files = pd.files
      .filter((f) => f.deal_id === dealId)
      .sort((a, b) => b.id - a.id)
      .map(({ bytes: _bytes, ...meta }) => meta);
    return page(files, url);
  }
  if (method === 'GET' && (m = /^\/files\/(\d+)\/download$/.exec(path))) {
    const file = pd.files.find((f) => f.id === Number(m![1]));
    if (!file) return notFound();
    return new Response(file.bytes, { status: 200, headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(file.bytes.length) } });
  }
  if (method === 'GET' && path === '/dealFields') return json({ success: true, data: structuredClone(pd.dealFields) });
  if (method === 'GET' && path === '/stages') {
    const pipelineId = Number(url.searchParams.get('pipeline_id'));
    return json({ success: true, data: pd.stages.filter((s) => s.pipeline_id === pipelineId) });
  }
  if (method === 'POST' && path === '/activities') {
    const activity = { id: pd.nextId++, ...body };
    pd.activities.push(activity);
    return json({ success: true, data: activity });
  }
  throw new Error(`Pipedrive no simulado: ${method} ${path}`);
}

// ── Relay del aviso ─────────────────────────────────────────────────────────

export interface RelayMail {
  action: 'preview' | 'despacho';
  key: string;
  to: string | null;
  subject: string;
  html: string;
  text: string;
  attachments: { name: string; mimeType: string; size: number }[];
}

export type RelayMode =
  /** Responde lo que corresponde (ok o duplicate). */
  | 'normal'
  /** Envía y no responde a tiempo (el cliente da `uncertain`). */
  | 'sent_then_timeout'
  /** No envía y no responde a tiempo. */
  | 'timeout'
  /** Envía y responde una página HTML 500 (`uncertain`). */
  | 'sent_then_html'
  | 'quota'
  /** `rejected` con `rejectReason` (por defecto `config`). */
  | 'rejected'
  /** `uncertain` con el motivo `pendiente`: una ejecución anterior reservó la clave y no confirmó. */
  | 'pending';

export interface FakeRelay {
  /** Correos que «salieron» (vista previa al dueño y avisos al cliente). */
  sent: RelayMail[];
  /** Claves de despacho registradas (PropertiesService). */
  keys: Set<string>;
  /** Llamadas recibidas (también las rechazadas). */
  calls: number;
  mode: RelayMode;
  /** Código de `rejected` (Code.gs): `config`, `reenvio`, `cache`… */
  rejectReason?: string;
  /** Antes de responder (p. ej., para cambiar el disparador mientras el relay trabaja). */
  onCall?: () => void;
}

export function createFakeRelay(): FakeRelay {
  return { sent: [], keys: new Set(), calls: 0, mode: 'normal' };
}

async function relayResponse(relay: FakeRelay, init: RequestInit | undefined): Promise<Response> {
  relay.calls++;
  relay.onCall?.();
  const { ts, payload, sig } = JSON.parse(String(init?.body)) as { ts: number; payload: string; sig: string };
  if (sig !== signShippingPayload(RELAY_SECRET, ts, payload)) return json({ status: 'rejected', reason: 'firma' });
  if (Math.abs(Date.now() / 1000 - ts) > 300) return json({ status: 'rejected', reason: 'hora' });
  const p = JSON.parse(payload) as {
    v: number; action: 'preview' | 'despacho'; key: string; to?: string; subject: string; html: string; text: string;
    attachments: { name: string; mimeType: string; data: string }[];
  };
  if (p.v !== 1) return json({ status: 'rejected', reason: 'version' });
  if (relay.mode === 'quota') return json({ status: 'quota' });
  if (relay.mode === 'rejected') return json({ status: 'rejected', reason: relay.rejectReason ?? 'config' });
  if (relay.mode === 'pending') return json({ status: 'uncertain', reason: 'pendiente' });
  if (relay.mode === 'timeout') throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
  if (p.action === 'despacho' && relay.keys.has(p.key)) return json({ status: 'duplicate' });
  relay.sent.push({
    action: p.action,
    key: p.key,
    to: p.action === 'despacho' ? p.to ?? null : null,
    subject: p.subject,
    html: p.html,
    text: p.text,
    attachments: p.attachments.map((a) => ({ name: a.name, mimeType: a.mimeType, size: Buffer.from(a.data, 'base64').length })),
  });
  if (p.action === 'despacho') relay.keys.add(p.key);
  if (relay.mode === 'sent_then_timeout') throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
  if (relay.mode === 'sent_then_html') return new Response('<html>Error interno</html>', { status: 500 });
  return json({ status: 'ok' });
}

/** fetch simulado: Pipedrive, el relay del aviso y, para lo demás, fakeFetch de fakeUpstash. */
export function fakeNoticeFetch(redis: FakeRedis, pd: FakePipedrive, relay: FakeRelay) {
  const upstash = fakeFetch(redis);
  return vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith(RELAY_URL)) return relayResponse(relay, init);
    if (url.startsWith(PIPEDRIVE_URL + '/')) {
      const parsed = new URL(url);
      const method = init?.method ?? 'GET';
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
      const req: FakeRequest = { method, path: parsed.pathname.replace(/^\/v1/, ''), ...(body ? { body } : {}) };
      pd.requests.push(req);
      const failure = pd.intercept?.(req);
      if (failure === 'timeout') throw timeoutError();
      if (failure instanceof Response) return failure;
      const response = pipedriveResponse(pd, method, parsed, body);
      return failure && 'after' in failure ? failure.after : response;
    }
    return upstash(input, init);
  });
}

// ── Archivos de prueba ──────────────────────────────────────────────────────

/** Un PDF mínimo (solo la firma y relleno): `size` bytes. */
export function pdfBytes(size = 2048): Uint8Array {
  const bytes = new Uint8Array(size).fill(0x20);
  bytes.set(new TextEncoder().encode('%PDF-1.4\n'), 0);
  return bytes;
}

/** Un JPG mínimo (solo la firma y relleno). */
export function jpgBytes(size = 4096): Uint8Array {
  const bytes = new Uint8Array(size).fill(0);
  bytes.set([0xff, 0xd8, 0xff, 0xe0], 0);
  return bytes;
}
