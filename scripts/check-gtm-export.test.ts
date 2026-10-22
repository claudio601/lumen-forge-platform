// Revisión estática de la exportación del contenedor del sitio (scripts/check-gtm-export.ts,
// especificación v1.3, 7.2 y 10.6). Sin red: una exportación sintética que cumple todo (el
// contenedor de la tabla 6.4, con la fase A2 de Google Ads y Meta y el permiso de la plantilla de
// Meta limitado a fbevents.js) y variantes que rompen una regla cada una.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CONTENT_NAME_TABLES,
  CONTENT_NAME_VALUES,
  EVENT_PARAMS,
  SITE_EVENTS,
  formatExportReport,
  hostRule,
  parseExportArgs,
  reviewExport,
  type GtmExport,
  type GtmParam,
  type GtmTag,
  type GtmTrigger,
} from './check-gtm-export';

const FIXTURE: GtmExport = JSON.parse(readFileSync(new URL('./fixtures/gtm-export/contenedor-sitio-v1.json', import.meta.url), 'utf8'));
const ANALYTICS = '../src/lib/analytics';

const clone = (): GtmExport => structuredClone(FIXTURE);
const cv = (e: GtmExport) => e.containerVersion!;
const tagNamed = (e: GtmExport, prefix: string): GtmTag => cv(e).tag!.find(t => t.name.startsWith(prefix))!;
const triggerNamed = (e: GtmExport, prefix: string): GtmTrigger => cv(e).trigger!.find(t => t.name.startsWith(prefix))!;
const param = (t: { parameter?: GtmParam[] }, key: string) => t.parameter!.find(p => p.key === key)!;
const setParam = (t: { parameter?: GtmParam[] }, key: string, value: string) => {
  const p = t.parameter!.find(x => x.key === key);
  if (p) p.value = value;
  else t.parameter!.push({ type: 'TEMPLATE', key, value });
};
const removeParam = (t: { parameter?: GtmParam[] }, key: string) => {
  t.parameter = t.parameter!.filter(p => p.key !== key);
};
const issuesOf = (e: GtmExport, prefix: string, opts = {}) => reviewExport(e, opts).tags.find(t => t.name.startsWith(prefix))!.issues;
const cond = (type: string, arg0: string, arg1: string, negate = false) => ({
  type,
  parameter: [
    { type: 'TEMPLATE', key: 'arg0', value: arg0 },
    { type: 'TEMPLATE', key: 'arg1', value: arg1 },
    ...(negate ? [{ type: 'BOOLEAN', key: 'negate', value: 'true' }] : []),
  ],
});

describe('check-gtm-export: el contenedor de la tabla 6.4 pasa', () => {
  it('la exportación sintética, que cumple todo, pasa: 13 etiquetas sin problemas', () => {
    const v = reviewExport(FIXTURE);
    expect(v.failures).toEqual([]);
    expect(v.tags.filter(t => t.issues.length)).toEqual([]);
    expect(v.tags.map(t => t.kind)).toEqual(['G01', 'G02', 'ADS', 'ADS', 'ADS', 'ADS', 'ADS', 'GA01', 'GA_PAGE_VIEW', 'GA_EVENTS', 'META', 'META', 'META']);
    expect(v.approved).toBe(true);
    // La plantilla de Meta viene modificada (su permiso de scripts): recuerda comparar el código
    expect(v.notes.join(' ')).toMatch(/Comparar su código con el de la v2\.0\.9: solo debe cambiar ese permiso/);
  });

  it('las listas del script son las del sitio: eventos de GA4 (T09) y parámetros (tabla 3.5)', async () => {
    const a = (await import(/* @vite-ignore */ ANALYTICS)) as { SITE_EVENTS: readonly string[]; EVENT_PARAMS: readonly string[] };
    expect([...SITE_EVENTS]).toEqual([...a.SITE_EVENTS]);
    expect([...EVENT_PARAMS]).toEqual([...a.EVENT_PARAMS]);
  });

  it('content_name: 8 valores, los 5 tipos de formulario y los 3 medios de contacto, ni uno más', () => {
    expect([...CONTENT_NAME_VALUES].sort()).toEqual(
      ['cotizacion', 'solicitud_pedido', 'cotizador', 'estudio_luminico', 'instalacion', 'whatsapp', 'email', 'phone'].sort(),
    );
    expect([...CONTENT_NAME_TABLES.Lead.values, ...CONTENT_NAME_TABLES.Contact.values].sort()).toEqual([...CONTENT_NAME_VALUES].sort());
  });

  it('el informe marca cada etiqueta y dice que pasa', () => {
    const text = formatExportReport(reviewExport(FIXTURE)).join('\n');
    expect(text).toContain('✓ G01 Etiqueta de Google – Ads (G01)');
    expect(text).toContain('✓ M03 Meta – Lead (META)');
    expect(text).toContain('La exportación pasa la revisión estática.');
    expect(text).not.toContain('::error');
  });
});

describe('check-gtm-export: etiquetas y consentimiento', () => {
  it('una etiqueta de HTML personalizado (o de otro tipo) no está permitida', () => {
    const e = clone();
    cv(e).tag!.push({ name: 'Hotjar', type: 'html', parameter: [{ type: 'TEMPLATE', key: 'html', value: '<script></script>' }], firingTriggerId: ['1'] });
    cv(e).tag!.push({ name: 'CMP', type: 'cvt_1_99', parameter: [], firingTriggerId: ['1'] });
    const v = reviewExport(e);
    expect(v.approved).toBe(false);
    expect(v.tags.find(t => t.name === 'Hotjar')!.issues).toEqual(['HTML personalizado: no está permitido']);
    expect(v.tags.find(t => t.name === 'CMP')!.issues).toEqual(['etiqueta fuera de la tabla 6.4 (tipo cvt_1_99)']);
  });

  it('consentimiento adicional exacto por etiqueta, y nunca ad_personalization', () => {
    const e = clone();
    tagNamed(e, 'G01').consentSettings!.consentType!.list = [{ type: 'TEMPLATE', value: 'ad_storage' }];
    tagNamed(e, 'A03').consentSettings!.consentType!.list!.push({ type: 'TEMPLATE', value: 'ad_personalization' });
    tagNamed(e, 'GA02').consentSettings = { consentStatus: 'NOT_SET' };
    tagNamed(e, 'M01').consentSettings = { consentStatus: 'NEEDED', consentType: { type: 'LIST', list: [{ type: 'TEMPLATE', value: 'ad_storage' }] } };
    expect(issuesOf(e, 'G01')).toEqual(['consentimiento adicional ad_storage (debe ser ad_storage, ad_user_data)']);
    expect(issuesOf(e, 'A03')).toEqual([
      'exige ad_personalization, que siempre está en denied: nunca se dispararía',
      'consentimiento adicional ad_storage, ad_user_data, ad_personalization (debe ser ad_storage, ad_user_data)',
    ]);
    expect(issuesOf(e, 'GA02')).toEqual(['consentimiento adicional ninguno (debe ser analytics_storage)']);
    expect(issuesOf(e, 'M01')).toEqual(['consentimiento adicional ad_storage (debe ser ninguno)']);
  });

  it('faltan o sobran etiquetas: una conversión menos, una etiqueta de Google repetida', () => {
    const e = clone();
    cv(e).tag = cv(e).tag!.filter(t => !t.name.startsWith('A05'));
    cv(e).tag!.push(structuredClone(tagNamed(e, 'GA01')));
    const v = reviewExport(e);
    expect(v.failures).toEqual(['2 etiquetas de tipo GA01 (debe haber una)', '0 conversiones con la etiqueta 7oTxCMX3gJcdEOrtsPEC (debe haber una)']);
  });

  it('quitar un evento de Meta está permitido (nota); repetirlo, no', () => {
    const e = clone();
    cv(e).tag = cv(e).tag!.filter(t => !t.name.startsWith('M03'));
    let v = reviewExport(e);
    expect(v.approved).toBe(true);
    expect(v.notes).toContain('no hay etiqueta de Meta con Lead (quitar un evento está permitido; agregar no)');
    cv(e).tag!.push(structuredClone(tagNamed(e, 'M02')));
    v = reviewExport(e);
    expect(v.failures).toEqual(['2 etiquetas de Meta con Contact (como máximo una)']);
  });
});

describe('check-gtm-export: excepciones (se leen por lo que hacen, no por el nombre)', () => {
  it('v1.3 (tabla 6.4): Google Ads y Meta con X01b, X02b y X04 (Meta además X03); GA4 con X01 y X02', () => {
    const e = clone();
    tagNamed(e, 'A01').blockingTriggerId = ['23'];
    tagNamed(e, 'G02').blockingTriggerId = ['20', '21'];
    tagNamed(e, 'M02').blockingTriggerId = ['23', '24', '25'];
    tagNamed(e, 'GA03').blockingTriggerId = ['20', '21', '22'];
    expect(issuesOf(e, 'A01')).toEqual(['excepciones X01b (deben ser X01b, X02b, X04)']);
    expect(issuesOf(e, 'G02')).toEqual(['excepciones X01, X02 (deben ser X01b, X02b, X04)']);
    expect(issuesOf(e, 'M02')).toEqual(['excepciones X01b, X02b, X04 (deben ser X01b, X02b, X04, X03)']);
    expect(issuesOf(e, 'GA03')).toEqual(['excepciones X01, X02, X03 (deben ser X01, X02)']);
  });

  it('una regla de host que deja pasar dominios parecidos no es X01 ni X01b', () => {
    for (const loose of ['elights\\.cl$', 'elights.cl', '^(www\\.)?elights\\.cl', '(www\\.)?elights\\.cl$']) {
      const e = clone();
      param(triggerNamed(e, 'X01 ').filter![0], 'arg1').value = loose;
      expect(issuesOf(e, 'GA01'), loose).toEqual([expect.stringMatching(/^excepciones que no son de la sección 6\.3: X01/), 'excepciones X02 (deben ser X01, X02)']);
    }
    for (const loose of ['elights\\.cl$', '^((www\\.)?elights\\.cl|nuevo\\.elights\\.cl)', '^.*elights\\.cl$']) {
      const e = clone();
      param(triggerNamed(e, 'X01b').filter![0], 'arg1').value = loose;
      expect(issuesOf(e, 'A01'), loose).toEqual([expect.stringMatching(/^excepciones que no son de la sección 6\.3: X01b/), 'excepciones X02b, X04 (deben ser X01b, X02b, X04)']);
    }
  });

  it('X03 tiene que ser «meta_consent distinto de granted» (no «igual a denied»: sin la clave tampoco bloquearía)', () => {
    const e = clone();
    triggerNamed(e, 'X03').filter = [cond('EQUALS', '{{DLV - meta_consent}}', 'denied')];
    expect(issuesOf(e, 'M01')).toEqual([expect.stringMatching(/^excepciones que no son de la sección 6\.3: X03/), 'excepciones X01b, X02b, X04 (deben ser X01b, X02b, X04, X03)']);
  });

  it('X04 necesita la variable integrada Debug Mode habilitada', () => {
    const e = clone();
    cv(e).builtInVariable = cv(e).builtInVariable!.filter(b => b.type !== 'DEBUG_MODE');
    const v = reviewExport(e);
    expect(v.approved).toBe(false);
    expect(v.failures).toEqual(['la variable integrada Debug Mode no está habilitada (la usa X04, sección 6.2)']);
    // X04 tiene que pedir Debug Mode en false, no en true
    const e2 = clone();
    param(triggerNamed(e2, 'X04').filter![1], 'arg1').value = 'true';
    expect(issuesOf(e2, 'M01')[0]).toMatch(/^excepciones que no son de la sección 6\.3: X04/);
  });

  it('una variable de estado con valor por defecto, o de la versión 1 de la capa de datos, no sirve para las excepciones', () => {
    const e = clone();
    const v = cv(e).variable!.find(x => x.name === 'DLV - elights_env')!;
    setParam(v, 'setDefaultValue', 'true');
    setParam(v, 'defaultValue', 'prod');
    expect(issuesOf(e, 'GA01')[0]).toMatch(/^excepciones que no son de la sección 6\.3: X02/);
    const e2 = clone();
    setParam(cv(e2).variable!.find(x => x.name === 'DLV - meta_consent')!, 'dataLayerVersion', '1');
    expect(issuesOf(e2, 'M03')[0]).toMatch(/^excepciones que no son de la sección 6\.3: X03/);
  });

  it('una excepción que no aplica a todos los eventos no es excepción', () => {
    const e = clone();
    triggerNamed(e, 'X02 ').customEventFilter = [cond('EQUALS', '{{_event}}', 'gtm.js')];
    expect(issuesOf(e, 'GA02')[0]).toMatch(/^excepciones que no son de la sección 6\.3: X02/);
    const e2 = clone();
    triggerNamed(e2, 'X02b').customEventFilter = [cond('EQUALS', '{{_event}}', 'gtm.js')];
    expect(issuesOf(e2, 'A04')[0]).toMatch(/^excepciones que no son de la sección 6\.3: X02b/);
  });

  it('por defecto rige la v1.3: el contenedor de la v1.2 (X01 y X02 en todas) no pasa; con --sin-fase-a2, sí', () => {
    const e = clone();
    for (const t of cv(e).tag!.filter(t => /^(G01|G02|A0)/.test(t.name))) t.blockingTriggerId = ['20', '21'];
    for (const t of cv(e).tag!.filter(t => t.name.startsWith('M0'))) t.blockingTriggerId = ['20', '21', '22'];
    const v = reviewExport(e);
    expect(v.approved).toBe(false);
    expect(v.tags.filter(t => t.issues.length).map(t => t.name.slice(0, 4).trim())).toEqual(['G01', 'G02', 'A01', 'A02', 'A03', 'A04', 'A05', 'M01', 'M02', 'M03']);
    expect(issuesOf(e, 'A01')).toEqual(['excepciones X01, X02 (deben ser X01b, X02b, X04)']);
    const v12 = { faseA2: { ads: false, meta: false } };
    const old = reviewExport(e, v12);
    expect(old.approved).toBe(true);
    expect(old.notes.join(' ')).toContain('la v1.3 pide X01b, X02b y X04 en Google Ads y Meta');
    // Y al revés: el de la v1.3 no pasa con --sin-fase-a2
    expect(issuesOf(clone(), 'M01', v12)).toEqual(['excepciones X01b, X02b, X04, X03 (deben ser X01, X02, X03)']);
  });

  it('hostRule: solo elights.cl y www, o también nuevo.elights.cl; nunca parecidos', () => {
    expect(hostRule('^(www\\.)?elights\\.cl$')).toBe('prod');
    expect(hostRule('^(elights\\.cl|www\\.elights\\.cl)$')).toBe('prod');
    expect(hostRule('^((www\\.)?elights\\.cl|nuevo\\.elights\\.cl)$')).toBe('prod+nuevo');
    expect(hostRule('^((www|nuevo)\\.)?elights\\.cl$')).toBe('prod+nuevo');
    expect(hostRule('elights\\.cl$')).toBeNull(); // xelights.cl
    expect(hostRule('^(www\\.)?elights\\.cl')).toBeNull(); // elights.cl.evil.com
    expect(hostRule('^.*\\.?elights\\.cl$')).toBeNull(); // tienda.elights.cl
    expect(hostRule('^(www\\.elights\\.cl$')).toBeNull(); // regex rota
  });
});

describe('check-gtm-export: activadores', () => {
  it('cada conversión con su activador: A04 con todos los leads no sirve', () => {
    const e = clone();
    tagNamed(e, 'A04').firingTriggerId = ['10'];
    expect(issuesOf(e, 'A04')).toEqual(['activadores lead_all (deben ser lead_orders)']);
  });

  it('T04 y T05 se leen por su regex: una que mezcla pedidos y servicios no es ninguna de las dos', () => {
    const e = clone();
    param(triggerNamed(e, 'T04').filter![0], 'arg1').value = '^(solicitud_pedido|cotizacion|cotizador|instalacion)$';
    expect(issuesOf(e, 'A04')).toEqual(['un activador de disparo no es de la tabla 6.3', 'activadores ninguno (deben ser lead_orders)']);
  });

  it('T07 (v1.3, decisión 13): solo ventas@ y sin el enlace de «Datos personales», en cualquier orden', () => {
    const notEmail = ['un activador de disparo no es de la tabla 6.3', 'activadores ninguno (deben ser email)'];
    const withFilters = (...filter: ReturnType<typeof cond>[]) => {
      const e = clone();
      triggerNamed(e, 'T07').filter = filter;
      return e;
    };
    const sales = cond('CONTAINS', '{{DLV - link_url}}', 'ventas@elights.cl');
    const notData = cond('CONTAINS', '{{DLV - link_url}}', 'subject=Datos', true);
    // En otro orden, igual sirve
    expect(issuesOf(withFilters(notData, sales), 'A02')).toEqual([]);
    expect(issuesOf(withFilters(notData, sales), 'M02')).toEqual([]);
    // Sin condiciones
    expect(issuesOf(withFilters(), 'A02')).toEqual(notEmail);
    // El T07 de la v1.2 (cualquier mailto salvo «Datos personales»): contaría contacto@ como conversión y como Contact
    expect(issuesOf(withFilters(notData), 'A02')).toEqual(notEmail);
    expect(issuesOf(withFilters(notData), 'M02')).toEqual(['un activador de disparo no es de la tabla 6.3', 'activadores whatsapp, phone (deben ser whatsapp, email, phone)']);
    // Solo ventas@, sin excluir «Datos personales»
    expect(issuesOf(withFilters(sales), 'A02')).toEqual(notEmail);
    // contacto@ (o cualquier @elights.cl) en vez de ventas@
    expect(issuesOf(withFilters(cond('CONTAINS', '{{DLV - link_url}}', 'contacto@elights.cl'), notData), 'A02')).toEqual(notEmail);
    expect(issuesOf(withFilters(cond('CONTAINS', '{{DLV - link_url}}', '@elights.cl'), notData), 'A02')).toEqual(notEmail);
    // ventas@ negado o una tercera condición
    expect(issuesOf(withFilters(cond('CONTAINS', '{{DLV - link_url}}', 'ventas@elights.cl', true), notData), 'A02')).toEqual(notEmail);
    expect(issuesOf(withFilters(sales, notData, cond('CONTAINS', '{{DLV - link_url}}', 'mailto:')), 'A02')).toEqual(notEmail);
  });

  it('las etiquetas de Google: Inicialización y elights_consent_update, una vez por página', () => {
    const e = clone();
    tagNamed(e, 'G02').firingTriggerId = ['1'];
    tagNamed(e, 'GA01').tagFiringOption = 'ONCE_PER_EVENT';
    expect(issuesOf(e, 'G02')).toEqual(['activadores init (deben ser init, consent_update)']);
    expect(issuesOf(e, 'GA01')).toEqual(['debe dispararse una vez por página (ONCE_PER_LOAD)']);
  });

  it('T09 debe aceptar justo los eventos del sitio: sin los elights_* ni gtm.*', () => {
    const e = clone();
    param(triggerNamed(e, 'T09').customEventFilter![0], 'arg1').value = '.*';
    expect(issuesOf(e, 'GA03')).toEqual(['un activador de disparo no es de la tabla 6.3', 'activadores ninguno (deben ser site_events)']);
  });

  it('Meta: PageView con T03 y T11, Contact con los 3 clics y Lead con T10', () => {
    const e = clone();
    tagNamed(e, 'M01').firingTriggerId = ['3'];
    tagNamed(e, 'M02').firingTriggerId = ['6', '8'];
    expect(issuesOf(e, 'M01')).toEqual(['activadores page_view (deben ser page_view, meta_granted)']);
    expect(issuesOf(e, 'M02')).toEqual(['activadores whatsapp, phone (deben ser whatsapp, email, phone)']);
  });
});

describe('check-gtm-export: ajustes de Google', () => {
  it('GA4: send_page_view false, Signals y personalización apagados, 395 días y sin page_location fijo', () => {
    const e = clone();
    const rows = param(tagNamed(e, 'GA01'), 'configSettingsTable').list!;
    rows.find(r => r.map![0].value === 'allow_google_signals')!.map![1].value = 'true';
    rows.push({ type: 'MAP', map: [{ type: 'TEMPLATE', key: 'parameter', value: 'page_location' }, { type: 'TEMPLATE', key: 'parameterValue', value: '{{Page URL}}' }] });
    expect(issuesOf(e, 'GA01')).toEqual(['page_location no se fija en la etiqueta de Google (va en cada evento)', 'allow_google_signals debe ser false']);
    const e2 = clone();
    param(tagNamed(e2, 'G01'), 'configSettingsTable').list = [];
    expect(issuesOf(e2, 'G01')).toEqual(['send_page_view debe ser false']);
  });

  it('la etiqueta de Google de Ads con sus cookies por defecto (la política dice «_gcl_…, hasta 90 días»)', () => {
    const e = clone();
    const rows = param(tagNamed(e, 'G01'), 'configSettingsTable').list!;
    for (const [k, v] of [['cookie_expires', '63072000'], ['cookie_domain', 'elights.cl'], ['cookie_prefix', 'x'], ['cookie_update', 'false']]) {
      rows.push({ type: 'MAP', map: [{ type: 'TEMPLATE', key: 'parameter', value: k }, { type: 'TEMPLATE', key: 'parameterValue', value: v }] });
    }
    expect(issuesOf(e, 'G01')).toEqual([
      'sin cookie_expires (cookies de Google Ads por defecto: _gcl_…, 90 días)',
      'sin cookie_domain (cookies de Google Ads por defecto: _gcl_…, 90 días)',
      'sin cookie_prefix (cookies de Google Ads por defecto: _gcl_…, 90 días)',
      'sin cookie_update (cookies de Google Ads por defecto: _gcl_…, 90 días)',
    ]);
  });

  it('conversiones: sin valor, sin ID de transacción, sin conversiones mejoradas, y solo las 5 etiquetas', () => {
    const e = clone();
    setParam(tagNamed(e, 'A01'), 'conversionValue', '200');
    setParam(tagNamed(e, 'A02'), 'enableEnhancedConversion', 'true');
    setParam(tagNamed(e, 'A03'), 'conversionLabel', '4muUCPCvi5UZEOrtsPEC'); // «Enviar cotización», no se porta
    expect(issuesOf(e, 'A01')).toEqual(['conversionValue debe ir vacío']);
    expect(issuesOf(e, 'A02')).toEqual(['enableEnhancedConversion debe estar apagado']);
    expect(issuesOf(e, 'A03')).toEqual(['la etiqueta de conversión «4muUCPCvi5UZEOrtsPEC» no es una de las 5 de la tabla 4.1']);
    expect(reviewExport(e).failures).toContain('0 conversiones con la etiqueta 7gCtCLOm-b4YEOrtsPEC (debe haber una)');
  });

  it('vinculador sin dominios cruzados ni cambios de cookies; eventos de GA4 a G-C06JF3ZNH5 y solo con parámetros de la tabla 3.5', () => {
    const e = clone();
    setParam(tagNamed(e, 'G02'), 'enableCrossDomain', 'true');
    setParam(tagNamed(e, 'GA03'), 'measurementIdOverride', 'G-OTRA');
    param(tagNamed(e, 'GA03'), 'eventSettingsTable').list!.push({
      type: 'MAP',
      map: [{ type: 'TEMPLATE', key: 'parameter', value: 'email' }, { type: 'TEMPLATE', key: 'parameterValue', value: '{{DLV - email}}' }],
    });
    expect(issuesOf(e, 'G02')).toEqual(['enableCrossDomain debe estar apagado']);
    expect(issuesOf(e, 'GA03')).toEqual(['ID de medición «G-OTRA» (debe ser G-C06JF3ZNH5)', 'parámetros que no son de la tabla 3.5: email']);
  });
});

describe('check-gtm-export: Meta (techo de la política 1.5)', () => {
  it('opciones obligatorias de la plantilla', () => {
    const e = clone();
    const m = tagNamed(e, 'M01');
    removeParam(m, 'optInMetaCAPI'); // sin el campo, la plantilla activa la API de conversiones
    setParam(m, 'disablePushState', 'false');
    setParam(m, 'disableAutoConfig', 'false');
    setParam(m, 'consent', 'false');
    setParam(m, 'enhancedEcommerce', 'true');
    setParam(m, 'pixelId', '590822921694460,123456');
    expect(issuesOf(e, 'M01')).toEqual([
      'el ID del píxel debe ser solo 590822921694460 (es «590822921694460,123456»)',
      '«Disable Automatic Configuration» debe estar marcada (autoConfig apagado)',
      '«Disable History Event Tracking» debe estar marcada',
      '«Meta-enabled Conversions API integration» debe estar desmarcada (optInMetaCAPI en false; sin el campo, la plantilla la activa)',
      'sin comercio electrónico (enhancedEcommerce y useGA4Ecommerce apagados)',
      '«Consent Granted» debe ser True (el bloqueo lo hace X03)',
    ]);
  });

  it('sin coincidencia avanzada, ni con la casilla ni con la tabla', () => {
    const e = clone();
    tagNamed(e, 'M03').parameter!.push({
      type: 'LIST',
      key: 'advancedMatchingList',
      list: [{ type: 'MAP', map: [{ type: 'TEMPLATE', key: 'name', value: 'em' }, { type: 'TEMPLATE', key: 'value', value: '{{DLV - email}}' }] }],
    });
    expect(issuesOf(e, 'M03')).toEqual(['sin coincidencia avanzada (advancedMatching y advancedMatchingList vacíos)']);
  });

  it('solo PageView, Contact y Lead (estándar); otro evento no está en la política', () => {
    const e = clone();
    setParam(tagNamed(e, 'M03'), 'standardEventName', 'Purchase');
    expect(issuesOf(e, 'M03')).toEqual(['evento «Purchase»: solo PageView, Contact o Lead (estándar, fijo)']);
    const e2 = clone();
    setParam(tagNamed(e2, 'M02'), 'eventName', 'custom');
    expect(issuesOf(e2, 'M02')[0]).toBe('evento «custom»: solo PageView, Contact o Lead (estándar, fijo)');
  });

  it('PageView sin parámetros; Contact y Lead solo con content_name', () => {
    const e = clone();
    const pageView = tagNamed(e, 'M01');
    pageView.parameter!.push(structuredClone(param(tagNamed(e, 'M03'), 'objectPropertyList')));
    param(tagNamed(e, 'M02'), 'objectPropertyList').list!.push({
      type: 'MAP',
      map: [{ type: 'TEMPLATE', key: 'name', value: 'value' }, { type: 'TEMPLATE', key: 'value', value: '200' }],
    });
    expect(issuesOf(e, 'M01')).toEqual(['PageView va sin parámetros']);
    expect(issuesOf(e, 'M02')).toEqual(['Contact: el único parámetro permitido es content_name (trae: content_name, value)']);
  });

  it('content_name: una tabla de consulta de form_type o link_type, con valores de la lista de 8 y sin valor por defecto', () => {
    const LEAD_ROWS = 'la tabla «LT - content_name (Lead)» de Lead debe tener exactamente 5 filas, cada valor a sí mismo: cotizacion, solicitud_pedido, cotizador, estudio_luminico, instalacion';
    const e = clone();
    const lead = cv(e).variable!.find(v => v.name === 'LT - content_name (Lead)')!;
    param(lead, 'map').list!.push({ type: 'MAP', map: [{ type: 'TEMPLATE', key: 'key', value: 'x' }, { type: 'TEMPLATE', key: 'value', value: 'Cliente Pérez' }] });
    setParam(lead, 'setDefaultValue', 'true');
    setParam(lead, 'defaultValue', 'otro');
    expect(issuesOf(e, 'M03')).toEqual([
      'la tabla «LT - content_name (Lead)» da valores fuera de la lista de 8: Cliente Pérez',
      LEAD_ROWS,
      'la tabla «LT - content_name (Lead)» tiene un valor por defecto («otro»): debe quedar vacío',
    ]);
    const e2 = clone();
    setParam(cv(e2).variable!.find(v => v.name === 'LT - content_name (Contact)')!, 'input', '{{DLV - link_url}}');
    expect(issuesOf(e2, 'M02')).toEqual(['la tabla «LT - content_name (Contact)» de Contact debe leer solo link_type de la capa de datos (es «{{DLV - link_url}}»)']);
    const e3 = clone();
    param(tagNamed(e3, 'M03'), 'objectPropertyList').list![0].map![1].value = '{{DLV - form_type}}';
    expect(issuesOf(e3, 'M03')).toEqual(['content_name debe venir de una tabla de consulta (es «{{DLV - form_type}}»)']);
  });

  it('content_name por evento (6.2): Lead con la tabla de form_type y sus 5 filas; Contact con la de link_type y sus 3', () => {
    const LEAD_ROWS = 'la tabla «LT - content_name (Lead)» de Lead debe tener exactamente 5 filas, cada valor a sí mismo: cotizacion, solicitud_pedido, cotizador, estudio_luminico, instalacion';
    const leadTable = (e: GtmExport) => cv(e).variable!.find(v => v.name === 'LT - content_name (Lead)')!;
    // Lead con la tabla de Contact (sus salidas son de la lista de 8, pero no del tipo de formulario)
    const e = clone();
    param(tagNamed(e, 'M03'), 'objectPropertyList').list![0].map![1].value = '{{LT - content_name (Contact)}}';
    expect(issuesOf(e, 'M03')).toEqual([
      'la tabla «LT - content_name (Contact)» de Lead debe leer solo form_type de la capa de datos (es «{{DLV - link_type}}»)',
      'la tabla «LT - content_name (Contact)» de Lead debe tener exactamente 5 filas, cada valor a sí mismo: cotizacion, solicitud_pedido, cotizador, estudio_luminico, instalacion',
    ]);
    // Sin «instalacion»
    const e2 = clone();
    param(leadTable(e2), 'map').list = param(leadTable(e2), 'map').list!.filter(r => r.map![0].value !== 'instalacion');
    expect(issuesOf(e2, 'M03')).toEqual([LEAD_ROWS]);
    // cotizacion traducido a whatsapp (de la lista, pero no a sí mismo)
    const e3 = clone();
    param(leadTable(e3), 'map').list!.find(r => r.map![0].value === 'cotizacion')!.map![1].value = 'whatsapp';
    expect(issuesOf(e3, 'M03')).toEqual([LEAD_ROWS]);
    // Una tabla de expresiones regulares no sirve: una clave podría aceptar cualquier cosa
    const e4 = clone();
    leadTable(e4).type = 'remm';
    expect(issuesOf(e4, 'M03')).toEqual(['content_name debe venir de una tabla de consulta (es «{{LT - content_name (Lead)}}»)']);
    // Una fila de más en Contact
    const e5 = clone();
    const contact = cv(e5).variable!.find(v => v.name === 'LT - content_name (Contact)')!;
    param(contact, 'map').list!.push({ type: 'MAP', map: [{ type: 'TEMPLATE', key: 'key', value: 'cotizacion' }, { type: 'TEMPLATE', key: 'value', value: 'cotizacion' }] });
    expect(issuesOf(e5, 'M02')).toEqual(['la tabla «LT - content_name (Contact)» de Contact debe tener exactamente 3 filas, cada valor a sí mismo: whatsapp, email, phone']);
  });

  it('la plantilla tiene que ser la «Meta Pixel» v2.0.9 de facebook de la galería', () => {
    const e = clone();
    cv(e).customTemplate![0].galleryReference!.owner = 'otro';
    expect(issuesOf(e, 'M01')).toContain('la plantilla no es la «Meta Pixel» de facebook de la galería');
    const e2 = clone();
    cv(e2).customTemplate![0].galleryReference!.version = 'd7103272dc194a9c1bdbeb1c484a1fac4a87fed5'; // v2.0.8
    expect(issuesOf(e2, 'M02')).toEqual([
      'la plantilla de Meta no es la v2.0.9 (versión de la galería «d7103272dc194a9c1bdbeb1c484a1fac4a87fed5», debe ser 08b9bbba509d6f10f6ad2bd39207ed814e96cbbe)',
    ]);
  });

  it('permisos de la plantilla: «Inyecta scripts» solo con fbevents.js (sin clientParamBuilder) y ninguno más que los de la v2.0.9', () => {
    const tpl = (e: GtmExport) => cv(e).customTemplate![0];
    const withPermissions = (e: GtmExport, edit: (perms: Record<string, unknown>[]) => void) => {
      const data = tpl(e).templateData!;
      const [head, rest] = data.split('___WEB_PERMISSIONS___');
      const [json, tail] = rest.split('___TESTS___');
      const perms = JSON.parse(json) as Record<string, unknown>[];
      edit(perms);
      tpl(e).templateData = `${head}___WEB_PERMISSIONS___\n\n${JSON.stringify(perms, null, 2)}\n\n\n___TESTS___${tail}`;
    };
    const injectUrls = (perms: Record<string, unknown>[]) =>
      ((perms.find(p => JSON.stringify(p).includes('"inject_script"')) as { instance: { param: { value: { listItem: { type: number; string: string }[] } }[] } }).instance.param[0].value.listItem);
    // La v2.0.9 tal como viene de la galería
    const e = clone();
    withPermissions(e, perms => {
      injectUrls(perms).push(
        { type: 1, string: 'https://cdn.jsdelivr.net/npm/meta-capi-param-builder-clientjs/dist/clientParamBuilder.bundle.js' },
        { type: 1, string: 'https://unpkg.com/meta-capi-param-builder-clientjs/dist/clientParamBuilder.bundle.js' },
      );
    });
    expect(issuesOf(e, 'M01')).toEqual([
      'la plantilla de Meta puede inyectar otros scripts además de fbevents.js: https://cdn.jsdelivr.net/npm/meta-capi-param-builder-clientjs/dist/clientParamBuilder.bundle.js, ' +
        'https://unpkg.com/meta-capi-param-builder-clientjs/dist/clientParamBuilder.bundle.js. Editar su permiso «Inyecta scripts» en el contenedor y dejar solo ' +
        'https://connect.facebook.net/en_US/fbevents.js (sección 5.2)',
    ]);
    expect(reviewExport(e).approved).toBe(false);
    // Un permiso que la v2.0.9 no trae (por ejemplo, enviar píxeles a otro dominio)
    const e2 = clone();
    withPermissions(e2, perms => perms.push({ instance: { key: { publicId: 'send_pixel', versionId: '1' }, param: [] }, isRequired: true }));
    expect(issuesOf(e2, 'M03')).toEqual(['la plantilla de Meta tiene permisos que la v2.0.9 no trae: send_pixel']);
    // Sin el código de la plantilla no se puede revisar
    const e3 = clone();
    delete tpl(e3).templateData;
    expect(issuesOf(e3, 'M02')).toEqual(['la exportación no trae el código de la plantilla de Meta (templateData): no se pueden revisar sus permisos']);
    const e4 = clone();
    tpl(e4).templateData = tpl(e4).templateData!.replace('___WEB_PERMISSIONS___', '___OTRA_COSA___');
    expect(issuesOf(e4, 'M02')).toEqual(['no se pudieron leer los permisos de la plantilla de Meta (___WEB_PERMISSIONS___)']);
  });
});

describe('check-gtm-export: argumentos', () => {
  it('archivo y --sin-fase-a2 (por defecto, la v1.3)', () => {
    expect(parseExportArgs(['x.json'])).toEqual({ file: 'x.json', options: {} });
    expect(parseExportArgs(['--sin-fase-a2', 'x.json'])).toEqual({ file: 'x.json', options: { faseA2: { ads: false, meta: false } } });
    expect(() => parseExportArgs(['x.json', '--fase-a2'])).toThrow('argumento desconocido: --fase-a2');
    expect(() => parseExportArgs([])).toThrow('falta el archivo JSON de la exportación');
    expect(() => parseExportArgs(['x.json', '--otra'])).toThrow('argumento desconocido: --otra');
    expect(() => parseExportArgs(['a.json', 'b.json'])).toThrow('sobra un archivo: b.json');
  });

  it('el informe de una exportación que no pasa cuenta los problemas y los marca con ::error', () => {
    const e = clone();
    setParam(tagNamed(e, 'A01'), 'orderId', '{{DLV - reference}}');
    const lines = formatExportReport(reviewExport(e));
    expect(lines).toContain('  ✗ A01 Conversión – Clic WhatsApp (ADS)');
    expect(lines).toContain('::error title=Revisión estática::A01 Conversión – Clic WhatsApp: orderId debe ir vacío');
    expect(lines.at(-1)).toBe('[check-gtm-export] No pasa: 1 problema(s).');
  });
});
