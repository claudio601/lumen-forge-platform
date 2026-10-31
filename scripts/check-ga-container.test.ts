// Lector de la etiqueta de Google (scripts/check-ga-container.ts, puerta de la Etapa 3).
// Sin red: lee un fixture de texto con la forma del bloque `data` de gtag/js y decide si la
// puerta pasa. La descarga se prueba con un fetch falso (solo GET).

import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_ADS_ID,
  DEFAULT_GA_ID,
  EXPECTED_KEY_EVENTS,
  FORM_EXCLUSION_SELECTORS,
  MANUAL_CHECKS,
  adsGateVerdict,
  isAdsId,
  containerUrl,
  downloadContainer,
  excludesSiteForms,
  extractContainerTags,
  formatReport,
  gateVerdict,
  matchingClose,
  normalizeGtmValue,
  parseArgs,
  readContainerFlags,
  ruleEventNames,
  type ContainerTag,
} from './check-ga-container';

/** El contenedor como estaba el 2026-10-14 (sintético). */
const TODAY = readFileSync(new URL('./fixtures/ga-container/gtag-2026-10-14.txt', import.meta.url), 'utf8');
/** La etiqueta de Google Ads como estaba el 2026-10-16 (sintético). */
const ADS_TODAY = readFileSync(new URL('./fixtures/ga-container/gtag-aw-2026-10-16.txt', import.meta.url), 'utf8');

/** Regla de evento clave para un evento (como las del fixture). */
const keyEventRule = (name: string) =>
  `["map","matchingRules","{\\"type\\":5,\\"args\\":[{\\"stringValue\\":\\"${name}\\"},{\\"contextValue\\":{\\"namespaceType\\":1,\\"keyParts\\":[\\"eventName\\"]}}]}"]`;
const LAST_RULE = keyEventRule('close_convert_lead');

/** Reemplaza un trozo exacto; falla si no está (así el fixture y la prueba no se desalinean). */
function swap(text: string, from: string, to: string): string {
  expect(text).toContain(from);
  return text.split(from).join(to);
}

const EXCLUSION = FORM_EXCLUSION_SELECTORS.join(', ');

/** El contenedor después de los ajustes de la agencia (puntos 1 a 3 de la puerta). */
const APPROVED = [
  (t: string) => swap(t, '["map","exclusionSelector",""]', `["map","exclusionSelector","${EXCLUSION}"]`),
  (t: string) => swap(t, '"vtp_historyEvents":true', '"vtp_historyEvents":false'),
  (t: string) => swap(t, '"vtp_redactEmail":false', '"vtp_redactEmail":true'),
  // El día del cambio, generate_lead pasa a evento clave (especificación 5.1)
  (t: string) => swap(t, LAST_RULE, `${LAST_RULE},${keyEventRule('generate_lead')}`),
].reduce((t, f) => f(t), TODAY);

const flagsOf = (js: string) => readContainerFlags(extractContainerTags(js));

describe('check-ga-container: lectura del contenedor', () => {
  it('lee las etiquetas del bloque data sin confundirse con llaves dentro de textos ni con el código del cargador', () => {
    const tags = extractContainerTags(TODAY);
    expect(tags.map(t => t.function)).toEqual([
      '__ogt_1p_data_v2',
      '__ccd_ga_first',
      '__ogt_google_signals',
      '__ccd_conversion_marking',
      '__ccd_em_page_view',
      '__ccd_em_scroll',
      '__ccd_em_outbound_click',
      '__ccd_em_form',
      '__ccd_em_download',
      '__ccd_em_video',
      '__ccd_auto_redact',
      '__gct',
      '__ccd_ga_last',
    ]);
    // ["list", ["map", …]] queda como lista de objetos
    expect(tags[0].vtp_autoCollectExclusionSelectors).toEqual([{ exclusionSelector: '' }]);
  });

  it('reconoce las banderas del contenedor de hoy', () => {
    expect(flagsOf(TODAY)).toEqual({
      tagFunctions: expect.any(Array),
      userData: { present: true, auto: true, email: true, phone: true, address: true, exclusions: [] },
      historyPageViews: true,
      enhancedMeasurement: [
        '__ccd_em_page_view',
        '__ccd_em_scroll',
        '__ccd_em_outbound_click',
        '__ccd_em_form',
        '__ccd_em_download',
        '__ccd_em_video',
      ],
      redactEmail: false,
      googleSignals: 'LIMITED_EXTERNAL',
      keyEvents: ['close_convert_lead', 'purchase', 'qualify_lead', 'whatsapp_click'],
      // En la etiqueta de GA4 las __ccd_em_* son la medición mejorada (solo cuenta para Google Ads)
      autoEvents: ['__ccd_em_page_view', '__ccd_em_scroll', '__ccd_em_outbound_click', '__ccd_em_form', '__ccd_em_download', '__ccd_em_video'],
    });
  });

  it('si el bloque data no es JSON estricto, lee la lista de etiquetas igual (y etiqueta por etiqueta)', () => {
    // Una coma colgante fuera de "tags" rompe JSON.parse del bloque completo
    const loose = swap(TODAY, '"version":"1",', '"version":"1",,');
    expect(flagsOf(loose)).toEqual(flagsOf(TODAY));
    // Una etiqueta rota dentro de "tags": las demás se leen
    const broken = swap(TODAY, '{"function":"__ccd_ga_first","priority":11,', '{"function":"__ccd_ga_first","priority":11,,');
    const fns = extractContainerTags(broken).map(t => t.function);
    expect(fns).not.toContain('__ccd_ga_first');
    expect(fns).toContain('__ccd_auto_redact');
    expect(flagsOf(broken).keyEvents).toEqual(flagsOf(TODAY).keyEvents);
  });

  it('sin el bloque data, o si no cierra, lanza con un mensaje claro', () => {
    expect(() => extractContainerTags('(function(){ var x = 1; })();')).toThrow(/no se encontró el bloque/);
    expect(() => extractContainerTags('var data = {"resource": {"tags": [')).toThrow(/no cierra/);
    expect(() => extractContainerTags('var data = {"resource": {}};')).toThrow(/"tags"/);
  });

  it('matchingClose respeta las cadenas y los escapes', () => {
    const s = '{"a":"}{\\"","b":[1,{"c":"]"}]} resto';
    expect(matchingClose(s, 0)).toBe(s.indexOf(' resto') - 1);
    expect(matchingClose('{"a":[}', 0)).toBe(-1);
    expect(matchingClose('x', 0)).toBe(-1);
  });

  it('normalizeGtmValue convierte map y list, y deja macros y valores simples', () => {
    expect(normalizeGtmValue(['list', ['map', 'a', 1, 'b', ['list', 'x']], 'y'])).toEqual([{ a: 1, b: ['x'] }, 'y']);
    expect(normalizeGtmValue(['macro', 3])).toEqual(['macro', 3]);
    expect(normalizeGtmValue({ k: ['map', 'z', true] })).toEqual({ k: { z: true } });
  });

  it('ruleEventNames toma el evento comparado con eventName (JSON, objeto o texto que no es JSON)', () => {
    const rule = '{"type":5,"args":[{"stringValue":"generate_lead"},{"contextValue":{"namespaceType":1,"keyParts":["eventName"]}}]}';
    expect(ruleEventNames(rule)).toEqual(['generate_lead']);
    expect(ruleEventNames(JSON.parse(rule))).toEqual(['generate_lead']);
    expect(ruleEventNames('no-json "stringValue":"purchase"')).toEqual(['purchase']);
    // Una regla con otra condición: solo cuenta la del nombre del evento
    const nested = JSON.stringify({
      type: 1,
      args: [
        { type: 5, args: [{ stringValue: 'qualify_lead' }, { contextValue: { keyParts: ['eventName'] } }] },
        { type: 5, args: [{ stringValue: 'es-CL' }, { contextValue: { keyParts: ['language'] } }] },
      ],
    });
    expect(ruleEventNames(nested)).toEqual(['qualify_lead']);
  });
});

describe('check-ga-container: variantes del formato', () => {
  const tag = (fn: string, extra: Record<string, unknown> = {}): ContainerTag => ({ function: fn, ...extra });

  it('page_view por historial en la lista de medición mejorada de __gct (formato antiguo)', () => {
    const em = (history: boolean, enabled = true) =>
      normalizeGtmValue(['list', ['map', 'name', 'page_view', 'enabled', enabled, 'options', ['map', 'history_events', history]], ['map', 'name', 'scroll', 'enabled', true]]);
    expect(readContainerFlags([tag('__gct', { vtp_enhancedMeasurement: em(true) })]).historyPageViews).toBe(true);
    expect(readContainerFlags([tag('__gct', { vtp_enhancedMeasurement: em(false) })]).historyPageViews).toBe(false);
    // page_view desactivado: su opción de historial no cuenta
    expect(readContainerFlags([tag('__gct', { vtp_enhancedMeasurement: em(true, false) })]).historyPageViews).toBe(false);
    expect(readContainerFlags([tag('__gct', { vtp_enhancedMeasurement: em(false) })]).enhancedMeasurement).toEqual(['page_view', 'scroll']);
  });

  it('la opción de historial dentro de otra etiqueta (por ejemplo __ogt_auto_events) también se encuentra', () => {
    const flags = readContainerFlags([tag('__ogt_auto_events', { vtp_pageView: { historyEvents: true } })]);
    expect(flags.historyPageViews).toBe(true);
    expect(flags.enhancedMeasurement).toEqual(['__ogt_auto_events']);
  });

  it('sin la opción de historial en ninguna etiqueta queda en null (desconocida)', () => {
    expect(readContainerFlags([tag('__gct')]).historyPageViews).toBeNull();
  });

  it('sin etiqueta de datos de usuario no hay detección; con una bandera que no es booleana queda en null', () => {
    expect(readContainerFlags([tag('__gct')]).userData).toEqual({ present: false, auto: false, email: false, phone: false, address: false, exclusions: [] });
    const flags = readContainerFlags([tag('__ogt_1p_data_v2', { vtp_isAutoEnabled: ['macro', 4], vtp_autoEmailEnabled: true })]);
    expect(flags.userData.auto).toBeNull();
    expect(flags.userData.phone).toBeNull();
  });

  it('redacción: todas las etiquetas deben tenerla; sin etiqueta cuenta como apagada', () => {
    const r = (...v: unknown[]) => readContainerFlags(v.map(x => tag('__ccd_auto_redact', { vtp_redactEmail: x }))).redactEmail;
    expect(r(true, true)).toBe(true);
    expect(r(true, false)).toBe(false);
    expect(r(['macro', 1])).toBeNull();
    expect(readContainerFlags([tag('__gct')]).redactEmail).toBe(false);
  });
});

describe('check-ga-container: puerta', () => {
  it('el contenedor de hoy NO pasa: detección sin exclusión, page_view por historial, sin redacción y sin generate_lead como evento clave', () => {
    const v = gateVerdict(flagsOf(TODAY));
    expect(v.approved).toBe(false);
    expect(v.failures).toHaveLength(4);
    expect(v.failures[0]).toMatch(/^La detección automática de datos de usuario está activa \(correo: sí, teléfono: sí, dirección: sí\) sin excluir/);
    expect(v.failures[0]).toContain(`«${EXCLUSION}»`);
    expect(v.failures[1]).toMatch(/page_view por cambios en el historial/);
    expect(v.failures[2]).toMatch(/redacción de correo del flujo está apagada/);
    expect(v.failures[3]).toContain('sobran: ninguno; faltan: generate_lead');
    expect(v.notes.join(' ')).toContain('LIMITED_EXTERNAL');
  });

  it('con los ajustes de la agencia pasa', () => {
    const v = gateVerdict(flagsOf(APPROVED));
    expect(v).toEqual({ approved: true, failures: [], notes: [expect.stringContaining('allow_google_signals: false')] });
  });

  it('apagar la detección automática también sirve (sin exclusión)', () => {
    const off = swap(APPROVED, `["map","exclusionSelector","${EXCLUSION}"]`, '["map","exclusionSelector",""]').replace('"vtp_isAutoEnabled":true', '"vtp_isAutoEnabled":false');
    expect(gateVerdict(flagsOf(off)).approved).toBe(true);
    const allOff = swap(
      swap(swap(swap(APPROVED, `"${EXCLUSION}"`, '""'), '"vtp_autoEmailEnabled":true', '"vtp_autoEmailEnabled":false'), '"vtp_autoPhoneEnabled":true', '"vtp_autoPhoneEnabled":false'),
      '"vtp_autoAddressEnabled":true',
      '"vtp_autoAddressEnabled":false',
    );
    expect(gateVerdict(flagsOf(allOff)).approved).toBe(true);
  });

  it('una exclusión incompleta no pasa (hacen falta los tres selectores, en cualquier orden y con cualquier espacio)', () => {
    expect(excludesSiteForms(['[data-elights-form]'])).toBe(false);
    expect(excludesSiteForms(['[data-elights-form] input', '[data-elights-form] textarea'])).toBe(false);
    expect(excludesSiteForms(['[data-elights-form]', '[data-elights-form]   TEXTAREA', ' [data-elights-form] input'])).toBe(true);
    const partial = swap(APPROVED, `"${EXCLUSION}"`, '"[data-elights-form]"');
    const v = gateVerdict(flagsOf(partial));
    expect(v.approved).toBe(false);
    expect(v.failures[0]).toContain('(excluye hoy: [data-elights-form])');
  });

  it('una bandera que no se puede leer cierra la puerta ("revisar a mano"), nunca la aprueba', () => {
    const unknownAuto = swap(APPROVED, `"${EXCLUSION}"`, '""').replace('"vtp_isAutoEnabled":true', '"vtp_isAutoEnabled":["macro",9]');
    expect(gateVerdict(flagsOf(unknownAuto)).failures).toEqual([expect.stringMatching(/^No se pudo leer si la detección automática/)]);
    const noHistory = swap(APPROVED, '"vtp_historyEvents":false,', '');
    expect(gateVerdict(flagsOf(noHistory)).failures).toEqual([expect.stringMatching(/^No se encontró la opción de page_view por historial/)]);
    const unknownRedact = swap(APPROVED, '"vtp_redactEmail":true', '"vtp_redactEmail":["macro",9]');
    expect(gateVerdict(flagsOf(unknownRedact)).failures).toEqual([expect.stringMatching(/^No se pudo leer la redacción de correo/)]);
  });

  it('si cambian los eventos clave no pasa; con la lista nueva anotada (--key-events) sí', () => {
    const swapped = swap(
      APPROVED,
      '{\\"stringValue\\":\\"qualify_lead\\"}',
      '{\\"stringValue\\":\\"view_item\\"}',
    );
    expect(flagsOf(swapped).keyEvents).toEqual(['close_convert_lead', 'generate_lead', 'purchase', 'view_item', 'whatsapp_click']);
    const v = gateVerdict(flagsOf(swapped));
    expect(v.approved).toBe(false);
    expect(v.failures).toEqual([expect.stringContaining('sobran: view_item; faltan: qualify_lead')]);
    expect(gateVerdict(flagsOf(swapped), ['purchase', 'whatsapp_click', 'generate_lead', 'close_convert_lead', 'view_item']).approved).toBe(true);
  });

  it('los eventos clave esperados son los del contenedor del 2026-10-14 más generate_lead (se marca el día del cambio)', () => {
    expect([...EXPECTED_KEY_EVENTS].sort()).toEqual(['close_convert_lead', 'generate_lead', 'purchase', 'qualify_lead', 'whatsapp_click']);
    // Hasta el día del cambio, la lista anterior se puede pasar con --key-events
    expect(gateVerdict(flagsOf(swap(APPROVED, `,${keyEventRule('generate_lead')}`, ''))).failures).toEqual([
      expect.stringContaining('sobran: ninguno; faltan: generate_lead'),
    ]);
  });

  it('lo que se revisa a mano dice la retención de la política 1.5: 14 meses, eventos y usuarios', () => {
    const text = MANUAL_CHECKS.join('\n');
    expect(text).toContain('retención de datos en 14 meses, de eventos y de usuarios');
    expect(text).toContain('Restablecer los datos de usuario con cada actividad nueva');
    expect(text).not.toMatch(/(?<!1)2 meses/);
  });

  it('el informe muestra cada bandera, los errores con ::error y lo que falta revisar a mano', () => {
    const lines = formatReport('G-TEST000000', flagsOf(TODAY), gateVerdict(flagsOf(TODAY)));
    const text = lines.join('\n');
    expect(text).toContain('Detección automática de datos de usuario: sí (correo: sí, teléfono: sí, dirección: sí); excluye: nada');
    expect(text).toContain('Page_view por historial del navegador: sí');
    expect(text).toContain('Redacción de correo: no');
    expect(text).toContain('Eventos clave: close_convert_lead, purchase, qualify_lead, whatsapp_click');
    expect(lines.filter(l => l.startsWith('::error title=Puerta de la Etapa 3::'))).toHaveLength(4);
    expect(text).toContain('La puerta no pasa: 4 punto(s).');
    expect(text).toMatch(/Términos de tratamiento de datos/);
    expect(text).toMatch(/Prueba de red con el contenedor real sin enviar hits/);
    expect(formatReport('G-TEST000000', flagsOf(APPROVED), gateVerdict(flagsOf(APPROVED))).join('\n')).toContain('La etiqueta de Google pasa la puerta.');
  });
});

describe('check-ga-container: etiqueta de Google Ads (AW-…)', () => {
  /** La etiqueta de Ads con la exclusión de formularios y la detección automática de eventos apagada. */
  const ADS_APPROVED = [
    (t: string) => swap(t, '["map","exclusionSelector",""]', `["map","exclusionSelector","${EXCLUSION}"]`),
    (t: string) => t.replace(/"vtp_enable(OutboundClick|Scroll|Download|HistoryEvents|Form|Video|PageView)":true/g, '"vtp_enable$1":false'),
    (t: string) => swap(t, '  ,{"function":"__ccd_em_form","priority":5,"vtp_includeParams":false,"tag_id":6}\n', ''),
    (t: string) => swap(t, '  ,{"function":"__ccd_em_page_view","priority":4,"vtp_historyEvents":true,"vtp_deferPageView":true,"vtp_includeParams":true,"tag_id":7}\n', ''),
  ].reduce((t, f) => f(t), ADS_TODAY);

  /**
   * La etiqueta de Ads como quedó el 2026-10-31 al apagar los eventos en la interfaz: banderas en
   * false salvo «Vistas de página» (fija), y las __ccd_em_* siguen en el contenedor, bloqueadas.
   */
  const ADS_2026_10_31 = [
    (t: string) => swap(t, '["map","exclusionSelector",""]', `["map","exclusionSelector","${EXCLUSION}"]`),
    (t: string) => t.replace(/"vtp_enable(OutboundClick|Scroll|Download|HistoryEvents|Form|Video)":true/g, '"vtp_enable$1":false'),
  ].reduce((t, f) => f(t), ADS_TODAY);

  it('lee la detección automática de eventos: banderas de __ogt_auto_events y etiquetas __ccd_em_*', () => {
    const f = flagsOf(ADS_TODAY);
    expect(f.autoEvents).toEqual(['OutboundClick', 'Scroll', 'Download', 'HistoryEvents', 'Form', 'Video', '__ccd_em_form', '__ccd_em_page_view']);
    expect(f.userData).toMatchObject({ present: true, auto: true, email: true, phone: false, address: false, exclusions: [] });
    expect(flagsOf(ADS_APPROVED).autoEvents).toEqual([]);
  });

  it('la etiqueta de hoy NO pasa: datos de usuario sin exclusión y detección automática de eventos activa', () => {
    const v = adsGateVerdict(flagsOf(ADS_TODAY));
    expect(v.approved).toBe(false);
    expect(v.failures).toHaveLength(2);
    expect(v.failures[0]).toMatch(/^La detección automática de datos de usuario está activa \(correo: sí, teléfono: no, dirección: no\) sin excluir/);
    expect(v.failures[1]).toMatch(/^La detección automática de eventos sigue activa \(OutboundClick, .*__ccd_em_page_view\)/);
    // Se apaga antes de la fase A2 (adelanto D8, especificación v1.3 6.1-7), no en el paso 0
    expect(v.failures[1]).toContain('Apagarla en la etiqueta de Google de Ads antes de la fase A2 (adelanto D8, sección 6.1-7)');
    expect(v.failures[1]).not.toContain('paso 0');
  });

  it('con la exclusión (o la detección apagada) y sin eventos automáticos pasa; los eventos clave y la redacción de GA4 no aplican', () => {
    expect(adsGateVerdict(flagsOf(ADS_APPROVED))).toEqual({ approved: true, failures: [], notes: [] });
    const userDataOff = swap(ADS_APPROVED, `"${EXCLUSION}"`, '""').replace('"vtp_isAutoEnabled":true', '"vtp_isAutoEnabled":false');
    expect(adsGateVerdict(flagsOf(userDataOff)).approved).toBe(true);
    // Solo una etiqueta __ccd_em_* sin bloquear que quede ya cierra la puerta
    const withVideo = swap(ADS_APPROVED, '  ,{"function":"__ccd_ads_last"', '  ,{"function":"__ccd_em_video","tag_id":12}\n  ,{"function":"__ccd_ads_last"');
    expect(adsGateVerdict(flagsOf(withVideo)).failures).toEqual([expect.stringContaining('(__ccd_em_video)')]);
  });

  it('las __ccd_em_* bloqueadas por su bandera en false no cuentan; «Vistas de página» (fija en Ads) tampoco', () => {
    expect(flagsOf(ADS_2026_10_31).tagFunctions).toEqual(expect.arrayContaining(['__ccd_em_form', '__ccd_em_page_view']));
    expect(flagsOf(ADS_2026_10_31).autoEvents).toEqual([]);
    expect(adsGateVerdict(flagsOf(ADS_2026_10_31))).toEqual({ approved: true, failures: [], notes: [] });
    // Con la bandera encendida, su etiqueta vuelve a contar
    const formOn = swap(ADS_2026_10_31, '"vtp_enableForm":false', '"vtp_enableForm":true');
    expect(flagsOf(formOn).autoEvents).toEqual(['Form', '__ccd_em_form']);
    // Sin __ogt_auto_events no hay bloqueo: las __ccd_em_* cuentan como activas
    const noAutoEvents = ADS_2026_10_31.replace(/\{"function":"__ogt_auto_events"[^}]*\}/, '{"function":"__e"}');
    expect(flagsOf(noAutoEvents).autoEvents).toEqual(['__ccd_em_form', '__ccd_em_page_view']);
  });

  it('una bandera de eventos que no se puede leer cierra la puerta', () => {
    const unknown = swap(ADS_APPROVED, '"vtp_enableForm":false', '"vtp_enableForm":["macro",3]');
    expect(flagsOf(unknown).autoEvents).toBeNull();
    expect(adsGateVerdict(flagsOf(unknown)).failures).toEqual([expect.stringMatching(/^No se pudo leer la detección automática de eventos/)]);
  });

  it('argumentos e informe: AW-774649578, con lo que falta revisar a mano en Google Ads', () => {
    expect(DEFAULT_ADS_ID).toBe('AW-774649578');
    expect(isAdsId(DEFAULT_ADS_ID)).toBe(true);
    expect(isAdsId(DEFAULT_GA_ID)).toBe(false);
    expect(parseArgs(['AW-774649578'])).toEqual({ id: 'AW-774649578', keyEvents: EXPECTED_KEY_EVENTS });
    expect(containerUrl(DEFAULT_ADS_ID)).toBe('https://www.googletagmanager.com/gtag/js?id=AW-774649578');
    const text = formatReport('AW-000000000', flagsOf(ADS_TODAY), adsGateVerdict(flagsOf(ADS_TODAY))).join('\n');
    expect(text).toContain('Detección automática de eventos: OutboundClick');
    expect(text).toContain('La puerta no pasa: 2 punto(s).');
    expect(text).toMatch(/conversiones mejoradas para clientes potenciales apagadas/);
    expect(text).not.toMatch(/Eventos clave|Redacción de correo/);
    const ok = formatReport('AW-000000000', flagsOf(ADS_APPROVED), adsGateVerdict(flagsOf(ADS_APPROVED))).join('\n');
    expect(ok).toContain('Detección automática de eventos: apagada');
    expect(ok).toContain('La etiqueta de Google Ads pasa la puerta.');
  });
});

describe('check-ga-container: descarga y argumentos (sin red)', () => {
  it('descarga con un solo GET a gtag/js del ID, sin ejecutar nada', async () => {
    const calls: { url: string; init: { method: string } }[] = [];
    const fake = vi.fn(async (url: string, init: { method: 'GET' }) => {
      calls.push({ url, init });
      return { ok: true, status: 200, text: async () => TODAY };
    });
    await expect(downloadContainer('G-TEST000000', fake)).resolves.toBe(TODAY);
    expect(calls).toEqual([{ url: 'https://www.googletagmanager.com/gtag/js?id=G-TEST000000', init: expect.objectContaining({ method: 'GET' }) }]);
    const failing = vi.fn(async () => ({ ok: false, status: 404, text: async () => '' }));
    await expect(downloadContainer('G-TEST000000', failing)).rejects.toThrow('HTTP 404');
  });

  it('importar el módulo no descarga nada', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    await import('./check-ga-container');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('argumentos: ID por defecto, otro ID, --file y --key-events (con espacio o con =)', () => {
    expect(parseArgs([])).toEqual({ id: DEFAULT_GA_ID, keyEvents: EXPECTED_KEY_EVENTS });
    expect(DEFAULT_GA_ID).toBe('G-C06JF3ZNH5');
    expect(containerUrl(DEFAULT_GA_ID)).toBe('https://www.googletagmanager.com/gtag/js?id=G-C06JF3ZNH5');
    expect(parseArgs(['G-ABCD1234', '--file', 'copia.js', '--key-events=purchase, generate_lead'])).toEqual({
      id: 'G-ABCD1234',
      file: 'copia.js',
      keyEvents: ['purchase', 'generate_lead'],
    });
    expect(() => parseArgs(['--file'])).toThrow('falta el valor de --file');
    expect(() => parseArgs(['UA-123'])).toThrow('argumento desconocido: UA-123');
  });
});
