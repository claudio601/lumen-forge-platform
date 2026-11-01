// api/_lib/whatsapp/pipedriveLead.test.ts
// Bot de WhatsApp, PR 1: lo que ensureWhatsAppDeal escribe en Pipedrive.
// - Instalación: el correo y el nombre (install_*) llegan a la persona, a la nota y a los campos.
// - La nota y los campos nunca escriben un objeto, aunque llegue uno.
// - Un dato raro no deja una persona sin negocio: la nota y los campos se arman antes.
// - Si Pipedrive rechaza los campos del negocio, la nota se escribe igual.
// - PR 2: los cambios de un dato ya capturado y las varias cantidades de un mensaje van a la nota.
// - PR 3 (revisión de Codex, hallazgos 12 y 18): la nota cabe en Pipedrive y ningún dato imita otra línea.
// - Decisión 10 del dueño: cada nota lleva una referencia fija en su última línea; si Pipedrive la guardó y
//   se perdió la respuesta, el reintento la encuentra por esa referencia y no la repite. Segunda revisión: el
//   plazo de 30 s se cuenta desde el corte del último envío incierto; una página llena en otro orden no basta para decir
//   que no está; un rechazo definitivo de la búsqueda (4xx) manda la nota como antes, en vez de perderla.
// Pipedrive está simulado (sin red); solo datos inventados.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../pipedrive/persons.js', () => ({ findOrCreatePerson: vi.fn() }));
vi.mock('../pipedrive/deals.js', () => ({ createDeal: vi.fn(), updateDeal: vi.fn() }));
vi.mock('../pipedrive/fieldOptions.js', () => ({ initFieldOptions: vi.fn(async () => {}) }));
vi.mock('../pipedrive/client.js', () => ({ pipedrivePost: vi.fn(), pipedriveGet: vi.fn() }));

import {
  buildNote, buildWhatsAppUpdate, ensureWhatsAppDeal, escapeNoteHtml, notePart, noteSearchAt, retryWhatsAppWrite, NOTE_MAX_BYTES,
  NOTE_REF_LABEL, NOTE_SEARCH_LIMIT, NOTE_SEARCH_MAX_PAGES, NOTE_SEARCH_OVERLAP, NOTE_SEARCH_TIMEOUT_MS, NOTE_SETTLE_MS, WA_DEDUP_WINDOW_DAYS,
} from './pipedriveLead';
import type { PendingWhatsAppWrite, WhatsAppLeadParams } from './pipedriveLead';
import { findOrCreatePerson } from '../pipedrive/persons.js';
import { createDeal, updateDeal } from '../pipedrive/deals.js';
import { pipedriveGet, pipedrivePost } from '../pipedrive/client.js';
import { clearTranscript, recordTranscript, transcriptForNote } from './transcript';

const PHONE = '+56900000201';

function noteContent(): string {
  const call = vi.mocked(pipedrivePost).mock.calls.find(([path]) => path === '/notes');
  return String((call?.[1] as { content?: string } | undefined)?.content ?? '');
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('PIPEDRIVE_PIPELINE_ID', '1');
  vi.stubEnv('PIPEDRIVE_STAGE_NEW_LEAD_ID', '1');
  vi.stubEnv('PIPEDRIVE_DEAL_FIELD_WA_CONTACT_EMAIL', 'cf_wa_correo');
  vi.stubEnv('PIPEDRIVE_DEAL_FIELD_WA_CONTACT_NAME', 'cf_wa_nombre');
  vi.stubEnv('PIPEDRIVE_DEAL_FIELD_WA_PROJECT_USE', 'cf_wa_proyecto');
  vi.stubEnv('PIPEDRIVE_DEAL_FIELD_WA_QUANTITY', 'cf_wa_cantidad');
  vi.stubEnv('PIPEDRIVE_DEAL_FIELD_WA_BOT_SUMMARY', 'cf_wa_resumen');
  vi.mocked(findOrCreatePerson).mockResolvedValue({ personId: 7001, action: 'created' } as Awaited<ReturnType<typeof findOrCreatePerson>>);
  vi.mocked(createDeal).mockResolvedValue({ dealId: 9001, status: 'created' } as Awaited<ReturnType<typeof createDeal>>);
  vi.mocked(updateDeal).mockResolvedValue(undefined as Awaited<ReturnType<typeof updateDeal>>);
  vi.mocked(pipedrivePost).mockResolvedValue({ success: true, data: { id: 1 } } as Awaited<ReturnType<typeof pipedrivePost>>);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('instalación', () => {
  const params: WhatsAppLeadParams = {
    phone: PHONE,
    name: 'Perfil Prueba',
    summary: 'Pide instalación de luces en su casa.',
    body: 'Quiero instalar luces en mi casa',
    captured: { install_nombre: 'Ana Prueba', install_correo: 'ana.prueba@example.com', install_comuna: 'Maipú', install_tipo_proyecto: 'casa' },
    captureStatus: 'complete',
  };

  it('el correo y el nombre llegan a la persona', async () => {
    const result = await ensureWhatsAppDeal(params);
    expect(result).toEqual({ dealId: 9001, personId: 7001, action: 'created' });
    expect(vi.mocked(findOrCreatePerson).mock.calls[0][0]).toMatchObject({ name: 'Ana Prueba', email: 'ana.prueba@example.com', phone: PHONE });
  });

  it('la nota trae el correo, el nombre, la comuna y el proyecto, y dice que es de instalación', async () => {
    await ensureWhatsAppDeal(params);
    const note = noteContent();
    expect(note).toContain('Correo: ana.prueba@example.com');
    expect(note).toContain('Nombre/empresa: Ana Prueba');
    expect(note).toContain('Comuna/ciudad: Maipú');
    expect(note).toContain('Proyecto/uso: casa');
    expect(note).toContain('Solicitud de instalacion: Si');
  });

  it('los campos del negocio llevan el correo y el nombre', async () => {
    await ensureWhatsAppDeal(params);
    expect(vi.mocked(updateDeal).mock.calls[0][1]).toMatchObject({ cf_wa_correo: 'ana.prueba@example.com', cf_wa_nombre: 'Ana Prueba' });
  });

  it('un nombre de instalación que no es un nombre ("de Maipu") no llega a la persona ni a la nota', async () => {
    await ensureWhatsAppDeal({ ...params, captured: { ...params.captured, install_nombre: 'de Maipu' } });
    expect(vi.mocked(findOrCreatePerson).mock.calls[0][0]).toMatchObject({ name: 'Perfil Prueba', email: 'ana.prueba@example.com' });
    expect(noteContent()).toContain('Nombre/empresa: Perfil Prueba');
    expect(vi.mocked(updateDeal).mock.calls[0][1]).not.toHaveProperty('cf_wa_nombre');
  });

  it('un pedido de productos no dice "Solicitud de instalacion"', async () => {
    await ensureWhatsAppDeal({ ...params, captured: { producto: 'focos LED', correo: 'ana.prueba@example.com' } });
    expect(noteContent()).not.toContain('instalacion');
  });
});

describe('datos con otra forma', () => {
  // Llegan como objeto aunque el tipo diga texto (por ejemplo, desde una versión vieja del parseo).
  const odd = {
    phone: PHONE,
    name: 'Perfil Prueba',
    summary: { resumen: 'Pide paneles', prioridad: 'media' },
    body: 'Necesito 20 paneles y 10 focos',
    captured: { producto: 'paneles', cantidad: { paneles: 20, focos: 10 }, proyecto_o_uso: { tipo: 'bodega' }, correo: 'pedro.prueba@example.com' },
    captureStatus: 'partial',
  } as unknown as WhatsAppLeadParams;

  it('no lanza, crea el negocio y la nota nunca escribe "[object Object]"', async () => {
    await expect(ensureWhatsAppDeal(odd)).resolves.toMatchObject({ action: 'created', dealId: 9001 });
    expect(findOrCreatePerson).toHaveBeenCalledTimes(1);
    expect(createDeal).toHaveBeenCalledTimes(1);
    // Ventana de 7 dias (decision del dueno, 2026-10-26): solo cuenta un negocio abierto con movimiento.
    expect(vi.mocked(createDeal).mock.calls[0][0]).toMatchObject({ quoteReference: 'WA-' + PHONE.replace(/\D/g, ''), dedupOpenWithinDays: WA_DEDUP_WINDOW_DAYS });
    expect(WA_DEDUP_WINDOW_DAYS).toBe(7);
    const note = noteContent();
    expect(note).not.toContain('[object Object]');
    expect(note).toContain('Cantidad: -');
    expect(note).toContain('Proyecto/uso: -');
    expect(note).toContain('-- RESUMEN DEL BOT (interpretación, no dato) --\n-\n');
  });

  it('los campos del negocio solo llevan texto', async () => {
    await ensureWhatsAppDeal(odd);
    for (const value of Object.values(vi.mocked(updateDeal).mock.calls[0][1])) expect(typeof value).toBe('string');
    expect(vi.mocked(createDeal).mock.calls[0][0].notes).toBeUndefined();
  });
});

describe('PR 2: cambios y varias cantidades en la nota', () => {
  const base = { phone: PHONE, name: 'Perfil Prueba', summary: 'Pide paneles.', body: 'gracias', captureStatus: 'partial' } as const;

  it('un dato que el cliente cambió queda anotado, con el valor anterior', async () => {
    await ensureWhatsAppDeal({ ...base, captured: { producto: 'paneles LED', cantidad: '3', cambios: ['Cantidad: antes 2, ahora 3'], correo: 'pedro.prueba@example.com' } });
    const note = noteContent();
    expect(note).toContain('Cantidad: 3');
    expect(note).toContain('Cambios: Cantidad: antes 2, ahora 3');
  });

  it('con varias cantidades, la nota lleva el texto del cliente y el campo Cantidad queda vacío', async () => {
    await ensureWhatsAppDeal({ ...base, captured: { producto: 'paneles', cantidad_varios: 'Necesito 30 paneles de 18W y 20 de 24W', correo: 'pedro.prueba@example.com' } });
    expect(noteContent()).toContain('Cantidad: varios items, revisar: Necesito 30 paneles de 18W y 20 de 24W');
    expect(noteContent()).not.toContain('Cambios:');
    expect(vi.mocked(updateDeal).mock.calls[0][1]).not.toHaveProperty('cf_wa_cantidad');
  });
});

describe('fallas de Pipedrive', () => {
  const params: WhatsAppLeadParams = {
    phone: PHONE,
    name: 'Perfil Prueba',
    summary: 'Pide focos LED.',
    body: 'Necesito 10 focos LED, pedro.prueba@example.com',
    captured: { producto: 'focos LED', cantidad: '10', correo: 'pedro.prueba@example.com' },
  };

  it('si rechaza los campos del negocio, la nota se escribe igual y el negocio cuenta como creado', async () => {
    vi.mocked(updateDeal).mockRejectedValueOnce(new Error('Pipedrive 400 (simulado)'));
    await expect(ensureWhatsAppDeal(params)).resolves.toMatchObject({ action: 'created', dealId: 9001 });
    expect(noteContent()).toContain('Correo: pedro.prueba@example.com');
  });

  it('si falla la creación del negocio, lanza (el webhook responde el texto B)', async () => {
    vi.mocked(createDeal).mockRejectedValueOnce(new Error('Pipedrive 500 (simulado)'));
    await expect(ensureWhatsAppDeal(params)).rejects.toThrow('Pipedrive 500');
  });
});

describe('RUT en la nota (PR 6, B12)', () => {
  const base: WhatsAppLeadParams = {
    phone: PHONE,
    name: 'Perfil Prueba',
    summary: 'Pide paneles LED para una oficina.',
    body: 'Necesito 30 paneles LED',
    captured: { producto: 'paneles LED', correo: 'compras@comercial-prueba.example.com' },
    captureStatus: 'complete',
  };

  it('un RUT válido sale con formato y su tipo', async () => {
    await ensureWhatsAppDeal({ ...base, captured: { ...base.captured, rut: '77.123.456-9', rut_valido: true, rut_tipo: 'empresa' } });
    expect(noteContent()).toContain('RUT: 77.123.456-9 (empresa)');
  });

  it('un RUT de organismo público lo dice', async () => {
    await ensureWhatsAppDeal({ ...base, captured: { ...base.captured, rut: '61.234.567-8', rut_valido: true, rut_tipo: 'organismo_publico' } });
    expect(noteContent()).toContain('RUT: 61.234.567-8 (organismo publico)');
  });

  it('un RUT que no calza queda marcado como inválido', async () => {
    await ensureWhatsAppDeal({ ...base, captured: { ...base.captured, rut: '77.123.456-8', rut_valido: false } });
    expect(noteContent()).toContain('RUT: 77.123.456-8 (INVALIDO: no calza el digito verificador)');
  });

  it('sin RUT, un guion (ya no dice "RUT empresa")', async () => {
    await ensureWhatsAppDeal(base);
    expect(noteContent()).toContain('RUT: -');
    expect(noteContent()).not.toContain('RUT empresa');
  });
});

describe('tipo de cliente del negocio según el RUT (PR 6, B12)', () => {
  const base: WhatsAppLeadParams = {
    phone: PHONE,
    name: 'Perfil Prueba',
    summary: 'Pide paneles LED.',
    body: 'compras@comercial-prueba.example.com',
    captured: { producto: 'paneles LED', correo: 'compras@comercial-prueba.example.com' },
    captureStatus: 'complete',
  };
  const leadType = () => (vi.mocked(createDeal).mock.calls[0][0] as { leadType?: string }).leadType;

  it('un RUT válido de empresa marca el negocio como B2B, aunque el último mensaje no lo diga', async () => {
    await ensureWhatsAppDeal({ ...base, captured: { ...base.captured, rut: '77.123.456-9', rut_valido: true, rut_tipo: 'empresa' } });
    expect(leadType()).toBe('B2B');
  });

  it('uno de persona o uno que no calza, no', async () => {
    await ensureWhatsAppDeal({ ...base, captured: { ...base.captured, rut: '11.111.111-1', rut_valido: true, rut_tipo: 'persona' } });
    await ensureWhatsAppDeal({ ...base, captured: { ...base.captured, rut: '77.123.456-8', rut_valido: false } });
    const types = vi.mocked(createDeal).mock.calls.map(([params]) => (params as { leadType?: string }).leadType);
    expect(types).toEqual(['B2C', 'B2C']);
  });
});

describe('PR 3, revisión de Codex: la nota cabe en Pipedrive (hallazgo 12)', () => {
  // El tope de la nota ya escapada: 90.000 bytes, bajo los ~100 KB por nota que admite Pipedrive.
  const MAX_BYTES = 90_000;
  const TRANSCRIPT_HEADER = '-- TRANSCRIPCIÓN --';
  const CUT_RE = /^\[\.\.\. transcripción recortada por tamaño: (\d+) líneas? omitidas? \.\.\.\]$/;
  const bytes = (text: string) => Buffer.byteLength(text, 'utf8');
  const base: WhatsAppLeadParams = { phone: PHONE, name: 'Perfil Prueba', summary: 'Pide paneles.', body: 'gracias', captureStatus: 'partial' };

  // Sigue siendo una nota válida: cada & abre una entidad entera, no queda < ni > sin escapar,
  // no hay letras partidas y la ficha, la transcripción y la referencia (al final) están en su lugar.
  function expectValidNote(note: string) {
    expect(note).not.toMatch(/&(?!amp;|lt;|gt;)/);
    expect(note).not.toMatch(/[<>]/);
    expect(note).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
    expect(note.startsWith('== Lead WhatsApp eLIGHTS ==\nTelefono: ' + PHONE + '\n')).toBe(true);
    expect(note.split('\n').filter((l) => l === TRANSCRIPT_HEADER)).toHaveLength(1);
    expect(note).toMatch(REF_END);
  }
  // [NOTA-REF] La nota termina con una línea vacía y su referencia: la transcripción va antes.
  const REF_END = /\n\nRef\. WhatsApp: wa-[0-9a-f]{12}$/;
  const withoutRef = (note: string) => note.replace(REF_END, '');
  const section = (note: string) => withoutRef(note).split('\n').slice(note.split('\n').indexOf(TRANSCRIPT_HEADER) + 1);

  // El caso de Codex: cumple los dos topes de la transcripción (60 mensajes de hasta 1.000 letras).
  function codexTranscript(phone: string): string {
    clearTranscript(phone);
    let upTo = 0;
    for (let i = 1; i <= 30; i++) {
      const tag = 'M' + String(i).padStart(2, '0') + ' ';
      upTo = recordTranscript(phone, 'cliente', tag + '&'.repeat(1000 - tag.length));
      if (i < 30) recordTranscript(phone, 'bot', 'Respuesta ' + i);
    }
    const text = transcriptForNote(phone, { upTo, reply: 'Cierre de prueba' });
    clearTranscript(phone);
    return text;
  }

  it('30 mensajes de 1.000 "&" y 30 respuestas: bajo el tope, con el inicio y el final y el aviso del recorte', async () => {
    const transcript = codexTranscript('+56900000298');
    expect(bytes(escapeNoteHtml(transcript))).toBeGreaterThan(MAX_BYTES);
    const note = buildNote({ ...base, transcript });
    expect(bytes(note)).toBeLessThanOrEqual(MAX_BYTES);
    expectValidNote(note);
    const kept = section(note);
    const cut = kept.findIndex((l) => CUT_RE.test(l));
    expect(cut).toBeGreaterThan(0);
    expect(kept.filter((l) => CUT_RE.test(l))).toHaveLength(1);
    // Lo de antes del aviso es el inicio de la transcripción y lo de después, su final, sin cambios.
    const original = escapeNoteHtml(transcript).split('\n');
    const omitted = Number(kept[cut].match(CUT_RE)![1]);
    expect(kept.slice(0, cut)).toEqual(original.slice(0, cut));
    expect(kept.slice(cut + 1)).toEqual(original.slice(original.length - (kept.length - cut - 1)));
    expect(cut + omitted + (kept.length - cut - 1)).toBe(original.length);
    expect(note).toContain('] Cliente: M01 &amp;');
    expect(note).toContain('] Bot: Respuesta 1\n');
    expect(note).toContain('] Cliente: M30 &amp;');
    expect(withoutRef(note).endsWith('] Bot (respuesta al crear la nota): Cierre de prueba')).toBe(true);
    // Lo mismo llega a Pipedrive (con su propia referencia).
    await ensureWhatsAppDeal({ ...base, transcript });
    expect(withoutRef(noteContent())).toBe(withoutRef(note));
    expect(noteContent()).toMatch(REF_END);
    expect(bytes(noteContent())).toBeLessThanOrEqual(MAX_BYTES);
  });

  it('un mensaje de varias líneas no se parte: el aviso queda entre mensajes enteros', () => {
    // 30 pedidos de 42 líneas (con una línea vacía), alternados con respuestas breves.
    const phone = '+56900000296';
    clearTranscript(phone);
    let upTo = 0;
    for (let i = 1; i <= 30; i++) {
      const rows = Array.from({ length: 40 }, (_, k) => k + 1 + ' ' + '&'.repeat(20));
      upTo = recordTranscript(phone, 'cliente', 'Pedido ' + i + ' (Constructora & Cia):\n\n' + rows.join('\n'));
      if (i < 30) recordTranscript(phone, 'bot', 'Ok ' + i);
    }
    const transcript = transcriptForNote(phone, { upTo, reply: 'Gracias, te contactamos' });
    clearTranscript(phone);
    expect(bytes(escapeNoteHtml(transcript))).toBeGreaterThan(MAX_BYTES);
    const note = buildNote({ ...base, transcript });
    expect(bytes(note)).toBeLessThanOrEqual(MAX_BYTES);
    expectValidNote(note);
    const kept = section(note);
    const cut = kept.findIndex((l) => CUT_RE.test(l));
    expect(cut).toBeGreaterThan(0);
    const original = escapeNoteHtml(transcript).split('\n');
    const tailLength = kept.length - cut - 1;
    expect(kept.slice(0, cut)).toEqual(original.slice(0, cut));
    expect(kept.slice(cut + 1)).toEqual(original.slice(original.length - tailLength));
    expect(cut + Number(kept[cut].match(CUT_RE)![1]) + tailLength).toBe(original.length);
    // Lo primero que falta y lo primero que sigue al aviso empiezan un mensaje (con la hora y quién).
    const header = /^\[\d{2}-\d{2}-\d{4} \d{2}:\d{2}\] (?:Cliente|Bot)/;
    expect(original[cut]).toMatch(header);
    expect(kept[cut + 1]).toMatch(header);
    expect(withoutRef(note).endsWith('] Bot (respuesta al crear la nota): Gracias, te contactamos')).toBe(true);
  });

  it('una transcripción que cabe llega entera, sin aviso', () => {
    const transcript = '[31-10-2026 10:00] Cliente: Necesito 20 paneles & 10 focos\n[31-10-2026 10:00] Bot: ¿Para qué comuna?';
    const note = buildNote({ ...base, transcript });
    expect(section(note)).toEqual(escapeNoteHtml(transcript).split('\n'));
    expect(note).not.toContain('recortada');
  });

  it('con todos los datos de la ficha al máximo, la nota sigue bajo el tope y con el inicio y el final', () => {
    const huge = '&'.repeat(5000) + '\n' + '&'.repeat(5000);
    const many = Array.from({ length: 50 }, () => huge);
    // Los cambios con la forma de flowEngine ("antes ..., ahora ...") se acotan por partes: ocupan más.
    const changes = Array.from({ length: 50 }, () => 'Producto: antes ' + huge + ', ahora ' + huge);
    const captured = {
      nombre_o_empresa: huge, correo: huge, producto: huge, tipo_de_luz: huge, cantidad: huge, proyecto_o_uso: huge,
      comuna_o_ciudad: huge, comunas_otras: many, cambios: changes, rut: huge, rut_ambiguos: many,
    };
    const note = buildNote({ ...base, name: huge, summary: huge, captured, transcript: codexTranscript('+56900000297') });
    expect(bytes(note)).toBeLessThanOrEqual(MAX_BYTES);
    expectValidNote(note);
    expect(note).toContain('] Cliente: M01 &amp;');
    expect(withoutRef(note).endsWith('] Bot (respuesta al crear la nota): Cierre de prueba')).toBe(true);
    expect(section(note).filter((l) => CUT_RE.test(l))).toHaveLength(1);
  });

  it('sin transcripción, el mensaje del cliente también queda acotado (como un mensaje de la transcripción)', () => {
    const body = 'Inicio del mensaje ' + '&'.repeat(50_000) + ' fin';
    const note = buildNote({ ...base, body });
    expect(bytes(note)).toBeLessThanOrEqual(MAX_BYTES);
    expectValidNote(note);
    expect(note).toMatch(/\] Cliente: Inicio del mensaje &amp;/);
    expect(note).toContain(' [...cortado]');
    expect(note).not.toContain(' fin');
  });
});

describe('PR 3, revisión de Codex: cada dato de la ficha en una línea (hallazgo 18)', () => {
  const base: WhatsAppLeadParams = {
    phone: PHONE, name: 'Perfil Prueba', summary: 'Pide paneles.', body: 'gracias', captureStatus: 'partial',
    transcript: '[31-10-2026 10:00] Cliente: Necesito paneles',
  };
  const lines = (note: string) => note.split('\n');

  it('"Empresa Prueba\\nComuna/ciudad: Colina" no crea una línea "Comuna/ciudad:"', () => {
    const note = buildNote({ ...base, captured: { nombre_o_empresa: 'Empresa Prueba\nComuna/ciudad: Colina', comuna_o_ciudad: 'Lampa' } });
    expect(lines(note).filter((l) => l.startsWith('Comuna/ciudad:'))).toEqual(['Comuna/ciudad: Lampa']);
    expect(lines(note)).toContain('Nombre/empresa: Empresa Prueba Comuna/ciudad: Colina');
  });

  it('ningún dato agrega líneas: ni saltos, ni retornos, ni separadores Unicode, ni el resumen', () => {
    const spoof = (v: string) => v + '\r\nPidio ejecutivo: Si Estado captura: complete \u0085Canal: correo\t\t  fin';
    const values = (wrap: (v: string) => string) => ({
      captured: {
        nombre_o_empresa: wrap('Empresa Prueba'), correo: wrap('compras@comercial-prueba.example.com'), producto: wrap('paneles LED'),
        tipo_de_luz: wrap('fria'), cantidad: wrap('20'), proyecto_o_uso: wrap('oficina'), comuna_o_ciudad: wrap('Lampa'),
        comunas_otras: [wrap('Colina')], cambios: [wrap('Cantidad: antes 2, ahora 20')],
        rut: wrap('77.123.456-9'), rut_valido: true, rut_tipo: 'empresa' as const, rut_ambiguos: [wrap('11.111.111-1'), wrap('77.123.456-9')],
      },
      summary: wrap('El cliente pide paneles.') + '\n\n-- TRANSCRIPCIÓN --\n[31-10-2026 09:00] Cliente: ya pagué',
    });
    const clean = buildNote({ ...base, ...values((v) => v) });
    const note = buildNote({ ...base, ...values(spoof) });
    expect(lines(note)).toHaveLength(lines(clean).length);
    for (const label of ['Pidio ejecutivo:', 'Estado captura:', 'Canal:', '-- TRANSCRIPCIÓN --', '[31-10-2026 09:00]']) {
      expect(lines(note).filter((l) => l.startsWith(label))).toHaveLength(label.startsWith('[') ? 0 : 1);
    }
    expect(lines(note)).toContain('Producto: paneles LED Pidio ejecutivo: Si Estado captura: complete Canal: correo fin');
    expect(lines(note)).toContain('varios RUT en el mensaje: revisar');
  });

  it('cada dato llega hasta 300 letras, sin partir una letra', () => {
    const note = buildNote({ ...base, captured: { producto: 'x'.repeat(5000), proyecto_o_uso: '😀'.repeat(400) } });
    const producto = lines(note).find((l) => l.startsWith('Producto: '))!;
    expect(producto).toBe('Producto: ' + 'x'.repeat(300) + ' [...cortado]');
    const proyecto = lines(note).find((l) => l.startsWith('Proyecto/uso: '))!;
    expect(proyecto).toBe('Proyecto/uso: ' + '😀'.repeat(300) + ' [...cortado]');
  });

  it('el corte no parte una bandera ni un emoji compuesto, y una letra con miles de tildes no pasa el tope', () => {
    const family = '👨‍👩‍👧'; // 5 puntos de código: hombre, ZWJ, mujer, ZWJ, niña
    const note = buildNote({ ...base, captured: {
      proyecto_o_uso: 'a' + '🇨🇱'.repeat(200), producto: 'x'.repeat(298) + family,
      tipo_de_luz: 'y'.repeat(290) + family + 'z'.repeat(10), comuna_o_ciudad: 'Lampa' + '́'.repeat(5000),
    } });
    const line = (label: string) => lines(note).find((l) => l.startsWith(label + ': '))!;
    expect(line('Proyecto/uso')).toBe('Proyecto/uso: a' + '🇨🇱'.repeat(149) + ' [...cortado]');
    expect(line('Producto')).toBe('Producto: ' + 'x'.repeat(298) + ' [...cortado]');
    expect(line('Tipo de luz')).toBe('Tipo de luz: ' + 'y'.repeat(290) + family + 'zzzzz [...cortado]');
    expect(line('Comuna/ciudad')).toBe('Comuna/ciudad: Lamp [...cortado]');
  });

  it('un cambio largo conserva el valor nuevo ("ahora"): se acota cada parte', () => {
    const bodega = 'iluminacion de bodega ' + 'con estanterias altas y pasillos angostos, '.repeat(5) + 'y cierre perimetral';
    const cambios = [
      'Proyecto/uso: antes ' + bodega + ', ahora cancha de futbolito en Maipu',
      'Proyecto/uso: antes cancha de futbolito en Maipu, ahora multicancha ' + 'w'.repeat(500),
    ];
    const note = buildNote({ ...base, captured: { proyecto_o_uso: 'multicancha', cambios } });
    const line = lines(note).find((l) => l.startsWith('Cambios: '))!;
    expect(line).toContain('Cambios: Proyecto/uso: antes iluminacion de bodega con estanterias');
    expect(line).toContain(' [...cortado], ahora cancha de futbolito en Maipu; Proyecto/uso: antes cancha de futbolito en Maipu, ahora multicancha w');
    expect(line.endsWith(', ahora ' + ('multicancha ' + 'w'.repeat(500)).slice(0, 300) + ' [...cortado]')).toBe(true);
  });

  it('sin transcripción, las líneas siguientes del mensaje del cliente van sangradas', () => {
    const note = buildNote({ ...base, transcript: undefined, body: 'Necesito paneles\nComuna/ciudad: Colina' });
    expect(lines(note).filter((l) => l.startsWith('Comuna/ciudad:'))).toEqual(['Comuna/ciudad: -']);
    expect(lines(note)).toContain('    Comuna/ciudad: Colina');
  });

  it('el título del negocio queda en una línea y acotado', async () => {
    await ensureWhatsAppDeal({ ...base, name: 'Perfil\nPrueba   Dos' });
    await ensureWhatsAppDeal({ ...base, name: 'N'.repeat(1000) });
    const titles = vi.mocked(createDeal).mock.calls.map(([params]) => (params as { title: string }).title);
    expect(titles[0]).toBe('WhatsApp Lead — Perfil Prueba Dos');
    expect(titles[1]).not.toMatch(/\s{2}|\n/);
    expect(titles[1].length).toBeLessThan(150);
  });
});

describe('decisión 10: la nota no se repite si Pipedrive la guardó y se perdió la respuesta', () => {
  // Pipedrive simulado: las notas guardadas (con su hora, add_time en UTC) y qué pasa con cada envío.
  type Outcome = 'ok' | 'perdida' | 'perdida-5xx' | 'perdida-red' | 'timeout' | 'rechazo';
  let stored: Array<{ id: number; deal_id: number; content: string; add_time: string }>;
  let outcomes: Outcome[];
  let searchDown: boolean;
  let afterPageRead: ((start: number) => void) | undefined;
  let postDelayMs: number;
  let nextId: number;
  const REF_LINE = /\n\nRef\. WhatsApp: (wa-[0-9a-f]{12})$/;
  const pdTime = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
  const params: WhatsAppLeadParams = {
    phone: PHONE, name: 'Perfil Prueba', summary: 'Pide focos LED.', body: 'Necesito 10 focos LED',
    captured: { producto: 'focos LED', cantidad: '10', correo: 'pedro.prueba@example.com' }, captureStatus: 'complete',
    transcript: '[01-11-2026 10:00] Cliente: Necesito 10 focos LED',
  };
  const posts = () => vi.mocked(pipedrivePost).mock.calls.filter(([path]) => path === '/notes');
  const searches = () => vi.mocked(pipedriveGet).mock.calls.filter(([path]) => path === '/notes');
  const later = (ms: number) => vi.setSystemTime(Date.now() + ms);
  const save = (deal: number, content: string, at = Date.now()) => stored.push({ id: nextId++, deal_id: deal, content, add_time: pdTime(at) });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-01T13:00:00Z'));
    stored = [];
    outcomes = [];
    searchDown = false;
    afterPageRead = undefined;
    postDelayMs = 0;
    nextId = 1;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(pipedrivePost).mockImplementation((async (path: string, body: Record<string, unknown>) => {
      if (path !== '/notes') return { success: true, data: { id: 1 } };
      const outcome = outcomes.shift() ?? 'ok';
      // 'perdida…': Pipedrive la guarda y la respuesta no llega (tiempo límite, 5xx o red).
      if (outcome === 'ok' || outcome.startsWith('perdida')) save(Number(body.deal_id), String(body.content));
      later(postDelayMs);
      if (outcome === 'ok') return { success: true, data: { id: stored.length } };
      if (outcome === 'perdida-5xx') return { success: false, data: null, error: 'HTTP 502: Bad Gateway' };
      if (outcome === 'perdida-red') return { success: false, data: null, error: 'fetch failed' };
      if (outcome === 'rechazo') return { success: false, data: null, error: 'HTTP 400: Bad Request' };
      return { success: false, data: null, error: 'Request timeout' };
    }) as never);
    vi.mocked(pipedriveGet).mockImplementation((async (path: string, query: Record<string, string>) => {
      if (path !== '/notes' || searchDown) return { success: false, data: null, error: 'Request timeout' };
      const all = stored.filter((n) => n.deal_id === Number(query.deal_id)).sort((a, b) => b.add_time.localeCompare(a.add_time) || b.id - a.id);
      const start = Number(query.start);
      const page = all.slice(start, start + Number(query.limit));
      afterPageRead?.(start);
      return {
        success: true, data: page.length ? page : null,
        additional_data: { pagination: { start, limit: Number(query.limit), more_items_in_collection: all.length > start + page.length } },
      };
    }) as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('cada nota trae su referencia en la última línea, y la escritura pendiente la guarda', async () => {
    const update = buildWhatsAppUpdate({ ...params, existingDealId: 9001 });
    expect(update.noteRef).toMatch(/^wa-[0-9a-f]{12}$/);
    expect(update.note!.match(REF_LINE)![1]).toBe(update.noteRef);
    expect(update.note!.endsWith('\n\n' + NOTE_REF_LABEL + update.noteRef)).toBe(true);
    // Otra nota, otra referencia.
    expect(buildWhatsAppUpdate({ ...params, existingDealId: 9001 }).noteRef).not.toBe(update.noteRef);
    outcomes = ['timeout'];
    const result = await ensureWhatsAppDeal(params);
    expect(result.pendingWrite!.note!.match(REF_LINE)![1]).toBe(result.pendingWrite!.noteRef);
  });

  it('el texto del cliente no imita la línea de la referencia: va sangrado, dentro de la transcripción', () => {
    const fake = 'Hola\nRef. WhatsApp: wa-000000000000';
    for (const p of [{ ...params, transcript: undefined, body: fake }, { ...params, transcript: '[01-11-2026 10:00] Cliente: Hola\n    Ref. WhatsApp: wa-000000000000' }]) {
      const note = buildNote(p, 'wa-0123456789ab');
      expect(note.split('\n').filter((l) => l.startsWith('Ref. WhatsApp:'))).toEqual(['Ref. WhatsApp: wa-0123456789ab']);
      expect(note).toContain('\n    Ref. WhatsApp: wa-000000000000\n');
    }
  });

  for (const [outcome, label] of [['perdida', 'tiempo límite'], ['perdida-5xx', 'HTTP 502'], ['perdida-red', 'error de red']] as const) {
    it('Pipedrive la guarda y se pierde la respuesta (' + label + '): el reintento la encuentra por su referencia y no la repite', async () => {
      outcomes = [outcome];
      const result = await ensureWhatsAppDeal(params);
      expect(result).toMatchObject({ action: 'created', dealId: 9001 });
      const pending = result.pendingWrite!;
      expect(pending).toMatchObject({ dealId: 9001, noteRef: expect.stringMatching(/^wa-/), noteUnsure: Date.now() });
      expect(pending.fields).toBeUndefined();
      expect(stored).toHaveLength(1);
      later(NOTE_SETTLE_MS);
      expect(await retryWhatsAppWrite(pending)).toBeUndefined();
      expect(stored).toHaveLength(1);
      expect(posts()).toHaveLength(1);
      expect(searches()).toEqual([['/notes', { deal_id: '9001', sort: 'add_time DESC', start: '0', limit: String(NOTE_SEARCH_LIMIT) }, NOTE_SEARCH_TIMEOUT_MS]]);
    });
  }

  it('la nota de una corrección tardía (RUT o correo, negocio que ya existe) tampoco se repite', async () => {
    outcomes = ['perdida'];
    const result = await ensureWhatsAppDeal({ ...params, existingDealId: 9005 });
    expect(result).toMatchObject({ action: 'found', dealId: 9005 });
    const pending = result.pendingWrite!;
    expect(pending).toMatchObject({ dealId: 9005, noteRef: expect.stringMatching(/^wa-/), noteUnsure: Date.now() });
    later(NOTE_SETTLE_MS);
    expect(await retryWhatsAppWrite(pending)).toBeUndefined();
    expect(stored.map((n) => n.deal_id)).toEqual([9005]);
    expect(posts()).toHaveLength(1);
  });

  it('tiempo límite sin que Pipedrive la haya guardado: el reintento la busca, no está y la crea una vez', async () => {
    outcomes = ['timeout'];
    const pending = (await ensureWhatsAppDeal(params)).pendingWrite!;
    expect(stored).toHaveLength(0);
    later(NOTE_SETTLE_MS);
    expect(await retryWhatsAppWrite(pending)).toBeUndefined();
    expect(searches()).toHaveLength(1);
    expect(posts()).toHaveLength(2);
    expect(stored.map((n) => n.content)).toEqual([pending.note]);
    expect(stored[0].content.endsWith(NOTE_REF_LABEL + pending.noteRef)).toBe(true);
  });

  it('si la búsqueda falla, no se repite el envío en ese turno; el turno siguiente la busca de nuevo', async () => {
    outcomes = ['perdida'];
    const pending = (await ensureWhatsAppDeal(params)).pendingWrite!;
    later(NOTE_SETTLE_MS);
    searchDown = true;
    const left = await retryWhatsAppWrite(pending);
    // Queda pendiente tal cual: la misma nota, su referencia y la hora del primer envío incierto.
    expect(left).toEqual(pending);
    expect(posts()).toHaveLength(1);
    searchDown = false;
    later(60_000);
    expect(await retryWhatsAppWrite(left!)).toBeUndefined();
    expect(posts()).toHaveLength(1);
    expect(stored).toHaveLength(1);
  });

  it('una respuesta rara de la búsqueda tampoco deja repetirla', async () => {
    outcomes = ['perdida'];
    const pending = (await ensureWhatsAppDeal(params)).pendingWrite!;
    later(NOTE_SETTLE_MS);
    vi.mocked(pipedriveGet).mockResolvedValueOnce({ success: true, data: { id: 1 } } as never);
    expect(await retryWhatsAppWrite(pending)).toEqual(pending);
    vi.mocked(pipedriveGet).mockRejectedValueOnce(new Error('falla simulada'));
    expect(await retryWhatsAppWrite(pending)).toEqual(pending);
    expect(posts()).toHaveLength(1);
  });

  it('un rechazo 4xx no necesita búsqueda: el reintento la manda directo', async () => {
    outcomes = ['rechazo'];
    const pending = (await ensureWhatsAppDeal(params)).pendingWrite!;
    expect(pending.noteRef).toMatch(/^wa-/);
    expect(pending.noteUnsure).toBeUndefined();
    expect(await retryWhatsAppWrite(pending)).toBeUndefined();
    expect(searches()).toHaveLength(0);
    expect(posts()).toHaveLength(2);
    expect(stored).toHaveLength(1);
  });

  it('un rechazo después de un envío incierto conserva la marca: el siguiente busca otra vez', async () => {
    outcomes = ['timeout', 'rechazo'];
    const pending = (await ensureWhatsAppDeal(params)).pendingWrite!;
    const first = pending.noteUnsure!;
    later(NOTE_SETTLE_MS);
    const left = await retryWhatsAppWrite(pending);
    expect(left).toMatchObject({ noteRef: pending.noteRef, noteUnsure: first });
    later(NOTE_SETTLE_MS);
    expect(await retryWhatsAppWrite(left!)).toBeUndefined();
    expect(searches()).toHaveLength(2);
    expect(stored).toHaveLength(1);
  });

  it('un envío incierto de hace menos de 30 s no se busca ni se repite todavía (Pipedrive puede estar guardándolo)', async () => {
    outcomes = ['timeout'];
    const pending = (await ensureWhatsAppDeal(params)).pendingWrite!;
    later(NOTE_SETTLE_MS - 1);
    expect(await retryWhatsAppWrite(pending)).toEqual(pending);
    expect(searches()).toHaveLength(0);
    expect(posts()).toHaveLength(1);
  });

  it('más notas posteriores al envío incierto de las que caben en las páginas revisadas: no basta para decir que no está', async () => {
    outcomes = ['timeout'];
    const pending = (await ensureWhatsAppDeal(params)).pendingWrite!;
    // Ventas agrega más notas de las que traen todas las páginas, todas después del envío incierto.
    for (let i = 0; i < NOTE_SEARCH_LIMIT * NOTE_SEARCH_MAX_PAGES + 1; i++) save(9001, 'Nota de ventas ' + i);
    later(NOTE_SETTLE_MS);
    expect(await retryWhatsAppWrite(pending)).toEqual(pending);
    expect(posts()).toHaveLength(1);
    expect(searches().map(([, query]) => (query as { start: string }).start)).toEqual(Array.from({ length: NOTE_SEARCH_MAX_PAGES }, (_, i) => String(i * (NOTE_SEARCH_LIMIT - NOTE_SEARCH_OVERLAP))));
    // Si las páginas llegan hasta antes del envío incierto, la nota no está: se manda.
    stored.splice(0, stored.length, ...stored.slice(-(NOTE_SEARCH_LIMIT - 1)));
    save(9001, 'Nota de ventas antigua', Date.now() - 3 * 3_600_000);
    save(9001, 'Otra nota de ventas antigua', Date.now() - 4 * 3_600_000);
    expect(await retryWhatsAppWrite(pending)).toBeUndefined();
    expect(posts()).toHaveLength(2);
    expect(stored.filter((n) => n.content === pending.note)).toHaveLength(1);
  });

  // Auditoría de Codex (PR 143): una sola página siempre igual dejaba la nota pendiente para siempre.
  it('la búsqueda sigue a la página siguiente: la encuentra en la segunda y no la repite', async () => {
    outcomes = ['perdida'];
    const pending = (await ensureWhatsAppDeal(params)).pendingWrite!;
    // Después de la nota del bot, ventas agrega una página completa de notas.
    later(1_000);
    for (let i = 0; i < NOTE_SEARCH_LIMIT; i++) save(9001, 'Nota de ventas ' + i);
    later(NOTE_SETTLE_MS);
    expect(await retryWhatsAppWrite(pending)).toBeUndefined();
    expect(posts()).toHaveLength(1);
    expect(searches().map(([, query]) => (query as { start: string }).start)).toEqual(['0', String(NOTE_SEARCH_LIMIT - NOTE_SEARCH_OVERLAP)]);
    expect(stored.filter((n) => n.content === pending.note)).toHaveLength(1);
  });

  it('dos páginas de notas posteriores y la nota no está (no se guardó): se manda una vez', async () => {
    outcomes = ['timeout'];
    const pending = (await ensureWhatsAppDeal(params)).pendingWrite!;
    for (let i = 0; i < NOTE_SEARCH_LIMIT + 1; i++) save(9001, 'Nota de ventas ' + i);
    later(NOTE_SETTLE_MS);
    expect(await retryWhatsAppWrite(pending)).toBeUndefined();
    expect(posts()).toHaveLength(2);
    expect(stored.filter((n) => n.content === pending.note)).toHaveLength(1);
  });

  // Auditoría de Codex (PR 143): solo la línea completa de la referencia acredita la entrega.
  it('una nota de ventas que cita solo el código no da la nota por entregada', async () => {
    outcomes = ['timeout'];
    const pending = (await ensureWhatsAppDeal(params)).pendingWrite!;
    const ref = pending.noteRef!;
    save(9001, 'Ventas: revisar enlace /x' + ref + 'z, aún falta la ficha.');
    save(9001, 'Ventas: el bot dejó ' + ref + ' pendiente');
    later(NOTE_SETTLE_MS);
    expect(await retryWhatsAppWrite(pending)).toBeUndefined();
    expect(posts()).toHaveLength(2);
    expect(stored.filter((n) => n.content === pending.note)).toHaveLength(1);
  });

  it.each([
    ['con <br /> de Pipedrive', (ref: string) => 'Ficha<br />\n<br />\nRef. WhatsApp: ' + ref],
    ['con &nbsp;', (ref: string) => 'Ficha<br>Ref.&nbsp;WhatsApp:&nbsp;' + ref],
  ])('la línea de la referencia se reconoce en el HTML que devuelve Pipedrive (%s)', async (_label, html) => {
    outcomes = ['timeout'];
    const pending = (await ensureWhatsAppDeal(params)).pendingWrite!;
    save(9001, html(pending.noteRef!));
    later(NOTE_SETTLE_MS);
    expect(await retryWhatsAppWrite(pending)).toBeUndefined();
    expect(posts()).toHaveLength(1);
  });

  it('las pendientes de antes de este cambio (sin referencia) se reintentan como antes: sin búsqueda y sin tocar su texto', async () => {
    outcomes = ['perdida', 'ok'];
    const legacy: PendingWhatsAppWrite = { dealId: 9001, note: 'Nota pendiente ficticia' };
    const left = await retryWhatsAppWrite(legacy);
    expect(left).toEqual(legacy);
    later(NOTE_SETTLE_MS);
    expect(await retryWhatsAppWrite(left!)).toBeUndefined();
    expect(searches()).toHaveLength(0);
    expect(posts().map(([, body]) => (body as { content: string }).content)).toEqual(['Nota pendiente ficticia', 'Nota pendiente ficticia']);
  });

  it('notePart separa la nota con su referencia y sus marcas, sin los campos', () => {
    const write: PendingWhatsAppWrite = {
      dealId: 9001, personId: 7001, fields: { cf_wa_correo: 'pedro.prueba@example.com' }, note: 'Nota', noteRef: 'wa-0123456789ab', noteUnsure: 5, noteUnsureLast: 9,
    };
    expect(notePart(write)).toEqual({ note: 'Nota', noteRef: 'wa-0123456789ab', noteUnsure: 5, noteUnsureLast: 9 });
    expect(notePart({ dealId: 9001, note: 'Nota' })).toEqual({ note: 'Nota' });
    expect(notePart({ dealId: 9001, fields: {} })).toEqual({});
    expect(notePart(undefined)).toEqual({});
  });

  describe('segunda revisión (verificador)', () => {
    it('dos envíos inciertos seguidos: el plazo de 30 s se cuenta desde el último, no desde el primero', async () => {
      outcomes = ['timeout'];
      const pending = (await ensureWhatsAppDeal(params)).pendingWrite!;
      const first = pending.noteUnsure!;
      expect(pending.noteUnsureLast).toBe(first);
      // El segundo envío tampoco responde (Pipedrive la guarda más tarde).
      later(NOTE_SETTLE_MS);
      outcomes = ['timeout'];
      const left = (await retryWhatsAppWrite(pending))!;
      expect(left).toMatchObject({ noteRef: pending.noteRef, noteUnsure: first, noteUnsureLast: Date.now() });
      expect(noteSearchAt(left)).toBe(Date.now() + NOTE_SETTLE_MS);
      // En este simulador el POST es inmediato: 16 s desde su corte, todavía no se busca ni se repite.
      later(16_000);
      expect(await retryWhatsAppWrite(left)).toEqual(left);
      expect(searches()).toHaveLength(1);
      expect(posts()).toHaveLength(2);
      // Pipedrive termina de guardar el segundo envío; cumplido el plazo desde él, la busca y la encuentra.
      save(9001, left.note!);
      later(NOTE_SETTLE_MS - 16_000);
      expect(await retryWhatsAppWrite(left)).toBeUndefined();
      expect(searches()).toHaveLength(2);
      expect(posts()).toHaveLength(2);
      expect(stored.filter((n) => n.content === pending.note)).toHaveLength(1);
    });

    it('noteSearchAt: 30 s desde el último envío incierto (sin él, desde el primero); sin referencia, nota o envío incierto, no hay búsqueda', () => {
      const write: PendingWhatsAppWrite = { dealId: 9001, note: 'Nota', noteRef: 'wa-0123456789ab' };
      expect(noteSearchAt({ ...write, noteUnsure: 1_000, noteUnsureLast: 5_000 })).toBe(5_000 + NOTE_SETTLE_MS);
      expect(noteSearchAt({ ...write, noteUnsure: 1_000 })).toBe(1_000 + NOTE_SETTLE_MS);
      expect(noteSearchAt(write)).toBeUndefined();
      expect(noteSearchAt({ dealId: 9001, note: 'Nota', noteUnsure: 1_000 })).toBeUndefined();
      expect(noteSearchAt({ dealId: 9001, noteRef: 'wa-0123456789ab', noteUnsure: 1_000 })).toBeUndefined();
      expect(noteSearchAt(undefined)).toBeUndefined();
    });

    it('una página llena que no viene de la más nueva a la más antigua no basta para decir que no está', async () => {
      // 60 notas de ventas de hace días; la del bot se guarda y se pierde la respuesta.
      for (let i = 0; i < NOTE_SEARCH_LIMIT + 10; i++) save(9001, 'Nota de ventas ' + i, Date.now() - 5 * 86_400_000 + i * 1_000);
      outcomes = ['perdida'];
      const pending = (await ensureWhatsAppDeal(params)).pendingWrite!;
      later(NOTE_SETTLE_MS);
      // Pipedrive no respeta el orden pedido: la página trae las más antiguas primero (sin la del bot).
      vi.mocked(pipedriveGet).mockImplementationOnce((async (_path: string, query: Record<string, string>) => ({
        success: true, data: [...stored].sort((a, b) => a.id - b.id).slice(0, Number(query.limit)),
        additional_data: { pagination: { start: 0, limit: Number(query.limit), more_items_in_collection: true } },
      })) as never);
      expect(await retryWhatsAppWrite(pending)).toEqual(pending);
      expect(posts()).toHaveLength(1);
      // En el orden pedido la encuentra.
      expect(await retryWhatsAppWrite(pending)).toBeUndefined();
      expect(posts()).toHaveLength(1);
      expect(stored.filter((n) => n.content === pending.note)).toHaveLength(1);
    });

    it('si Pipedrive rechaza la búsqueda (HTTP 4xx), esperar no sirve: la nota se manda como antes, sin perderla, y queda el error', async () => {
      outcomes = ['timeout'];
      const pending = (await ensureWhatsAppDeal(params)).pendingWrite!;
      later(NOTE_SETTLE_MS);
      vi.mocked(pipedriveGet).mockResolvedValueOnce({ success: false, data: null, error: 'HTTP 400: Bad Request' } as never);
      expect(await retryWhatsAppWrite(pending)).toBeUndefined();
      expect(searches()).toHaveLength(1);
      expect(posts()).toHaveLength(2);
      expect(stored.map((n) => n.content)).toEqual([pending.note]);
      expect(vi.mocked(console.error).mock.calls.some(([line]) => String(line).includes('rechazo la busqueda de notas'))).toBe(true);
    });

    it('un 408, un 429 o un 5xx de la búsqueda son pasajeros: no se repite en ese turno', async () => {
      outcomes = ['perdida'];
      const pending = (await ensureWhatsAppDeal(params)).pendingWrite!;
      later(NOTE_SETTLE_MS);
      for (const error of ['HTTP 408: Request Timeout', 'HTTP 429: Too Many Requests', 'HTTP 503: Service Unavailable']) {
        vi.mocked(pipedriveGet).mockResolvedValueOnce({ success: false, data: null, error } as never);
        expect(await retryWhatsAppWrite(pending)).toEqual(pending);
      }
      expect(posts()).toHaveLength(1);
      expect(stored).toHaveLength(1);
    });
  });


  describe('ronda 3: última línea, cobertura y plazo desde el corte', () => {
    async function uncertain(outcome: Outcome = 'timeout') {
      outcomes = [outcome];
      const pending = (await ensureWhatsAppDeal(params)).pendingWrite!;
      later(NOTE_SETTLE_MS);
      return pending;
    }

    it.each([
      ['marca dentro de una frase', (ref: string) => 'Ventas: revisar Ref. WhatsApp: ' + ref + ', aun falta la ficha.'],
      ['marca al principio con contenido posterior', (ref: string) => 'Ref. WhatsApp: ' + ref + '\nFalta la ficha'],
      ['marca citada y sangrada con contenido posterior', (ref: string) => 'Cita:\n    Ref. WhatsApp: ' + ref + '\nFin de la cita'],
      ['mayúscula pegada', (ref: string) => 'Ficha\nRef. WhatsApp: ' + ref + 'G'],
      ['código suelto', (ref: string) => ref],
      ['salto dentro de la marca', (ref: string) => 'Ref.\nWhatsApp: ' + ref],
      ['etiqueta escapada es texto visible', (ref: string) => '&lt;br&gt;Ref. WhatsApp: ' + ref],
      ['entidad de comillas no es un borde', (ref: string) => '&quot;Ref. WhatsApp: ' + ref + '&quot;'],
    ])('%s no acredita la entrega', async (_label, content) => {
      const pending = await uncertain();
      save(9001, content(pending.noteRef!));
      expect(await retryWhatsAppWrite(pending)).toBeUndefined();
      expect(posts()).toHaveLength(2);
      expect(stored.filter((n) => n.content === pending.note)).toHaveLength(1);
    });

    it.each([
      ['span', (ref: string) => '<p>Ref. WhatsApp: <span>' + ref + '</span></p>'],
      ['strong', (ref: string) => 'Ficha<br><strong>Ref.</strong> <strong>WhatsApp:</strong> ' + ref],
      ['nbsp antes de Ref.', (ref: string) => '<p>&nbsp;Ref. WhatsApp: ' + ref + '</p>'],
      ['br / y líneas vacías', (ref: string) => 'Ficha<br />Ref. WhatsApp: ' + ref + '<br />  <br>'],
      ['espacios internos', (ref: string) => '<div>Ficha</div><div>  Ref.&nbsp;  WhatsApp:&nbsp; ' + ref + ' </div>'],
      ['entidades escapadas no son etiquetas', (ref: string) => '<p>&lt;br&gt; &amp; &quot;Ficha&quot;</p><p>Ref. WhatsApp: ' + ref + '</p>'],
    ])('reconoce la última línea normalizada: %s', async (_label, content) => {
      const pending = await uncertain();
      save(9001, content(pending.noteRef!));
      expect(await retryWhatsAppWrite(pending)).toBeUndefined();
      expect(posts()).toHaveLength(1);
    });

    it.each(['interno', 'entre páginas'] as const)('rechaza desorden %s en la última página incompleta', async (kind) => {
      const pending = await uncertain();
      for (let i = 0; i < 51; i++) save(9001, 'Ventas ' + i, Date.now() - 100_000 + i * 1_000);
      const get = vi.mocked(pipedriveGet).getMockImplementation()!;
      vi.mocked(pipedriveGet).mockImplementation((async (path: string, query: Record<string, string>) => {
        const res = await get(path, query);
        if (Number(query.start) > 0) {
          const notes = res.data as typeof stored;
          if (kind === 'interno') notes[notes.length - 1] = { ...notes[notes.length - 1], add_time: pdTime(Date.now()) };
          else notes.forEach((n) => { n.add_time = pdTime(Date.now()); });
        }
        return res;
      }) as never);
      expect(await retryWhatsAppWrite(pending)).toEqual(pending);
      expect(posts()).toHaveLength(1);
    });

    it('rechaza desorden en la primera página incompleta', async () => {
      const pending = await uncertain();
      vi.mocked(pipedriveGet).mockResolvedValueOnce({ success: true, data: [
        { id: 1, content: 'Ventas', add_time: pdTime(Date.now() - 1_000) },
        { id: 2, content: 'Ventas', add_time: pdTime(Date.now()) },
      ], additional_data: { pagination: { more_items_in_collection: false } } } as never);
      expect(await retryWhatsAppWrite(pending)).toEqual(pending);
      expect(posts()).toHaveLength(1);
    });

    it('un borrado antes de la segunda lectura no salta la ficha aceptada (simulador)', async () => {
      const pending = await uncertain('perdida');
      for (let i = 0; i < 50; i++) save(9001, 'Ventas ' + i);
      // Se borra la más nueva, antes del ancla; la ficha queda en la posición que start=50 saltaba.
      afterPageRead = (start) => { if (start === 0) stored.splice(-1, 1); };
      expect(await retryWhatsAppWrite(pending)).toBeUndefined();
      expect(posts()).toHaveLength(1);
      expect(searches().map(([, q]) => q!.start)).toEqual(['0', String(NOTE_SEARCH_LIMIT - NOTE_SEARCH_OVERLAP)]);
      expect(stored.filter((n) => n.content === pending.note)).toHaveLength(1);
    });

    it.each(['borrado', 'movimiento'] as const)('si falta el ancla por %s entre páginas conserva la incertidumbre', async (kind) => {
      const pending = await uncertain();
      for (let i = 0; i < 60; i++) save(9001, 'Ventas ' + i);
      afterPageRead = (start) => {
        if (start !== 0) return;
        // Orden descendente por id: el último de la primera página es stored[10].
        if (kind === 'borrado') stored.splice(10, 1);
        else stored[10].add_time = pdTime(Date.now() + 1_000);
      };
      expect(await retryWhatsAppWrite(pending)).toEqual(pending);
      expect(posts()).toHaveLength(1);
    });

    it.each([undefined, null, '', 'ilegible', 0, -1, 1.5])('id ilegible (%s) no permite declarar ausencia', async (id) => {
      const pending = await uncertain();
      vi.mocked(pipedriveGet).mockResolvedValueOnce({ success: true, data: [
        { id, content: 'Ventas', add_time: pdTime(Date.now()) },
      ] } as never);
      expect(await retryWhatsAppWrite(pending)).toEqual(pending);
      expect(posts()).toHaveLength(1);
    });


    it('una marca encontrada sin id legible también deja la búsqueda fallida', async () => {
      const pending = await uncertain();
      vi.mocked(pipedriveGet).mockResolvedValueOnce({ success: true, data: [
        { content: pending.note, add_time: pdTime(Date.now()) },
      ] } as never);
      expect(await retryWhatsAppWrite(pending)).toEqual(pending);
      expect(posts()).toHaveLength(1);
    });

    it('una hora ilegible en página incompleta no permite declarar ausencia', async () => {
      const pending = await uncertain();
      vi.mocked(pipedriveGet).mockResolvedValueOnce({ success: true, data: [{ id: 1, content: 'Ventas', add_time: 'ilegible' }] } as never);
      expect(await retryWhatsAppWrite(pending)).toEqual(pending);
      expect(posts()).toHaveLength(1);
    });


    it('la última página llena también acepta el agotamiento explícito (230 notas)', async () => {
      const pending = await uncertain();
      for (let i = 0; i < 230; i++) save(9001, 'Ventas ' + i);
      expect(await retryWhatsAppWrite(pending)).toBeUndefined();
      expect(posts()).toHaveLength(2);
      expect(searches()).toHaveLength(NOTE_SEARCH_MAX_PAGES);
    });

    it('el orden entre páginas se exige aunque el ancla siga presente con su hora', async () => {
      const pending = await uncertain();
      for (let i = 0; i < 51; i++) save(9001, 'Ventas ' + i, Date.now() - 100_000 + i * 1_000);
      const get = vi.mocked(pipedriveGet).getMockImplementation()!;
      vi.mocked(pipedriveGet).mockImplementation((async (path: string, query: Record<string, string>) => {
        const res = await get(path, query);
        if (Number(query.start) > 0) {
          const notes = res.data as typeof stored;
          notes[0] = { ...notes[0], add_time: pdTime(Date.now()) };
        }
        return res;
      }) as never);
      expect(await retryWhatsAppWrite(pending)).toEqual(pending);
      expect(posts()).toHaveLength(1);
    });

    it.each([{ label: 'null', data: null }, { label: 'array vacío', data: [] }])('una segunda página vacía ($label) no acredita el ancla', async ({ data }) => {
      const pending = await uncertain();
      for (let i = 0; i < 51; i++) save(9001, 'Ventas ' + i);
      const get = vi.mocked(pipedriveGet).getMockImplementation()!;
      vi.mocked(pipedriveGet).mockImplementation((async (path: string, query: Record<string, string>) => Number(query.start) > 0
        ? { success: true, data, additional_data: { pagination: { more_items_in_collection: false } } }
        : get(path, query)) as never);
      expect(await retryWhatsAppWrite(pending)).toEqual(pending);
      expect(posts()).toHaveLength(1);
    });

    it('ids decimales en texto también sirven de ancla', async () => {
      const pending = await uncertain();
      for (let i = 0; i < 51; i++) save(9001, 'Ventas ' + i);
      const get = vi.mocked(pipedriveGet).getMockImplementation()!;
      vi.mocked(pipedriveGet).mockImplementation((async (path: string, query: Record<string, string>) => {
        const res = await get(path, query);
        return { ...res, data: (res.data as typeof stored).map((n) => ({ ...n, id: String(n.id) })) };
      }) as never);
      expect(await retryWhatsAppWrite(pending)).toBeUndefined();
      expect(posts()).toHaveLength(2);
    });

    it.each([199, 200])('exactamente %s notas y agotamiento explícito: entrega la ausente', async (count) => {
      const pending = await uncertain();
      for (let i = 0; i < count; i++) save(9001, 'Ventas ' + i);
      expect(await retryWhatsAppWrite(pending)).toBeUndefined();
      expect(posts()).toHaveLength(2);
      expect(stored.filter((n) => n.content === pending.note)).toHaveLength(1);
    });

    it('more_items_in_collection false manda aunque haya 50 notas', async () => {
      const pending = await uncertain();
      for (let i = 0; i < 50; i++) save(9001, 'Ventas ' + i);
      expect(await retryWhatsAppWrite(pending)).toBeUndefined();
      expect(searches()).toHaveLength(1);
      expect(posts()).toHaveLength(2);
    });

    it('sin metadatos una página de 50 sigue a la siguiente', async () => {
      const pending = await uncertain();
      for (let i = 0; i < 51; i++) save(9001, 'Ventas ' + i);
      const get = vi.mocked(pipedriveGet).getMockImplementation()!;
      vi.mocked(pipedriveGet).mockImplementation((async (path: string, query: Record<string, string>) => {
        const res = await get(path, query);
        return { success: res.success, data: res.data };
      }) as never);
      expect(await retryWhatsAppWrite(pending)).toBeUndefined();
      expect(searches()).toHaveLength(2);
      expect(posts()).toHaveLength(2);
    });

    it('more_items_in_collection true manda aunque haya menos de 50 notas', async () => {
      const pending = await uncertain();
      vi.mocked(pipedriveGet).mockResolvedValueOnce({ success: true, data: [
        { id: 1, content: 'Ventas', add_time: pdTime(Date.now()) },
      ], additional_data: { pagination: { more_items_in_collection: true } } } as never);
      expect(await retryWhatsAppWrite(pending)).toEqual(pending);
      expect(posts()).toHaveLength(1);
    });

    it('el tope deja error con revisar a mano y el negocio', async () => {
      const pending = await uncertain();
      const capacity = NOTE_SEARCH_LIMIT + (NOTE_SEARCH_MAX_PAGES - 1) * (NOTE_SEARCH_LIMIT - NOTE_SEARCH_OVERLAP);
      for (let i = 0; i < capacity + 1; i++) save(9001, 'Ventas ' + i);
      expect(await retryWhatsAppWrite(pending)).toEqual(pending);
      expect(posts()).toHaveLength(1);
      expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/\[NOTA-REF\].*9001.*revisar a mano/));
    });

    it('el plazo empieza al terminar un POST de 15 s, conserva el inicio del primero y evita duplicar visibilidad 20 s tras el corte', async () => {
      const startedAt = Date.now();
      postDelayMs = 15_000;
      outcomes = ['timeout'];
      const pending = (await ensureWhatsAppDeal(params)).pendingWrite!;
      expect(pending.noteUnsure).toBe(startedAt);
      expect(pending.noteUnsureLast).toBe(startedAt + 15_000);
      expect(noteSearchAt(pending)).toBe(startedAt + 15_000 + NOTE_SETTLE_MS);
      later(15_000);
      expect(await retryWhatsAppWrite(pending)).toEqual(pending);
      expect(searches()).toHaveLength(0);
      later(5_000);
      save(9001, pending.note!);
      later(10_000);
      expect(await retryWhatsAppWrite(pending)).toBeUndefined();
      expect(posts()).toHaveLength(1);
      expect(stored).toHaveLength(1);
    });

    it('otro POST incierto de 15 s actualiza solo el fin del último intento', async () => {
      postDelayMs = 15_000;
      const pending = await uncertain();
      outcomes = ['timeout'];
      const startedAt = Date.now();
      const left = (await retryWhatsAppWrite(pending))!;
      expect(left.noteUnsure).toBe(pending.noteUnsure);
      expect(left.noteUnsureLast).toBe(startedAt + postDelayMs);
      expect(noteSearchAt(left)).toBe(Date.now() + NOTE_SETTLE_MS);
    });

    it.each([false, true])('el presupuesto de 10 s es compartido; agotarlo=%s', async (exhaust) => {
      const pending = await uncertain();
      for (let i = 0; i < 170; i++) save(9001, 'Ventas ' + i);
      const delays = exhaust ? [3_000, 4_000, 3_000] : [3_000, 4_000, 2_000, 0];
      afterPageRead = () => later(delays.shift() ?? 0);
      const left = await retryWhatsAppWrite(pending);
      expect(searches().map(([, , timeout]) => timeout)).toEqual(exhaust ? [10_000, 7_000, 3_000] : [10_000, 7_000, 3_000, 1_000]);
      expect(left).toEqual(exhaust ? pending : undefined);
      expect(posts()).toHaveLength(exhaust ? 1 : 2);
    });
  });

  describe('nota grande cerca del tope de bytes, con la línea de la referencia', () => {
    const bytes = (text: string) => Buffer.byteLength(text, 'utf8');
    const ref = 'wa-0123456789ab';
    const refLine = '\n\n' + NOTE_REF_LABEL + ref;
    const base: WhatsAppLeadParams = { phone: PHONE, name: 'Perfil Prueba', summary: 'Pide paneles.', body: 'gracias', captureStatus: 'partial' };
    // Dos mensajes cuya transcripción ocupa exactamente `size` bytes ya escapada ('&' ocupa 5).
    const transcriptOf = (size: number) => {
      const first = '[01-11-2026 10:00] Cliente: Pedido & ' + 'x'.repeat(100);
      const prefix = '[01-11-2026 10:01] Cliente: ';
      return first + '\n' + prefix + 'y'.repeat(size - bytes(escapeNoteHtml(first)) - 1 - prefix.length);
    };
    // Lo que ocupa la ficha (todo menos la transcripción y la referencia).
    const short = '[01-11-2026 10:00] Cliente: hola';
    const head = bytes(buildNote({ ...base, transcript: short }, ref)) - bytes(short) - bytes(refLine);

    it('una transcripción que cabe solo sin la referencia se recorta: la nota queda bajo el tope y termina en la referencia', () => {
      const transcript = transcriptOf(NOTE_MAX_BYTES - head - 10);
      expect(head + bytes(escapeNoteHtml(transcript))).toBeLessThanOrEqual(NOTE_MAX_BYTES);
      const note = buildNote({ ...base, transcript }, ref);
      expect(bytes(note)).toBeLessThanOrEqual(NOTE_MAX_BYTES);
      expect(note.endsWith(refLine)).toBe(true);
      expect(note).toMatch(/\[\.\.\. transcripción recortada por tamaño: \d+ líneas? omitidas? \.\.\.\]/);
      expect(note).toContain('] Cliente: Pedido &amp; x');
    });

    it('una que cabe con la referencia llega entera, justo en el tope', () => {
      const transcript = transcriptOf(NOTE_MAX_BYTES - head - bytes(refLine));
      const note = buildNote({ ...base, transcript }, ref);
      expect(bytes(note)).toBe(NOTE_MAX_BYTES);
      expect(note).not.toContain('recortada');
      expect(note.endsWith('y' + refLine)).toBe(true);
    });

    it('la que llega a Pipedrive es la misma, bajo el tope, y la búsqueda la encuentra por su referencia', async () => {
      outcomes = ['perdida'];
      const pending = (await ensureWhatsAppDeal({ ...base, transcript: transcriptOf(NOTE_MAX_BYTES - head - 10) })).pendingWrite!;
      expect(bytes(pending.note!)).toBeLessThanOrEqual(NOTE_MAX_BYTES);
      expect(pending.note!.endsWith('\n\n' + NOTE_REF_LABEL + pending.noteRef)).toBe(true);
      later(NOTE_SETTLE_MS);
      expect(await retryWhatsAppWrite(pending)).toBeUndefined();
      expect(stored).toHaveLength(1);
    });
  });
});
