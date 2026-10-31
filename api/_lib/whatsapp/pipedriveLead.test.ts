// api/_lib/whatsapp/pipedriveLead.test.ts
// Bot de WhatsApp, PR 1: lo que ensureWhatsAppDeal escribe en Pipedrive.
// - Instalación: el correo y el nombre (install_*) llegan a la persona, a la nota y a los campos.
// - La nota y los campos nunca escriben un objeto, aunque llegue uno.
// - Un dato raro no deja una persona sin negocio: la nota y los campos se arman antes.
// - Si Pipedrive rechaza los campos del negocio, la nota se escribe igual.
// - PR 2: los cambios de un dato ya capturado y las varias cantidades de un mensaje van a la nota.
// - PR 3 (revisión de Codex, hallazgos 12 y 18): la nota cabe en Pipedrive y ningún dato imita otra línea.
// Pipedrive está simulado (sin red); solo datos inventados.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../pipedrive/persons.js', () => ({ findOrCreatePerson: vi.fn() }));
vi.mock('../pipedrive/deals.js', () => ({ createDeal: vi.fn(), updateDeal: vi.fn() }));
vi.mock('../pipedrive/fieldOptions.js', () => ({ initFieldOptions: vi.fn(async () => {}) }));
vi.mock('../pipedrive/client.js', () => ({ pipedrivePost: vi.fn() }));

import { buildNote, ensureWhatsAppDeal, escapeNoteHtml, WA_DEDUP_WINDOW_DAYS } from './pipedriveLead';
import type { WhatsAppLeadParams } from './pipedriveLead';
import { findOrCreatePerson } from '../pipedrive/persons.js';
import { createDeal, updateDeal } from '../pipedrive/deals.js';
import { pipedrivePost } from '../pipedrive/client.js';
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
  // no hay letras partidas y la ficha y la transcripción están en su lugar.
  function expectValidNote(note: string) {
    expect(note).not.toMatch(/&(?!amp;|lt;|gt;)/);
    expect(note).not.toMatch(/[<>]/);
    expect(note).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
    expect(note.startsWith('== Lead WhatsApp eLIGHTS ==\nTelefono: ' + PHONE + '\n')).toBe(true);
    expect(note.split('\n').filter((l) => l === TRANSCRIPT_HEADER)).toHaveLength(1);
  }
  const section = (note: string) => note.split('\n').slice(note.split('\n').indexOf(TRANSCRIPT_HEADER) + 1);

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
    expect(note.endsWith('] Bot (respuesta al crear la nota): Cierre de prueba')).toBe(true);
    // Lo mismo llega a Pipedrive.
    await ensureWhatsAppDeal({ ...base, transcript });
    expect(noteContent()).toBe(note);
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
    expect(note.endsWith('] Bot (respuesta al crear la nota): Gracias, te contactamos')).toBe(true);
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
    expect(note.endsWith('] Bot (respuesta al crear la nota): Cierre de prueba')).toBe(true);
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
