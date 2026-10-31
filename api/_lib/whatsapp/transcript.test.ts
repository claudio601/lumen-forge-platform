// api/_lib/whatsapp/transcript.test.ts
// Bot de WhatsApp, PR 3 del plan (B1): la transcripción, sin el webhook. Solo mensajes inventados.

import { afterEach, describe, expect, it } from 'vitest';
import {
  TRANSCRIPT_HEAD, TRANSCRIPT_TAIL, chileTime, clearTranscript, clearTranscriptAfterNote, getTranscript,
  inboundText, recordTranscript, restartTranscript, restoreTranscript, transcriptForNote,
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
  it('después de una nota empieza "Desde la nota anterior"; un pedido nuevo la reinicia', () => {
    recordTranscript(PHONE, 'cliente', 'primer pedido');
    clearTranscriptAfterNote(PHONE);
    recordTranscript(PHONE, 'cliente', 'gracias');
    expect(transcriptForNote(PHONE).split('\n')[0]).toBe('(Desde la nota anterior.)');
    recordTranscript(PHONE, 'cliente', 'segundo pedido');
    restartTranscript(PHONE);
    expect(getTranscript(PHONE)!.entries.map((e) => e.text)).toEqual(['segundo pedido']);
  });

  it('sin nota anterior, un pedido nuevo no borra nada', () => {
    recordTranscript(PHONE, 'cliente', 'pedido sin correo');
    recordTranscript(PHONE, 'cliente', 'otro pedido');
    restartTranscript(PHONE);
    expect(getTranscript(PHONE)!.entries).toHaveLength(2);
  });

  it('la conversación ya avanzada sin transcripción avisa que puede faltar el inicio', () => {
    recordTranscript(PHONE, 'cliente', 'hola', { inProgress: true });
    expect(transcriptForNote(PHONE).split('\n')[0]).toMatch(/^\(Puede faltar el inicio/);
  });
});

describe('estado guardado', () => {
  it('se recupera solo con la forma esperada', () => {
    restoreTranscript(PHONE, { entries: [{ at: 1, role: 'cliente', text: 'hola' }], omitted: 0, partialStart: false, sinceNote: false });
    expect(getTranscript(PHONE)!.entries).toHaveLength(1);
    restoreTranscript(PHONE, { entries: [{ at: 'ayer', role: 'cliente', text: 'hola' }] });
    expect(getTranscript(PHONE)).toBeUndefined();
    restoreTranscript(PHONE, undefined);
    expect(getTranscript(PHONE)).toBeUndefined();
  });
});
