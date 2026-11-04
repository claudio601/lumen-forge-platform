// api/_lib/whatsapp/transcript.test.ts
// Bot de WhatsApp, PR 3 del plan (B1): la transcripción, sin el webhook. Solo mensajes inventados.

import { afterEach, describe, expect, it } from 'vitest';
import {
  PRIVACY_MARK, TRANSCRIPT_HEAD, TRANSCRIPT_TAIL, botReplyText, chileTime, clearTranscript, clearTranscriptAfterNote,
  getTranscript, inboundText, noteEntryIds, recordTranscript, restoreTranscript, transcriptForNote,
} from './transcript';

const PHONE = '+56900000901';
afterEach(() => clearTranscript(PHONE));

describe('hora de Chile', () => {
  it('en horario de verano (UTC-3) y de invierno (UTC-4)', () => {
    expect(chileTime(Date.parse('2026-10-31T17:05:00Z'))).toBe('31-10-2026 14:05');
    expect(chileTime(Date.parse('2026-06-15T17:05:00Z'))).toBe('15-06-2026 13:05');
  });
});

describe('mensajes con adjuntos', () => {
  it.each<[string, string[], string]>([
    ['', ['image/jpeg'], '[El cliente envió 1 imagen]'],
    ['', ['image/jpeg', 'image/png'], '[El cliente envió 2 imágenes]'],
    ['', ['audio/ogg'], '[El cliente envió 1 audio]'],
    ['mira esto', ['application/pdf'], '[El cliente envió 1 archivo] mira esto'],
    ['  ', [], '[Mensaje vacío]'],
    ['Hola', [], 'Hola'],
  ])('"%s" con %j', (body, types, expected) => {
    expect(inboundText(body, types)).toBe(expected);
  });
});

describe('tope', () => {
  it('guarda los primeros y los últimos mensajes y cuenta los del medio', () => {
    for (let i = 1; i <= 100; i++) recordTranscript(PHONE, 'cliente', 'mensaje ' + i);
    const t = getTranscript(PHONE)!;
    expect(t.entries).toHaveLength(TRANSCRIPT_HEAD + TRANSCRIPT_TAIL);
    expect(t.omitted).toBe(100 - TRANSCRIPT_HEAD - TRANSCRIPT_TAIL);
    expect(t.entries[0].text).toBe('mensaje 1');
    expect(t.entries.at(-1)!.text).toBe('mensaje 100');
    expect(transcriptForNote(PHONE)).toContain('[... se omitieron 40 mensajes por el tope de la nota ...]');
  });
});

describe('ciclo de la nota', () => {
  it('cada mensaje lleva un número de orden creciente', () => {
    const a = recordTranscript(PHONE, 'cliente', 'hola');
    const b = recordTranscript(PHONE, 'bot', 'respuesta');
    expect(b).toBeGreaterThan(a);
    expect(getTranscript(PHONE)!.entries.map((e) => e.seq)).toEqual([a, b]);
  });

  it('después de una nota empieza "Desde la nota anterior" y un pedido nuevo no borra lo que no se anotó', () => {
    const noted = recordTranscript(PHONE, 'cliente', 'primer pedido');
    clearTranscriptAfterNote(PHONE, noted);
    recordTranscript(PHONE, 'cliente', 'gracias');
    recordTranscript(PHONE, 'cliente', '[El cliente envió 1 imagen]');
    recordTranscript(PHONE, 'cliente', 'segundo pedido');
    expect(transcriptForNote(PHONE).split('\n')[0]).toBe('(Desde la nota anterior.)');
    expect(getTranscript(PHONE)!.entries.map((e) => e.text)).toEqual(['gracias', '[El cliente envió 1 imagen]', 'segundo pedido']);
  });

  it('la nota borra solo lo que incluyó: lo que llegó mientras se escribía queda para la siguiente', () => {
    recordTranscript(PHONE, 'cliente', 'pedido A');
    const upTo = recordTranscript(PHONE, 'cliente', 'correo de A');
    const note = transcriptForNote(PHONE, { upTo, reply: 'cierre de A' });
    recordTranscript(PHONE, 'cliente', 'pedido B'); // llega mientras Pipedrive guarda la nota de A
    recordTranscript(PHONE, 'bot', 'respuesta a B');
    clearTranscriptAfterNote(PHONE, upTo);
    expect(note).toContain('Cliente: correo de A');
    expect(note).not.toContain('pedido B');
    const t = getTranscript(PHONE)!;
    expect(t.entries.map((e) => e.text)).toEqual(['pedido B', 'respuesta a B']);
    expect(t.sinceNote).toBe(true);
  });

  it('la respuesta que acompaña la nota va rotulada como tal', () => {
    const upTo = recordTranscript(PHONE, 'cliente', 'mi correo');
    const lines = transcriptForNote(PHONE, { upTo, reply: 'ya quedó registrada' }).split('\n');
    expect(lines.at(-1)).toMatch(/^\[\d{2}-\d{2}-\d{4} \d{2}:\d{2}\] Bot \(respuesta al crear la nota\): ya quedó registrada$/);
  });

  it('la conversación ya avanzada sin transcripción avisa que puede faltar el inicio', () => {
    recordTranscript(PHONE, 'cliente', 'hola', { inProgress: true });
    expect(transcriptForNote(PHONE).split('\n')[0]).toMatch(/^\(Puede faltar el inicio/);
  });
});

describe('aviso de privacidad', () => {
  it('la respuesta que lo llevó queda con una marca corta, no con el texto del aviso', () => {
    expect(PRIVACY_MARK).toBe('[+ aviso de privacidad]');
    expect(botReplyText('Hola', true)).toBe('Hola\n[+ aviso de privacidad]');
    expect(botReplyText('Hola', false)).toBe('Hola');
  });
});

describe('estado guardado', () => {
  it('a las entradas guardadas sin número de orden se les asigna uno, y las nuevas van después', () => {
    restoreTranscript(PHONE, { entries: [{ at: 1, role: 'cliente', text: 'hola' }, { at: 2, role: 'bot', text: 'respuesta' }], omitted: 0, partialStart: false, sinceNote: false });
    const restored = getTranscript(PHONE)!.entries.map((e) => e.seq);
    expect(restored.every((n) => Number.isSafeInteger(n) && n > 0)).toBe(true);
    expect(restored[1]).toBeGreaterThan(restored[0]);
    expect(recordTranscript(PHONE, 'cliente', 'otro')).toBeGreaterThan(restored[1]);
  });

  it('un número guardado mayor que el de esta instancia no se repite en los mensajes nuevos', () => {
    restoreTranscript(PHONE, { entries: [{ seq: 900_000, at: 1, role: 'cliente', text: 'de otra instancia' }], omitted: 0, partialStart: false, sinceNote: false });
    expect(recordTranscript(PHONE, 'bot', 'respuesta')).toBeGreaterThan(900_000);
  });

  it('se recupera solo con la forma esperada', () => {
    restoreTranscript(PHONE, { entries: [{ at: 1, role: 'cliente', text: 'hola' }], omitted: 0, partialStart: false, sinceNote: false });
    expect(getTranscript(PHONE)!.entries).toHaveLength(1);
    restoreTranscript(PHONE, { entries: [{ at: 'ayer', role: 'cliente', text: 'hola' }] });
    expect(getTranscript(PHONE)).toBeUndefined();
    restoreTranscript(PHONE, undefined);
    expect(getTranscript(PHONE)).toBeUndefined();
  });
});

describe('dos mensajes a la vez (H3 y H4)', () => {
  it('la respuesta a un mensaje anterior va justo después de él, aunque se registre al final', () => {
    const a = recordTranscript(PHONE, 'cliente', 'mensaje A');
    const b = recordTranscript(PHONE, 'cliente', 'mensaje B');
    recordTranscript(PHONE, 'bot', 'respuesta a B', { replyTo: b });
    recordTranscript(PHONE, 'bot', 'respuesta a A', { replyTo: a });
    expect(getTranscript(PHONE)!.entries.map((e) => e.text)).toEqual(['mensaje A', 'respuesta a A', 'mensaje B', 'respuesta a B']);
    expect(new Set(getTranscript(PHONE)!.entries.map((e) => e.id)).size).toBe(4);
  });

  it('la nota de B no lleva ni borra el mensaje de A, que sigue en curso', () => {
    const a = recordTranscript(PHONE, 'cliente', 'mensaje A');
    const b = recordTranscript(PHONE, 'cliente', 'mensaje B');
    const opts = { upTo: b, exclude: new Set([a, a + 1]) };
    const note = transcriptForNote(PHONE, { ...opts, reply: 'cierre de B' });
    expect(note).toContain('Cliente: mensaje B');
    expect(note).not.toContain('mensaje A');
    clearTranscriptAfterNote(PHONE, noteEntryIds(PHONE, opts));
    expect(getTranscript(PHONE)!.entries.map((e) => e.text)).toEqual(['mensaje A']);
  });

  it('se borra por id lo que fue en la nota: una entrada mezclada mientras tanto, aunque tenga un número menor, queda', () => {
    const upTo = recordTranscript(PHONE, 'cliente', 'pedido A');
    const ids = noteEntryIds(PHONE, { upTo });
    // Otra instancia guardó un mensaje con un número menor (su reloj iba atrás) y se mezcló aquí.
    const t = getTranscript(PHONE)!;
    restoreTranscript(PHONE, { ...t, entries: [{ seq: upTo - 1, id: 'otra-instancia', at: 1, role: 'cliente', text: 'mensaje de B' }, ...t.entries] });
    clearTranscriptAfterNote(PHONE, ids);
    expect(getTranscript(PHONE)!.entries.map((e) => e.text)).toEqual(['mensaje de B']);
  });

  it('un estado guardado sin ids recibe siempre los mismos (dos instancias no duplican la entrada)', () => {
    const saved = { entries: [{ seq: 5, at: 1, role: 'cliente', text: 'hola' }], omitted: 0, partialStart: false, sinceNote: false };
    restoreTranscript(PHONE, saved);
    const first = getTranscript(PHONE)!.entries[0].id;
    restoreTranscript(PHONE, structuredClone(saved));
    expect(getTranscript(PHONE)!.entries[0].id).toBe(first);
  });
});
