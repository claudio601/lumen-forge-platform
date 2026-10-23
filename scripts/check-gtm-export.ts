// scripts/check-gtm-export.ts
// ─────────────────────────────────────────────────────────────────────────────
// Revisión estática de la exportación del contenedor nuevo del sitio (Etapa 2 · PR 14,
// especificación de medición para la agencia, secciones 4.2, 5.1, 5.2, 6 y 7.2). Es el criterio
// de salida de la fase A: la agencia exporta el espacio de trabajo en JSON (Administrar →
// Exportar contenedor) y eLIGHTS lo revisa con este script antes de publicar la versión 1.
//
// Qué revisa (todo bloquea, salvo lo que dice «nota»):
//   1. Solo las etiquetas de la tabla 6.4: etiqueta de Google AW-774649578 (G01), vinculador de
//      conversiones (G02), las 5 conversiones de Google Ads de la tabla 4.1 (A01 a A05),
//      etiqueta de Google G-C06JF3ZNH5 (GA01), dos eventos de GA4 (page_view y {{Event}}) y
//      hasta 3 etiquetas del píxel de Meta (PageView, Contact y Lead). Ninguna de HTML
//      personalizado, ninguna plantilla de CMP y nada que fije el consentimiento.
//   2. Consentimiento adicional exacto: ad_storage y ad_user_data en G01 y A01 a A05;
//      ad_storage en G02; analytics_storage en GA01 a GA03; ninguno en Meta. Ninguna exige
//      ad_personalization.
//   3. Excepciones, leídas por lo que hacen (no por el nombre), las de la v1.3 (tabla 6.4, fase
//      A2 con Google Ads y Meta, decisión 9 del dueño del 22-10-2026): X01b (host fuera de
//      elights.cl, www y nuevo.elights.cl), X02b (elights.cl o www con elights_env = test) y X04
//      (fuera de producción sin Tag Assistant) en G01, G02, A01 a A05 y M01 a M03; X01 (host
//      fuera de elights.cl y www) y X02 (elights_env = test) en GA01 a GA03; X03 (meta_consent
//      distinto de granted) en Meta. La variable integrada Debug Mode, habilitada. Con
//      --sin-fase-a2, el juego de la v1.2: X01 y X02 en todas (y X03 en Meta).
//   4. Activadores: cada etiqueta con el suyo (tabla 6.3), las de configuración una vez por
//      página con Inicialización y elights_consent_update. T07: link_url contiene
//      ventas@elights.cl y no contiene subject=Datos (decisión 13: solo ventas@).
//   5. Ajustes: send_page_view: false, Signals y personalización apagados y cookies de 395 días
//      en GA4; la etiqueta de Google de Ads con sus cookies por defecto (_gcl_…, 90 días);
//      conversiones sin valor, sin ID de transacción ni conversiones mejoradas; vinculador sin
//      dominios cruzados ni cambios de cookies.
//   6. Meta (techo de la política 1.5): un solo ID de píxel (590822921694460), plantilla «Meta
//      Pixel» v2.0.9 de facebook, autoConfig y el historial apagados, sin coincidencia avanzada,
//      sin la API de conversiones de Meta, sin comercio electrónico, «Consent Granted» en true.
//      PageView sin parámetros; Lead con content_name desde una tabla de consulta de form_type
//      con exactamente las 5 filas, y Contact desde una de link_type con exactamente las 3, cada
//      valor a sí mismo y sin valor por defecto.
//   7. Permisos de la plantilla de Meta (templateData): solo los de la v2.0.9, y «Inyecta
//      scripts» limitado a fbevents.js. La v2.0.9 puede inyectar clientParamBuilder desde
//      cdn.jsdelivr.net o unpkg.com si Meta lo enciende desde su servidor (gate
//      enable_gtm_parambuilder), sin casilla para apagarlo: la agencia edita ese permiso en el
//      contenedor (sección 5.2) y así no puede ocurrir.
//
// Uso (manual; no corre en CI):
//   npm run check:gtm-export -- reports/gtm/contenedor-sitio.json
//   npm run check:gtm-export -- export.json --sin-fase-a2   (excepciones de la v1.2)
// Código de salida: 0 aprobada · 1 no pasa · 2 uso incorrecto o archivo ilegible. Sin red.
// Los IDs son públicos (van en el HTML de la tienda); el del contenedor no se necesita.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ADS_CONVERSION_ID = '774649578';
export const ADS_TAG_ID = 'AW-' + ADS_CONVERSION_ID;
export const GA4_ID = 'G-C06JF3ZNH5';
export const META_PIXEL_ID = '590822921694460';
/** Commit de la plantilla «Meta Pixel» v2.0.9 (metadata.yaml del repositorio, 19-09-2026). */
export const META_TEMPLATE_VERSION = '08b9bbba509d6f10f6ad2bd39207ed814e96cbbe';
/** Lo único que la plantilla de Meta puede inyectar (sección 5.2): el script del píxel. */
export const META_ALLOWED_SCRIPTS: readonly string[] = ['https://connect.facebook.net/en_US/fbevents.js'];
/** Permisos de la plantilla v2.0.9. Ninguno más: ni enviar píxeles, ni cookies, ni iframes. */
export const META_TEMPLATE_PERMISSIONS: readonly string[] = ['access_globals', 'inject_script', 'logging', 'read_data_layer', 'get_url'];
/** Correo comercial: el único que cuenta como conversión de correo (decisión 13, T07). */
export const SALES_EMAIL = 'ventas@elights.cl';
/** cookie_expires de GA4: 395 días (la política dice «hasta 13 meses»). */
export const GA_COOKIE_EXPIRES = '34128000';

/** Rol de un activador del sitio (tabla 6.3). */
export type TriggerRole =
  | 'init'
  | 'consent_update'
  | 'page_view'
  | 'meta_granted'
  | 'whatsapp'
  | 'email'
  | 'phone'
  | 'lead_orders'
  | 'lead_services'
  | 'lead_all'
  | 'site_events';

/** Las 5 conversiones que se mantienen (tabla 4.1) y el activador de cada una. */
export const ADS_CONVERSIONS: Readonly<Record<string, TriggerRole>> = Object.freeze({
  qir3CMj3gJcdEOrtsPEC: 'whatsapp',
  OpoRCKTu8b4YEOrtsPEC: 'email',
  '7gCtCLOm-b4YEOrtsPEC': 'phone',
  zigQCPDOhJUZEOrtsPEC: 'lead_orders',
  '7oTxCMX3gJcdEOrtsPEC': 'lead_services',
});

/** Eventos del sitio que van a GA4 (tabla 3.4; los mismos de SITE_EVENTS en src/lib/analytics.ts). */
export const SITE_EVENTS: readonly string[] = [
  'generate_lead',
  'whatsapp_click',
  'contact_email_click',
  'contact_phone_click',
  'add_to_quote',
  'request_cart_add',
  'request_cart_view',
  'request_cart_remove',
  'request_form_start',
  'request_form_submit_error',
  'cotizacion_form_submit_error',
  'cotizador_submit_error',
  'estudio_luminico_form_submit',
  'estudio_luminico_form_submit_error',
  'instalacion_form_view',
  'instalacion_form_submit_attempt',
  'instalacion_form_submit_failure',
  'estudio_luminico_cta_hero_click',
  'instalacion_cta_hero_click',
  'instalacion_cta_final_click',
  'guia_cta_click',
];

/** Parámetros de evento del sitio (tabla 3.5, sin las claves de estado). */
export const EVENT_PARAMS: readonly string[] = [
  'page_location', 'page_path', 'form_type', 'currency', 'item_count', 'lead_type', 'project_type',
  'tipo_proyecto', 'tiene_planos', 'objetivo_proyecto', 'normativa_objetivo', 'urgencia_proyecto',
  'link_url', 'link_type', 'item_id', 'quantity', 'unit_price', 'subtotal', 'customer_type',
  'reason', 'http_status', 'error_message',
];

/** content_name: la lista cerrada de 8 valores (decisión 1a del dueño; Política de privacidad 1.5). */
export const CONTENT_NAME_VALUES: readonly string[] = [
  'cotizacion', 'solicitud_pedido', 'cotizador', 'estudio_luminico', 'instalacion',
  'whatsapp', 'email', 'phone',
];

/** Las dos tablas de content_name (sección 6.2): de qué lee cada una y sus filas exactas. */
export const CONTENT_NAME_TABLES: Readonly<Record<'Lead' | 'Contact', { input: string; values: readonly string[] }>> = Object.freeze({
  Lead: { input: 'form_type', values: ['cotizacion', 'solicitud_pedido', 'cotizador', 'estudio_luminico', 'instalacion'] },
  Contact: { input: 'link_type', values: ['whatsapp', 'email', 'phone'] },
});

/** Lo que Meta puede recibir (techo, regla 2.1-10) y los activadores de cada evento. */
export const META_EVENTS: Readonly<Record<string, readonly TriggerRole[]>> = Object.freeze({
  PageView: ['page_view', 'meta_granted'],
  Contact: ['whatsapp', 'email', 'phone'],
  Lead: ['lead_all'],
});

const LEAD_ORDERS = ['solicitud_pedido', 'cotizacion', 'cotizador'];
const LEAD_SERVICES = ['estudio_luminico', 'instalacion'];

// ── Formato de la exportación ────────────────────────────────────────────────

export interface GtmParam {
  type?: string;
  key?: string;
  value?: string;
  list?: GtmParam[];
  map?: GtmParam[];
}
export interface GtmCondition {
  type: string;
  parameter?: GtmParam[];
}
export interface GtmTag {
  tagId?: string;
  name: string;
  type: string;
  parameter?: GtmParam[];
  firingTriggerId?: string[];
  blockingTriggerId?: string[];
  tagFiringOption?: string;
  paused?: boolean;
  consentSettings?: { consentStatus?: string; consentType?: GtmParam };
}
export interface GtmTrigger {
  triggerId: string;
  name: string;
  type: string;
  customEventFilter?: GtmCondition[];
  filter?: GtmCondition[];
  autoEventFilter?: GtmCondition[];
}
export interface GtmVariable {
  variableId?: string;
  name: string;
  type: string;
  parameter?: GtmParam[];
}
export interface GtmTemplate {
  templateId: string;
  containerId?: string;
  name: string;
  galleryReference?: { host?: string; owner?: string; repository?: string; version?: string; isModified?: boolean };
  /** El código de la plantilla (secciones ___INFO___, ___WEB_PERMISSIONS___, etc.). */
  templateData?: string;
}
export interface GtmExport {
  exportFormatVersion?: number;
  containerVersion?: {
    tag?: GtmTag[];
    trigger?: GtmTrigger[];
    variable?: GtmVariable[];
    builtInVariable?: { type: string; name: string }[];
    customTemplate?: GtmTemplate[];
  };
}

const paramOf = (params: GtmParam[] | undefined, key: string) => params?.find(p => p.key === key);
const valueOf = (params: GtmParam[] | undefined, key: string) => paramOf(params, key)?.value;
const isTrue = (params: GtmParam[] | undefined, key: string) => valueOf(params, key) === 'true';

/** Filas de una tabla (LIST de MAP) como objetos clave → valor. */
function rows(params: GtmParam[] | undefined, key: string): Record<string, string>[] {
  return (paramOf(params, key)?.list ?? []).map(row => {
    const out: Record<string, string> = {};
    for (const cell of row.map ?? []) if (cell.key) out[cell.key] = cell.value ?? '';
    return out;
  });
}

/** Tabla parámetro → valor de una etiqueta de Google o de un evento de GA4. */
function settingsTable(tag: GtmTag, key: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of rows(tag.parameter, key)) if (row.parameter) out[row.parameter] = row.parameterValue ?? '';
  return out;
}

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');

/** Los tipos de consentimiento adicional que exige la etiqueta (vacío si no exige ninguno). */
export function consentTypes(tag: GtmTag): string[] {
  const cs = tag.consentSettings;
  if (!cs || cs.consentStatus !== 'NEEDED') return [];
  return (cs.consentType?.list ?? []).map(p => p.value ?? '').filter(Boolean);
}

// ── Variables y condiciones ──────────────────────────────────────────────────

/** A qué se refiere el lado izquierdo de una condición o una variable usada como valor. */
export type Operand = { kind: 'host' } | { kind: 'event' } | { kind: 'debug' } | { kind: 'dlv'; name: string; v2: boolean; hasDefault: boolean } | { kind: 'other'; ref: string };

export class ExportIndex {
  readonly tags: GtmTag[];
  readonly triggers = new Map<string, GtmTrigger>();
  readonly variables = new Map<string, GtmVariable>();
  readonly builtIns = new Map<string, string>();
  readonly templates: GtmTemplate[];

  constructor(exp: GtmExport) {
    const cv = exp.containerVersion ?? {};
    this.tags = cv.tag ?? [];
    for (const t of cv.trigger ?? []) this.triggers.set(t.triggerId, t);
    for (const v of cv.variable ?? []) this.variables.set(v.name, v);
    for (const b of cv.builtInVariable ?? []) this.builtIns.set(b.name, b.type);
    this.templates = cv.customTemplate ?? [];
  }

  /** '{{Nombre}}' → lo que es esa variable. */
  operand(ref: string | undefined): Operand {
    const m = /^\{\{(.+)\}\}$/.exec((ref ?? '').trim());
    if (!m) return { kind: 'other', ref: ref ?? '' };
    const name = m[1];
    if (name === '_event' || name === 'Event' || this.builtIns.get(name) === 'EVENT') return { kind: 'event' };
    if (this.builtIns.get(name) === 'PAGE_HOSTNAME' || name === 'Page Hostname') return { kind: 'host' };
    if (this.builtIns.get(name) === 'DEBUG_MODE' || name === 'Debug Mode') return { kind: 'debug' };
    const v = this.variables.get(name);
    if (v?.type === 'v') {
      return {
        kind: 'dlv',
        name: valueOf(v.parameter, 'name') ?? '',
        v2: (valueOf(v.parameter, 'dataLayerVersion') ?? '2') === '2',
        hasDefault: isTrue(v.parameter, 'setDefaultValue'),
      };
    }
    if (v?.type === 'u' && valueOf(v.parameter, 'component') === 'HOST') return { kind: 'host' };
    return { kind: 'other', ref: name };
  }

  /** La plantilla de una etiqueta cvt_… (o undefined). */
  template(tag: GtmTag): GtmTemplate | undefined {
    if (!tag.type.startsWith('cvt_')) return undefined;
    return this.templates.find(t => tag.type === `cvt_${t.containerId}_${t.templateId}` || tag.type.endsWith('_' + t.templateId));
  }
}

interface Cond {
  op: string;
  negate: boolean;
  left: Operand;
  right: string;
}

function readCondition(ix: ExportIndex, c: GtmCondition): Cond {
  return {
    op: c.type,
    negate: isTrue(c.parameter, 'negate'),
    left: ix.operand(valueOf(c.parameter, 'arg0')),
    right: valueOf(c.parameter, 'arg1') ?? '',
  };
}

function safeRegex(source: string, ignoreCase = false): RegExp | null {
  try {
    return new RegExp(source, ignoreCase ? 'i' : '');
  } catch {
    return null;
  }
}

/** Hosts que nunca deben pasar por una regla de host del sitio. */
const LOOKALIKE_HOSTS = ['xelights.cl', 'elights.cl.evil.com', 'www.elights.cl.evil.com', 'wwwxelights.cl', 'tienda.elights.cl', 'evil.com', 'elights.cl.vercel.app', 'xnuevo.elights.cl', 'nuevo.elights.cl.evil.com'];

/** 'prod': solo elights.cl y www; 'prod+nuevo': también nuevo.elights.cl (fase A2); null: otra cosa. */
export function hostRule(regexSource: string): 'prod' | 'prod+nuevo' | null {
  const re = safeRegex(regexSource);
  if (!re) return null;
  if (!re.test('elights.cl') || !re.test('www.elights.cl') || LOOKALIKE_HOSTS.some(h => re.test(h))) return null;
  return re.test('nuevo.elights.cl') ? 'prod+nuevo' : 'prod';
}

const isDlv = (o: Operand, name: string) => o.kind === 'dlv' && o.name === name;

/** Una regex de eventos que acepta exactamente los nombres de `want` (y ninguno parecido). */
function regexSelectsExactly(source: string, want: readonly string[], others: readonly string[]): boolean {
  const re = safeRegex(source);
  if (!re) return false;
  const near = want.flatMap(w => ['x' + w, w + 'x']);
  return want.every(w => re.test(w)) && ![...others, ...near].some(o => re.test(o));
}

/** El evento al que responde un activador de evento personalizado: { equals } o { regex }. */
function eventMatch(ix: ExportIndex, t: GtmTrigger): { equals?: string; regex?: string } | null {
  const conds = (t.customEventFilter ?? []).map(c => readCondition(ix, c));
  if (conds.length !== 1 || conds[0].left.kind !== 'event' || conds[0].negate) return null;
  if (conds[0].op === 'EQUALS') return { equals: conds[0].right };
  if (conds[0].op === 'MATCH_REGEX') return { regex: conds[0].right };
  return null;
}

const normType = (type: string) => type.replace(/_/g, '').toUpperCase();

/** Rol de un activador de disparo (tabla 6.3), o null si no es ninguno de los del sitio. */
export function triggerRole(ix: ExportIndex, t: GtmTrigger): TriggerRole | null {
  const type = normType(t.type);
  const filters = (t.filter ?? []).map(c => readCondition(ix, c));
  if (type === 'INIT') return filters.length === 0 ? 'init' : null;
  if (type !== 'CUSTOMEVENT') return null;
  const ev = eventMatch(ix, t);
  if (!ev) return null;
  if (ev.regex !== undefined) {
    const others = ['elights_page_view', 'elights_consent_update', 'elights_meta_granted', 'gtm.js', 'gtm.dom', 'gtm.load', 'page_view'];
    return filters.length === 0 && regexSelectsExactly(ev.regex, SITE_EVENTS, others) ? 'site_events' : null;
  }
  const simple: Record<string, TriggerRole> = {
    elights_consent_update: 'consent_update',
    elights_page_view: 'page_view',
    elights_meta_granted: 'meta_granted',
    whatsapp_click: 'whatsapp',
    contact_phone_click: 'phone',
  };
  if (simple[ev.equals!] && filters.length === 0) return simple[ev.equals!];
  if (ev.equals === 'contact_email_click') {
    // T07 de la v1.3 (decisión 13): link_url contiene ventas@elights.cl y no contiene
    // subject=Datos, en cualquier orden. Sin la primera, contaría también contacto@.
    const onLink = (f: Cond) => isDlv(f.left, 'link_url') && f.op === 'CONTAINS';
    const sales = filters.filter(f => onLink(f) && !f.negate && f.right === SALES_EMAIL).length;
    const notData = filters.filter(f => onLink(f) && f.negate && f.right === 'subject=Datos').length;
    return filters.length === 2 && sales === 1 && notData === 1 ? 'email' : null;
  }
  if (ev.equals === 'generate_lead') {
    if (filters.length === 0) return 'lead_all';
    const f = filters[0];
    if (filters.length !== 1 || !isDlv(f.left, 'form_type') || f.op !== 'MATCH_REGEX' || f.negate) return null;
    if (regexSelectsExactly(f.right, LEAD_ORDERS, LEAD_SERVICES)) return 'lead_orders';
    if (regexSelectsExactly(f.right, LEAD_SERVICES, LEAD_ORDERS)) return 'lead_services';
  }
  return null;
}

/** Tipo de excepción (sección 6.3 y fase A2), leída por sus condiciones. */
export type ExceptionKind = 'X01' | 'X02' | 'X03' | 'X01b' | 'X02b' | 'X04';

export function exceptionKind(ix: ExportIndex, t: GtmTrigger): ExceptionKind | null {
  if (normType(t.type) !== 'CUSTOMEVENT') return null;
  const ev = eventMatch(ix, t);
  if (!ev?.regex || !['.*', '^.*$', '.+'].includes(ev.regex)) return null;
  const f = (t.filter ?? []).map(c => readCondition(ix, c));
  const hostIs = (c: Cond, rule: 'prod' | 'prod+nuevo', negate: boolean) => c.left.kind === 'host' && c.op === 'MATCH_REGEX' && c.negate === negate && hostRule(c.right) === rule;
  const stateIs = (c: Cond, name: string, value: string, negate: boolean) =>
    isDlv(c.left, name) && c.op === 'EQUALS' && c.right === value && c.negate === negate && c.left.kind === 'dlv' && c.left.v2 && !c.left.hasDefault;
  const debugOff = (c: Cond) => c.left.kind === 'debug' && c.op === 'EQUALS' && c.right === 'false' && !c.negate;
  if (f.length === 1) {
    if (hostIs(f[0], 'prod', true)) return 'X01';
    if (hostIs(f[0], 'prod+nuevo', true)) return 'X01b';
    if (stateIs(f[0], 'elights_env', 'test', false)) return 'X02';
    if (stateIs(f[0], 'meta_consent', 'granted', true)) return 'X03';
  }
  if (f.length === 2) {
    const has = (pred: (c: Cond) => boolean) => f.some(pred);
    if (has(c => hostIs(c, 'prod', false)) && has(c => stateIs(c, 'elights_env', 'test', false))) return 'X02b';
    if (has(c => hostIs(c, 'prod', true)) && has(debugOff)) return 'X04';
  }
  return null;
}

// ── Etiquetas ────────────────────────────────────────────────────────────────

export type TagKind = 'G01' | 'G02' | 'ADS' | 'GA01' | 'GA_PAGE_VIEW' | 'GA_EVENTS' | 'META' | 'OTHER';

export function tagKind(ix: ExportIndex, tag: GtmTag): TagKind {
  const p = tag.parameter;
  switch (tag.type) {
    case 'googtag': {
      const id = valueOf(p, 'tagId');
      return id === ADS_TAG_ID ? 'G01' : id === GA4_ID ? 'GA01' : 'OTHER';
    }
    case 'gclidw':
      return 'G02';
    case 'awct':
      return 'ADS';
    case 'gaawe': {
      const name = valueOf(p, 'eventName');
      return name === 'page_view' ? 'GA_PAGE_VIEW' : name === '{{Event}}' || name === '{{_event}}' ? 'GA_EVENTS' : 'OTHER';
    }
    default: {
      const tpl = ix.template(tag);
      if (tpl && (/FacebookPixel/i.test(tpl.galleryReference?.repository ?? '') || /^(Meta|Facebook) Pixel$/i.test(tpl.name))) return 'META';
      return 'OTHER';
    }
  }
}

const CONSENT: Record<Exclude<TagKind, 'OTHER'>, readonly string[]> = {
  G01: ['ad_storage', 'ad_user_data'],
  ADS: ['ad_storage', 'ad_user_data'],
  G02: ['ad_storage'],
  GA01: ['analytics_storage'],
  GA_PAGE_VIEW: ['analytics_storage'],
  GA_EVENTS: ['analytics_storage'],
  META: [],
};

export interface CheckOptions {
  /**
   * Fase A2 (decisión 9 del dueño: Google Ads y Meta con X01b, X02b y X04). Por defecto, las dos,
   * como la v1.3; { ads: false, meta: false } es el juego de la v1.2 (--sin-fase-a2).
   */
  faseA2?: { ads: boolean; meta: boolean };
}

function expectedExceptions(kind: TagKind, opts: CheckOptions): ExceptionKind[] {
  const a2 = opts.faseA2 ?? { ads: true, meta: true };
  const base: ExceptionKind[] = ['X01', 'X02'];
  const a2Set: ExceptionKind[] = ['X01b', 'X02b', 'X04'];
  if (kind === 'META') return [...(a2.meta ? a2Set : base), 'X03'];
  if (kind === 'G01' || kind === 'G02' || kind === 'ADS') return a2.ads ? a2Set : base;
  return base;
}

function expectedRoles(ix: ExportIndex, tag: GtmTag, kind: TagKind): readonly TriggerRole[] | null {
  switch (kind) {
    case 'G01':
    case 'G02':
    case 'GA01':
      return ['init', 'consent_update'];
    case 'ADS': {
      const role = ADS_CONVERSIONS[valueOf(tag.parameter, 'conversionLabel') ?? ''];
      return role ? [role] : null;
    }
    case 'GA_PAGE_VIEW':
      return ['page_view'];
    case 'GA_EVENTS':
      return ['site_events'];
    case 'META':
      return META_EVENTS[metaEvent(tag) ?? ''] ?? null;
    default:
      return null;
  }
}

/** El evento estándar de una etiqueta de Meta, o undefined si no es uno estándar fijo. */
function metaEvent(tag: GtmTag): string | undefined {
  if (valueOf(tag.parameter, 'eventName') !== 'standard') return undefined;
  return valueOf(tag.parameter, 'standardEventName');
}

/**
 * Problemas de la tabla de consulta de content_name de un evento (vacío si está bien). Lead: la
 * tabla de form_type con exactamente sus 5 filas; Contact: la de link_type con sus 3. Cada fila,
 * el valor a sí mismo, y sin valor por defecto (sección 6.2).
 */
export function contentNameIssues(ix: ExportIndex, ref: string, event: 'Lead' | 'Contact'): string[] {
  const m = /^\{\{(.+)\}\}$/.exec(ref.trim());
  const v = m ? ix.variables.get(m[1]) : undefined;
  if (!v || v.type !== 'smm') return [`content_name debe venir de una tabla de consulta (es «${ref}»)`];
  const want = CONTENT_NAME_TABLES[event];
  const issues: string[] = [];
  const input = (valueOf(v.parameter, 'input') ?? '').trim();
  const o = /^\{\{[^}]+\}\}$/.test(input) ? ix.operand(input) : null;
  if (!o || !isDlv(o, want.input) || (o.kind === 'dlv' && o.hasDefault)) {
    issues.push(`la tabla «${v.name}» de ${event} debe leer solo ${want.input} de la capa de datos (es «${input}»)`);
  }
  const map = rows(v.parameter, 'map');
  const outputs = map.map(r => r.value);
  const extra = outputs.filter(o => !CONTENT_NAME_VALUES.includes(o));
  if (!outputs.length) issues.push(`la tabla «${v.name}» no tiene filas`);
  if (extra.length) issues.push(`la tabla «${v.name}» da valores fuera de la lista de 8: ${[...new Set(extra)].join(', ')}`);
  const exact = map.length === want.values.length && map.every(r => r.key === r.value) && sameSet(map.map(r => r.key), want.values);
  if (outputs.length && !exact) {
    issues.push(`la tabla «${v.name}» de ${event} debe tener exactamente ${want.values.length} filas, cada valor a sí mismo: ${want.values.join(', ')}`);
  }
  if (isTrue(v.parameter, 'setDefaultValue') && (valueOf(v.parameter, 'defaultValue') ?? '') !== '') {
    issues.push(`la tabla «${v.name}» tiene un valor por defecto («${valueOf(v.parameter, 'defaultValue')}»): debe quedar vacío`);
  }
  return issues;
}

/** Las secciones del código de una plantilla (___NOMBRE___ → contenido). */
function templateSections(data: string): Map<string, string> {
  const out = new Map<string, string>();
  const parts = data.split(/^___([A-Z_]+)___[ \t]*$/m);
  for (let i = 1; i + 1 < parts.length; i += 2) out.set(parts[i], parts[i + 1].trim());
  return out;
}

interface TemplatePermission {
  instance?: { key?: { publicId?: string }; param?: { key?: string; value?: { listItem?: { string?: string }[] } }[] };
}

/**
 * Permisos de la plantilla de Meta (sección 5.2): solo los de la v2.0.9, y «Inyecta scripts»
 * solo con fbevents.js. Sin el código de la plantilla en la exportación no se puede revisar.
 */
export function templatePermissionIssues(tpl: GtmTemplate | undefined): string[] {
  const data = tpl?.templateData;
  if (!data) return ['la exportación no trae el código de la plantilla de Meta (templateData): no se pueden revisar sus permisos'];
  let perms: TemplatePermission[];
  try {
    perms = JSON.parse(templateSections(data).get('WEB_PERMISSIONS') ?? '') as TemplatePermission[];
    if (!Array.isArray(perms)) throw new Error('no es una lista');
  } catch {
    return ['no se pudieron leer los permisos de la plantilla de Meta (___WEB_PERMISSIONS___)'];
  }
  const issues: string[] = [];
  const ids = perms.map(x => x.instance?.key?.publicId ?? '?');
  const extra = ids.filter(id => !META_TEMPLATE_PERMISSIONS.includes(id));
  if (extra.length) issues.push(`la plantilla de Meta tiene permisos que la v2.0.9 no trae: ${[...new Set(extra)].join(', ')}`);
  const inject = perms.find(x => x.instance?.key?.publicId === 'inject_script');
  const urls = (inject?.instance?.param?.find(x => x.key === 'urls')?.value?.listItem ?? []).map(x => x.string ?? '');
  const others = urls.filter(u => !META_ALLOWED_SCRIPTS.includes(u));
  if (others.length) {
    issues.push(
      `la plantilla de Meta puede inyectar otros scripts además de fbevents.js: ${others.join(', ')}. ` +
        'Editar su permiso «Inyecta scripts» en el contenedor y dejar solo https://connect.facebook.net/en_US/fbevents.js (sección 5.2)',
    );
  }
  return issues;
}

function metaIssues(ix: ExportIndex, tag: GtmTag): string[] {
  const p = tag.parameter;
  const issues: string[] = [];
  const tpl = ix.template(tag);
  if (tpl?.galleryReference?.owner !== 'facebook') issues.push('la plantilla no es la «Meta Pixel» de facebook de la galería');
  else if (tpl.galleryReference.version !== META_TEMPLATE_VERSION) {
    issues.push(`la plantilla de Meta no es la v2.0.9 (versión de la galería «${tpl.galleryReference.version ?? ''}», debe ser ${META_TEMPLATE_VERSION})`);
  }
  if (valueOf(p, 'pixelId') !== META_PIXEL_ID) issues.push(`el ID del píxel debe ser solo ${META_PIXEL_ID} (es «${valueOf(p, 'pixelId') ?? ''}»)`);
  const event = metaEvent(tag);
  if (!event || !META_EVENTS[event]) issues.push(`evento «${event ?? valueOf(p, 'eventName') ?? '?'}»: solo PageView, Contact o Lead (estándar, fijo)`);
  if (!isTrue(p, 'disableAutoConfig')) issues.push('«Disable Automatic Configuration» debe estar marcada (autoConfig apagado)');
  if (!isTrue(p, 'disablePushState')) issues.push('«Disable History Event Tracking» debe estar marcada');
  if (valueOf(p, 'optInMetaCAPI') !== 'false') issues.push('«Meta-enabled Conversions API integration» debe estar desmarcada (optInMetaCAPI en false; sin el campo, la plantilla la activa)');
  if (isTrue(p, 'advancedMatching') || rows(p, 'advancedMatchingList').length) issues.push('sin coincidencia avanzada (advancedMatching y advancedMatchingList vacíos)');
  if (isTrue(p, 'enhancedEcommerce') || isTrue(p, 'useGA4Ecommerce')) issues.push('sin comercio electrónico (enhancedEcommerce y useGA4Ecommerce apagados)');
  if (valueOf(p, 'consent') !== 'true') issues.push('«Consent Granted» debe ser True (el bloqueo lo hace X03)');
  const fromVar = valueOf(p, 'objectPropertiesFromVariable');
  if (fromVar && fromVar !== 'false') issues.push('sin propiedades desde una variable (objectPropertiesFromVariable)');
  if (isTrue(p, 'dpoLDU')) issues.push('sin opciones de tratamiento de datos (dpoLDU) no descritas en la política');
  const props = rows(p, 'objectPropertyList');
  if (event === 'PageView' && props.length) issues.push('PageView va sin parámetros');
  if (event === 'Contact' || event === 'Lead') {
    const names = props.map(r => r.name);
    if (names.some(n => n !== 'content_name') || names.length > 1) issues.push(`${event}: el único parámetro permitido es content_name (trae: ${names.join(', ')})`);
    const cn = props.find(r => r.name === 'content_name');
    if (cn) issues.push(...contentNameIssues(ix, cn.value, event));
  }
  return issues;
}

function settingsIssues(ix: ExportIndex, tag: GtmTag, kind: TagKind): string[] {
  const p = tag.parameter;
  const issues: string[] = [];
  if (kind === 'G01' || kind === 'GA01') {
    const cfg = settingsTable(tag, 'configSettingsTable');
    if (cfg.send_page_view !== 'false') issues.push('send_page_view debe ser false');
    if ('page_location' in cfg) issues.push('page_location no se fija en la etiqueta de Google (va en cada evento)');
    if (cfg.url_passthrough === 'true') issues.push('sin url_passthrough');
    if (kind === 'GA01') {
      if (cfg.cookie_expires !== GA_COOKIE_EXPIRES) issues.push(`cookie_expires debe ser ${GA_COOKIE_EXPIRES} (395 días)`);
      if (cfg.allow_google_signals !== 'false') issues.push('allow_google_signals debe ser false');
      if (cfg.allow_ad_personalization_signals !== 'false') issues.push('allow_ad_personalization_signals debe ser false');
      for (const k of ['cookie_domain', 'cookie_prefix']) if (k in cfg) issues.push(`sin ${k} (cookies por defecto)`);
    }
    if (kind === 'G01') {
      // La política dice «_gcl_…, hasta 90 días»: eso son los valores por defecto
      for (const k of ['cookie_expires', 'cookie_domain', 'cookie_prefix', 'cookie_update']) {
        if (k in cfg) issues.push(`sin ${k} (cookies de Google Ads por defecto: _gcl_…, 90 días)`);
      }
    }
  }
  if (kind === 'ADS') {
    if (valueOf(p, 'conversionId') !== ADS_CONVERSION_ID) issues.push(`ID de conversión ${valueOf(p, 'conversionId') ?? '?'} (debe ser ${ADS_CONVERSION_ID})`);
    const label = valueOf(p, 'conversionLabel') ?? '';
    if (!ADS_CONVERSIONS[label]) issues.push(`la etiqueta de conversión «${label}» no es una de las 5 de la tabla 4.1`);
    for (const k of ['conversionValue', 'orderId', 'currencyCode']) if ((valueOf(p, k) ?? '') !== '') issues.push(`${k} debe ir vacío`);
    for (const k of ['enableEnhancedConversion', 'enableProductReporting', 'enableShippingData']) if (isTrue(p, k)) issues.push(`${k} debe estar apagado`);
  }
  if (kind === 'G02') {
    for (const k of ['enableCrossDomain', 'enableCookieOverrides', 'enableUrlPassthrough']) if (isTrue(p, k)) issues.push(`${k} debe estar apagado`);
  }
  if (kind === 'GA_PAGE_VIEW' || kind === 'GA_EVENTS') {
    const id = valueOf(p, 'measurementIdOverride') ?? valueOf(p, 'measurementId');
    if (id !== GA4_ID) issues.push(`ID de medición «${id ?? ''}» (debe ser ${GA4_ID})`);
    const ev = settingsTable(tag, 'eventSettingsTable');
    const extra = Object.keys(ev).filter(k => !EVENT_PARAMS.includes(k));
    if (extra.length) issues.push(`parámetros que no son de la tabla 3.5: ${extra.join(', ')}`);
    const loc = ev.page_location;
    const o = loc === undefined ? null : ix.operand(loc);
    if (kind === 'GA_PAGE_VIEW' && !(o && isDlv(o, 'page_location'))) issues.push('page_location debe venir de la capa de datos (DLV - page_location)');
    if (isTrue(p, 'sendEcommerceData')) issues.push('sin datos de comercio electrónico');
    if (rows(p, 'userProperties').length) issues.push('sin propiedades de usuario');
  }
  return issues;
}

// ── Revisión ─────────────────────────────────────────────────────────────────

export interface TagReport {
  name: string;
  kind: TagKind;
  issues: string[];
}
export interface ExportVerdict {
  approved: boolean;
  tags: TagReport[];
  /** Problemas del contenedor completo (faltan o sobran etiquetas). */
  failures: string[];
  notes: string[];
}

export function reviewExport(exp: GtmExport, opts: CheckOptions = {}): ExportVerdict {
  const ix = new ExportIndex(exp);
  const failures: string[] = [];
  const notes: string[] = [];
  let usesDebugMode = false;
  if (!exp.containerVersion) failures.push('la exportación no trae containerVersion (¿es un JSON de «Exportar contenedor»?)');

  const tags: TagReport[] = ix.tags.map(tag => {
    const kind = tagKind(ix, tag);
    const issues: string[] = [];
    if (kind === 'OTHER') {
      issues.push(tag.type === 'html' ? 'HTML personalizado: no está permitido' : `etiqueta fuera de la tabla 6.4 (tipo ${tag.type})`);
      return { name: tag.name, kind, issues };
    }
    // Consentimiento adicional
    const consent = consentTypes(tag);
    if (consent.includes('ad_personalization')) issues.push('exige ad_personalization, que siempre está en denied: nunca se dispararía');
    if (!sameSet(consent, CONSENT[kind])) {
      issues.push(`consentimiento adicional ${consent.join(', ') || 'ninguno'} (debe ser ${CONSENT[kind].join(', ') || 'ninguno'})`);
    }
    // Excepciones
    const blocking = (tag.blockingTriggerId ?? []).map(id => ix.triggers.get(id));
    const kinds = blocking.map(t => (t ? exceptionKind(ix, t) : null));
    if (kinds.some(k => k === null)) {
      const unknown = blocking.filter((t, i) => kinds[i] === null).map(t => t?.name ?? '¿?');
      issues.push(`excepciones que no son de la sección 6.3: ${unknown.join(', ')}`);
    }
    const want = expectedExceptions(kind, opts);
    const have = kinds.filter((k): k is ExceptionKind => k !== null);
    if (!sameSet([...new Set(have)], want)) issues.push(`excepciones ${[...new Set(have)].join(', ') || 'ninguna'} (deben ser ${want.join(', ')})`);
    // Activadores
    const roles = (tag.firingTriggerId ?? []).map(id => {
      const t = ix.triggers.get(id);
      return t ? triggerRole(ix, t) : null;
    });
    const expected = expectedRoles(ix, tag, kind);
    if (roles.some(r => r === null)) issues.push('un activador de disparo no es de la tabla 6.3');
    if (expected && !sameSet(roles.filter((r): r is TriggerRole => r !== null), expected)) {
      issues.push(`activadores ${roles.filter(Boolean).join(', ') || 'ninguno'} (deben ser ${expected.join(', ')})`);
    }
    if ((kind === 'G01' || kind === 'G02' || kind === 'GA01') && tag.tagFiringOption !== 'ONCE_PER_LOAD') {
      issues.push('debe dispararse una vez por página (ONCE_PER_LOAD)');
    }
    issues.push(...settingsIssues(ix, tag, kind));
    if (kind === 'META') issues.push(...metaIssues(ix, tag), ...templatePermissionIssues(ix.template(tag)));
    if (have.includes('X04')) usesDebugMode = true;
    if (tag.paused) notes.push(`«${tag.name}» está en pausa`);
    return { name: tag.name, kind, issues };
  });

  // Faltan o sobran
  const count = (k: TagKind) => tags.filter(t => t.kind === k).length;
  for (const k of ['G01', 'G02', 'GA01', 'GA_PAGE_VIEW', 'GA_EVENTS'] as const) {
    if (count(k) !== 1) failures.push(`${count(k)} etiquetas de tipo ${k} (debe haber una)`);
  }
  const labels = ix.tags.filter(t => tagKind(ix, t) === 'ADS').map(t => valueOf(t.parameter, 'conversionLabel') ?? '');
  for (const label of Object.keys(ADS_CONVERSIONS)) {
    const n = labels.filter(l => l === label).length;
    if (n !== 1) failures.push(`${n} conversiones con la etiqueta ${label} (debe haber una)`);
  }
  const metaTags = ix.tags.filter(t => tagKind(ix, t) === 'META');
  for (const event of Object.keys(META_EVENTS)) {
    const n = metaTags.filter(t => metaEvent(t) === event).length;
    if (n > 1) failures.push(`${n} etiquetas de Meta con ${event} (como máximo una)`);
    if (n === 0) notes.push(`no hay etiqueta de Meta con ${event} (quitar un evento está permitido; agregar no)`);
  }
  if (usesDebugMode && ![...ix.builtIns.values()].includes('DEBUG_MODE')) {
    failures.push('la variable integrada Debug Mode no está habilitada (la usa X04, sección 6.2)');
  }
  const a2 = opts.faseA2 ?? { ads: true, meta: true };
  if (!a2.ads || !a2.meta) {
    notes.push('Revisión con las excepciones de la v1.2 (--sin-fase-a2): la v1.3 pide X01b, X02b y X04 en Google Ads y Meta (tabla 6.4).');
  }
  if (metaTags.some(t => ix.template(t)?.galleryReference?.isModified)) {
    notes.push(
      'La plantilla de Meta está modificada en el contenedor (se espera: su permiso «Inyecta scripts»). Comparar su código con el de la v2.0.9: ' +
        'solo debe cambiar ese permiso (sección 5.2).',
    );
  }
  const approved = failures.length === 0 && tags.every(t => t.issues.length === 0);
  return { approved, tags, failures, notes };
}

export function formatExportReport(v: ExportVerdict): string[] {
  const lines = [`[check-gtm-export] ${v.tags.length} etiquetas`];
  for (const t of v.tags) {
    lines.push(`  ${t.issues.length ? '✗' : '✓'} ${t.name} (${t.kind})`);
    for (const i of t.issues) lines.push(`::error title=Revisión estática::${t.name}: ${i}`);
  }
  for (const f of v.failures) lines.push(`::error title=Revisión estática::${f}`);
  for (const n of v.notes) lines.push(`  Nota: ${n}`);
  const problems = v.failures.length + v.tags.reduce((s, t) => s + t.issues.length, 0);
  lines.push(v.approved ? '[check-gtm-export] La exportación pasa la revisión estática.' : `[check-gtm-export] No pasa: ${problems} problema(s).`);
  return lines;
}

export interface ExportCliArgs {
  file: string;
  options: CheckOptions;
}

/** Lee los argumentos. Lanza con un mensaje en español si son incorrectos. */
export function parseExportArgs(argv: readonly string[]): ExportCliArgs {
  let file: string | undefined;
  const options: CheckOptions = {};
  for (const a of argv) {
    if (a === '--sin-fase-a2') options.faseA2 = { ads: false, meta: false };
    else if (a.startsWith('--')) throw new Error(`argumento desconocido: ${a}`);
    else if (!file) file = a;
    else throw new Error(`sobra un archivo: ${a}`);
  }
  if (!file) throw new Error('falta el archivo JSON de la exportación');
  return { file, options };
}

function main(argv: readonly string[]) {
  let args: ExportCliArgs;
  try {
    args = parseExportArgs(argv);
  } catch (err) {
    console.error(`[check-gtm-export] ${(err as Error).message}`);
    console.error('Uso: npm run check:gtm-export -- exportacion.json [--sin-fase-a2]');
    process.exit(2);
  }
  let exp: GtmExport;
  try {
    exp = JSON.parse(readFileSync(args.file, 'utf8')) as GtmExport;
  } catch (err) {
    console.error(`[check-gtm-export] No se pudo leer ${args.file}: ${(err as Error).message}`);
    process.exit(2);
  }
  const verdict = reviewExport(exp, args.options);
  for (const line of formatExportReport(verdict)) console.log(line);
  process.exit(verdict.approved ? 0 : 1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main(process.argv.slice(2));
