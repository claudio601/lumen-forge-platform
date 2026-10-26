// api/_lib/whatsapp/privacyNotice.test.ts
// Aviso de privacidad del asistente de WhatsApp (Etapa 2 · PR 13w): el texto (largo, enlace,
// contenido, codificación y TwiML), cuándo se muestra (una vez por número, al final de la
// respuesta), cuándo se da por mostrado (solo si la respuesta sale dentro del plazo de Twilio),
// qué pasa si el registro falla (se responde igual, con el aviso) y que la política vigente
// siga diciendo lo que el aviso resume.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as flow from './flowEngine';
import { buildTwiML } from './twilio';
import {
  MAX_TRACKED,
  NOTICE_SEPARATOR,
  PRIVACY_NOTICE,
  PRIVACY_POLICY_URL,
  appendPrivacyNotice,
  shouldShowPrivacyNotice,
  type NoticeStore,
} from './privacyNotice';
import { SITE_URL as API_SITE_URL } from '../site';
import { CONSENT_TEXT_LINKS, LEGAL_VERSION } from '../forms/consent';
import * as site from '../../../src/config/site';
import { contactEmail } from '../../../src/config/business';

type NoticeModule = typeof import('./privacyNotice');

const PHONE_A = '+56900000001';
const PHONE_B = '+56900000002';
const REPLY = 'Hola! Soy el asistente de prueba.';

/** Respuestas fijas del flujo (flowEngine.ts) que pueden ser la primera de un número. */
const FLOW_MESSAGES = [
  'MSG1', 'MSG2', 'MSG3', 'MSG3_B2B', 'MSG3_B2C', 'MSG4', 'MSG4_B2B', 'MSG4_INSTALL',
  'MSG_HUMAN', 'MSG_MEDIA', 'MSG_EXECUTIVE', 'MSG_NEED_EMAIL', 'MSG_NEED_EMAIL_AND_CONTEXT',
] as const;

/** Tope del mensaje con el aviso: margen amplio bajo el límite de 1.600 de Twilio. */
const MAX_COMBINED = 1000;

/**
 * Versión de los textos legales con la que se revisó el aviso. Al subirla, se vuelve a leer
 * el aviso contra la política nueva (sobre todo el §4) y se actualiza aquí.
 */
const NOTICE_REVIEWED_FOR_LEGAL_VERSION = '1.9';

/** Módulo nuevo, con el registro vacío. */
async function freshModule(): Promise<NoticeModule> {
  vi.resetModules();
  return import('./privacyNotice');
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.doUnmock('../site.js');
  vi.resetModules();
});

describe('texto del aviso', () => {
  it('cabe en 300 caracteres, hoy y con el dominio de la Etapa 3', async () => {
    expect(PRIVACY_NOTICE.length).toBeLessThanOrEqual(300);
    expect(PRIVACY_NOTICE.length).toBe(296);

    vi.resetModules();
    vi.doMock('../site.js', () => ({ SITE_URL: 'https://elights.cl' }));
    const etapa3 = await import('./privacyNotice');
    expect(etapa3.PRIVACY_POLICY_URL).toBe('https://elights.cl/politica-de-privacidad');
    expect(etapa3.PRIVACY_NOTICE).toContain('\nPolítica: https://elights.cl/politica-de-privacidad\n');
    expect(etapa3.PRIVACY_NOTICE.length).toBeLessThanOrEqual(300);
    expect(etapa3.PRIVACY_NOTICE.length).toBe(290);
  });

  it('con cada respuesta fija del flujo, el mensaje queda muy bajo el límite de Twilio', () => {
    for (const name of FLOW_MESSAGES) {
      const msg = (flow as Record<string, unknown>)[name];
      expect(typeof msg, name).toBe('string');
      const combined = appendPrivacyNotice(msg as string);
      expect(combined.length, name).toBeLessThanOrEqual(MAX_COMBINED);
    }
    // Una repregunta dinámica larga (hasta unos 350 caracteres) también cabe.
    expect(appendPrivacyNotice('x'.repeat(350)).length).toBeLessThanOrEqual(MAX_COMBINED);
  });

  it('enlaza la política vigente del sitio, sola en su línea y sin parámetros', () => {
    expect(PRIVACY_POLICY_URL).toBe(site.SITE_URL + CONSENT_TEXT_LINKS.privacidad.path);
    expect(PRIVACY_POLICY_URL).toBe(API_SITE_URL + '/politica-de-privacidad');
    const line = PRIVACY_NOTICE.match(/^Política: (https:\/\/\S+)$/m);
    expect(line).not.toBeNull();
    expect(line![1]).toBe(PRIVACY_POLICY_URL);
    expect(PRIVACY_POLICY_URL).not.toMatch(/[?#]|utm_|[.,;:!)]$/);
    // No enlaza una versión archivada: la persona debe ver la política vigente.
    expect(PRIVACY_NOTICE).not.toContain('/legal/');
    // Tres líneas: texto, política y derechos.
    expect(PRIVACY_NOTICE.split('\n')).toHaveLength(3);
  });

  it('nombra al responsable, el uso, el asistente con IA, el registro y el canal de derechos', () => {
    for (const s of [
      site.LEGAL_NAME,
      contactEmail,
      'responder tu consulta',
      'mejorar este asistente',
      'asistente automático con IA',
      'sistema de seguimiento',
      '«Datos personales»',
    ]) {
      expect(PRIVACY_NOTICE, s).toContain(s);
    }
    expect(PRIVACY_NOTICE.startsWith('Privacidad: ')).toBe(true);
  });

  it('no promete lo que el código no hace', () => {
    for (const re of [
      /en cualquier momento/i,
      /hablar con una persona/i,
      /responde tu consulta con IA/i,
      /\bsolo\b/i,
      /stock/i,
      /\d+\s*(h\b|horas?|d[ií]as?|minutos?)/i,
      /h[aá]biles|inmediat/i,
    ]) {
      expect(PRIVACY_NOTICE).not.toMatch(re);
    }
  });

  it('sin mojibake: caracteres reales y en forma NFC', () => {
    expect(PRIVACY_NOTICE).not.toMatch(/[\u00c3\u00c2\ufffd]/);
    expect(PRIVACY_NOTICE).toBe(PRIVACY_NOTICE.normalize('NFC'));
    expect(PRIVACY_NOTICE).toContain('automático');
    expect(PRIVACY_NOTICE).toContain('Política');
    expect(PRIVACY_NOTICE).toContain('«Datos personales»');
    const source = readFileSync(fileURLToPath(new URL('./privacyNotice.ts', import.meta.url)), 'utf8');
    expect(source).not.toMatch(/[\u00c3\u00c2\ufffd]/);
    // En el código, el texto va con escapes \u (como flowEngine.ts): el literal es solo ASCII.
    const start = source.indexOf('export const PRIVACY_NOTICE');
    const literal = source.slice(start, source.indexOf(';', start));
    expect(literal).toContain('autom\\u00e1tico');
    expect(literal).toMatch(/^[\x20-\x7e\n]*$/);
  });

  it('buildTwiML lo deja tal cual (no tiene &, < ni >)', () => {
    expect(PRIVACY_NOTICE).not.toMatch(/[&<>]/);
    const xml = buildTwiML(appendPrivacyNotice(REPLY));
    expect(xml).toContain(REPLY + NOTICE_SEPARATOR + PRIVACY_NOTICE + '</Message>');
  });
});

describe('withPrivacyNotice: una vez por número, al final de la respuesta', () => {
  let m: NoticeModule;
  /** Una respuesta que sale a tiempo: el webhook empezó recién. */
  const show = (phone: string, reply: string) => m.withPrivacyNotice(phone, reply, Date.now());

  beforeEach(async () => {
    m = await freshModule();
  });

  it('la primera respuesta a un número lleva el aviso después de una línea en blanco', () => {
    const out = show(PHONE_A, REPLY);
    expect(out).toBe(REPLY + '\n\n' + m.PRIVACY_NOTICE);
    expect(out.startsWith(REPLY)).toBe(true);
  });

  it('las siguientes respuestas al mismo número van sin cambios', () => {
    show(PHONE_A, REPLY);
    expect(show(PHONE_A, 'Segunda respuesta')).toBe('Segunda respuesta');
    expect(show(PHONE_A, REPLY)).toBe(REPLY);
  });

  it('cada número recibe el suyo', () => {
    show(PHONE_A, REPLY);
    expect(show(PHONE_B, REPLY)).toBe(REPLY + '\n\n' + m.PRIVACY_NOTICE);
    expect(show(PHONE_B, REPLY)).toBe(REPLY);
  });

  it('con una respuesta vacía devuelve solo el aviso', () => {
    expect(show(PHONE_A, '')).toBe(m.PRIVACY_NOTICE);
  });

  it('al llegar al tope vacía el registro y vuelve a mostrarlo (lado seguro)', () => {
    expect(m.MAX_TRACKED).toBe(5000);
    const phone = (i: number) => '+569' + String(i).padStart(8, '0');
    for (let i = 1; i <= m.MAX_TRACKED; i++) {
      expect(show(phone(i), REPLY)).not.toBe(REPLY);
    }
    // Lleno: un número ya registrado sigue sin repetirlo.
    expect(show(phone(1), REPLY)).toBe(REPLY);
    // Uno nuevo vacía el registro y recibe el aviso; los anteriores vuelven a recibirlo.
    expect(show(phone(m.MAX_TRACKED + 1), REPLY)).toBe(REPLY + '\n\n' + m.PRIVACY_NOTICE);
    expect(show(phone(m.MAX_TRACKED + 1), REPLY)).toBe(REPLY);
    expect(show(phone(1), REPLY)).toBe(REPLY + '\n\n' + m.PRIVACY_NOTICE);
  });

  it('un número vacío recibe siempre el aviso y no se registra', () => {
    expect(show('', REPLY)).toBe(REPLY + '\n\n' + m.PRIVACY_NOTICE);
    expect(show('', REPLY)).toBe(REPLY + '\n\n' + m.PRIVACY_NOTICE);
  });

  it('si el registro falla, responde igual y con el aviso, sin anotar el teléfono en el log', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    show(PHONE_A, REPLY);
    // Aunque el número ya estaba, si el registro no responde se muestra el aviso.
    const has = vi.spyOn(Set.prototype, 'has').mockImplementationOnce(() => {
      throw new Error('registro caído');
    });
    // Llamada directa: si lanzara, la prueba falla.
    const out = show(PHONE_A, REPLY);
    has.mockRestore();
    expect(out).toBe(REPLY + '\n\n' + m.PRIVACY_NOTICE);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).not.toContain(PHONE_A);
  });
});

describe('withPrivacyNotice: solo se da por mostrado si la respuesta sale a tiempo', () => {
  let m: NoticeModule;
  const T0 = Date.UTC(2026, 9, 16, 12, 0, 0);
  const withNotice = REPLY + '\n\n' + PRIVACY_NOTICE;

  beforeEach(async () => {
    m = await freshModule();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
  });

  it('el plazo es de 10 s, bajo los 15 s que Twilio espera la respuesta', () => {
    expect(m.NOTICE_DEADLINE_MS).toBe(10_000);
  });

  it('hasta 10 s (inclusive): lleva el aviso y el número queda marcado', () => {
    vi.setSystemTime(T0 + m.NOTICE_DEADLINE_MS);
    expect(m.withPrivacyNotice(PHONE_A, REPLY, T0)).toBe(withNotice);
    expect(m.withPrivacyNotice(PHONE_A, REPLY, Date.now())).toBe(REPLY);
  });

  it('pasados 10 s: lleva el aviso, pero el número no se marca y la siguiente respuesta lo vuelve a llevar', () => {
    vi.setSystemTime(T0 + m.NOTICE_DEADLINE_MS + 1);
    expect(m.withPrivacyNotice(PHONE_A, REPLY, T0)).toBe(withNotice);
    // Twilio pudo haber cortado a los 15 s (caso del revisor: la primera termina a los 20 s).
    vi.setSystemTime(T0 + 20_000);
    expect(m.withPrivacyNotice(PHONE_A, REPLY, T0)).toBe(withNotice);
    // La siguiente, a tiempo, lo lleva y recién ahí lo marca.
    const t1 = Date.now();
    vi.setSystemTime(t1 + 3_000);
    expect(m.withPrivacyNotice(PHONE_A, REPLY, t1)).toBe(withNotice);
    expect(m.withPrivacyNotice(PHONE_A, REPLY, Date.now())).toBe(REPLY);
  });

  it('una respuesta lenta a un número que ya vio el aviso no lo repite', () => {
    expect(m.withPrivacyNotice(PHONE_A, REPLY, T0)).toBe(withNotice);
    vi.setSystemTime(T0 + 60_000);
    expect(m.withPrivacyNotice(PHONE_A, REPLY, T0)).toBe(REPLY);
  });

  it('si startedAt no es un número, se trata como tardía: aviso sin marcar', () => {
    expect(m.withPrivacyNotice(PHONE_A, REPLY, Number.NaN)).toBe(withNotice);
    expect(m.withPrivacyNotice(PHONE_A, REPLY, Date.now())).toBe(withNotice);
    expect(m.withPrivacyNotice(PHONE_A, REPLY, Date.now())).toBe(REPLY);
  });
});

describe('shouldShowPrivacyNotice con un registro cualquiera', () => {
  const failing = (method: 'has' | 'add' | 'clear'): NoticeStore => {
    const set = new Set<string>();
    return {
      has: (p: string) => {
        if (method === 'has') throw new Error('has');
        return set.has(p);
      },
      add: (p: string) => {
        if (method === 'add') throw new Error('add');
        return set.add(p);
      },
      clear: () => {
        if (method === 'clear') throw new Error('clear');
        set.clear();
      },
      get size() {
        return method === 'clear' ? 1 : set.size;
      },
    };
  };

  it('con un Set: true la primera vez, false después', () => {
    const store = new Set<string>();
    expect(shouldShowPrivacyNotice(store, PHONE_A)).toBe(true);
    expect(store.has(PHONE_A)).toBe(true);
    expect(shouldShowPrivacyNotice(store, PHONE_A)).toBe(false);
  });

  it('respeta un tope dado: al llenarse se vacía', () => {
    const store = new Set<string>();
    expect(shouldShowPrivacyNotice(store, 'a', 2)).toBe(true);
    expect(shouldShowPrivacyNotice(store, 'b', 2)).toBe(true);
    expect(shouldShowPrivacyNotice(store, 'c', 2)).toBe(true);
    expect([...store]).toEqual(['c']);
    expect(MAX_TRACKED).toBe(5000);
  });

  it('sin marcar (respuesta tardía): devuelve true, no anota el número ni vacía el registro lleno', () => {
    const store = new Set<string>(['a', 'b']);
    expect(shouldShowPrivacyNotice(store, 'c', 2, false)).toBe(true);
    expect([...store]).toEqual(['a', 'b']);
    // Un número ya registrado sigue sin aviso.
    expect(shouldShowPrivacyNotice(store, 'a', 2, false)).toBe(false);
  });

  it('si has, add o clear lanzan, devuelve true y no lanza', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const method of ['has', 'add', 'clear'] as const) {
      expect(() => shouldShowPrivacyNotice(failing(method), PHONE_A, 1), method).not.toThrow();
      expect(shouldShowPrivacyNotice(failing(method), PHONE_A, 1), method).toBe(true);
    }
  });
});

describe('la política vigente respalda lo que dice el aviso', () => {
  const policy = readFileSync(
    fileURLToPath(new URL('../../../src/pages/PrivacidadPage.tsx', import.meta.url)),
    'utf8',
  );

  it('conserva las frases que respaldan cada afirmación del aviso', () => {
    for (const s of [
      // Responsable (§1) y canal de derechos (§1, §8)
      'LEGAL_NAME',
      "const DATA_SUBJECT = 'Datos personales'",
      // Uso de los datos (§3)
      'Responder tu solicitud',
      // Asistente automático con IA (§4) y sus encargados (§5)
      'asistente automático',
      'inteligencia artificial',
      'Twilio',
      'Anthropic',
      // Registro en el sistema de seguimiento (§5 Pipedrive, §7)
      'Pipedrive',
      'sistema de seguimiento',
    ]) {
      expect(policy, s).toContain(s);
    }
  });

  it('el aviso se revisó con la versión vigente de los textos legales', () => {
    expect(
      LEGAL_VERSION,
      'Subió la versión de los textos legales: revisa PRIVACY_NOTICE contra la política nueva y actualiza NOTICE_REVIEWED_FOR_LEGAL_VERSION.',
    ).toBe(NOTICE_REVIEWED_FOR_LEGAL_VERSION);
  });
});
