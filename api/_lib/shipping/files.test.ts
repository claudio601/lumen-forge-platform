// api/_lib/shipping/files.test.ts
// Archivos del aviso de despacho (spec Nivel 2, §4.3 y §10): 0, 1 o 2 PDF, el número como entero
// en el nombre, factura y guía de despacho, tipo por bytes, topes por file_size antes de
// descargar, «después del último aviso» el mismo día, ventana de 7 días, 2 fotos candidatas,
// archivos inactivos, remotos, incrustados o de correos, y los nombres que pone el aviso.
// Nombres y metadatos inventados.

import { describe, expect, it } from 'vitest';
import {
  checkDownloadedFile,
  MAX_DOCUMENT_BYTES,
  MAX_VOUCHER_BYTES,
  nameHasNumber,
  selectShippingFiles,
  voucherFileName,
  type DealFileMeta,
} from './files';
import { resolveCarrier } from './carriers';
import type { ShippingDocument } from './documents';

/** 18-11-2026 17:05 UTC (14:05 en Chile). */
const NOW = new Date('2026-11-18T17:05:00Z');
const FACTURA: ShippingDocument = { type: 'factura', number: '1234' };
const GUIA: ShippingDocument = { type: 'guia', number: '291' };

let nextId = 1;
function file(fileName: string, over: Partial<DealFileMeta> = {}): DealFileMeta {
  return {
    id: nextId++,
    file_name: fileName,
    add_time: '2026-11-18 16:00:00',
    file_size: 200 * 1024,
    active_flag: true,
    inline_flag: false,
    remote_location: 's3',
    mail_message_id: null,
    ...over,
  };
}

const select = (files: DealFileMeta[], opts: { document?: ShippingDocument; lastNoticeAt?: Date | null } = {}) =>
  selectShippingFiles(files, { document: opts.document ?? FACTURA, lastNoticeAt: opts.lastNoticeAt ?? null, now: NOW });

const messages = (r: ReturnType<typeof select>) => (r.ok === false ? r.problems.map((p) => p.message) : []);

describe('el número del documento en el nombre', () => {
  it('como número entero: la factura 12 no calza con una fecha', () => {
    expect(nameHasNumber('cotizacion-2026-11-12.pdf', '12')).toBe(false);
    expect(nameHasNumber('Factura 12.pdf', '12')).toBe(true);
    expect(nameHasNumber('factura-1234.pdf', '1234')).toBe(true);
    expect(nameHasNumber('DTE_33_1234.pdf', '1234')).toBe(true);
    expect(nameHasNumber('F1234.pdf', '1234')).toBe(true);
    expect(nameHasNumber('factura 00001234.pdf', '1234')).toBe(true);
    expect(nameHasNumber('factura 1.234.pdf', '1234')).toBe(true);
    expect(nameHasNumber('factura 12345.pdf', '1234')).toBe(false);
    expect(nameHasNumber('factura 51234.pdf', '1234')).toBe(false);
  });
});

describe('el PDF del documento', () => {
  it('uno solo, aunque no lleve el número', () => {
    const r = select([file('documento.pdf')]);
    expect(r.ok && r.document.fileName).toBe('documento.pdf');
    expect(r.ok && r.voucher).toBeNull();
  });

  it('sin PDF, el aviso no sale', () => {
    expect(messages(select([]))).toEqual([
      'Falta el PDF de la factura N° 1234: adjúntalo en Archivos del negocio (cuenta solo uno agregado en los últimos 7 días; no cuentan los adjuntos de correos).',
    ]);
  });

  it('con 2 PDF gana el que lleva el número', () => {
    const r = select([file('cotizacion-2026-11-12.pdf'), file('factura_1234.pdf')]);
    expect(r.ok && r.document.fileName).toBe('factura_1234.pdf');
  });

  it('con 2 PDF sin el número, o 2 con el número, no sale y los nombra', () => {
    expect(messages(select([file('a.pdf'), file('b.pdf')]))).toEqual([
      'Hay 2 PDF y ninguno lleva el N° 1234 en el nombre («a.pdf», «b.pdf»): deja solo el de la factura N° 1234 o ponle el número en el nombre.',
    ]);
    expect(messages(select([file('1234.pdf'), file('factura 1234 copia.pdf')]))[0]).toMatch(/^Hay 2 PDF con el N° 1234/);
  });

  it('guía de despacho: la misma regla, con su nombre en los mensajes', () => {
    const r = select([file('cotizacion.pdf'), file('guia 291.pdf')], { document: GUIA });
    expect(r.ok && r.document.fileName).toBe('guia 291.pdf');
    expect(messages(select([], { document: GUIA }))[0]).toMatch(/^Falta el PDF de la guía de despacho N° 291/);
  });
});

describe('qué archivos cuentan', () => {
  it('se ignoran los inactivos, remotos (Google Drive), incrustados y adjuntos de correos', () => {
    const r = select([
      file('factura 1234.pdf', { active_flag: false }),
      file('factura 1234 drive.pdf', { remote_location: 'googledocs' }),
      file('firma.png', { inline_flag: true }),
      file('factura 1234 correo.pdf', { mail_message_id: 'abc123' }),
      file('voucher correo.jpg', { mail_message_id: 987 }),
      file('factura-ok.pdf'),
    ]);
    expect(r.ok && [r.document.fileName, r.voucher]).toEqual(['factura-ok.pdf', null]);
  });

  it('se ignoran los nombres que pone el aviso (factura y guía)', () => {
    const r = select([file('Factura-1234.pdf'), file('Guia-de-despacho-291.pdf'), file('Comprobante-Starken-123456789.jpg'), file('nuevo.pdf')]);
    expect(r.ok && [r.document.fileName, r.voucher]).toEqual(['nuevo.pdf', null]);
  });

  it('ventana de 7 días: los adjuntos de una solicitud PY- de hace 10 días no cuentan', () => {
    const r = select([file('plano-cliente.pdf', { add_time: '2026-11-08 12:00:00' }), file('foto-cliente.jpg', { add_time: '2026-11-08 12:00:00' })]);
    expect(r.ok).toBe(false);
    expect(select([file('reciente.pdf', { add_time: '2026-11-11 17:06:00' })]).ok).toBe(true);
  });

  it('después del último aviso, el mismo día: lo del minuto del aviso o antes no cuenta', () => {
    // Último aviso: 18-11 14:05 de Chile = 17:05 UTC (sin segundos)
    const lastNoticeAt = new Date('2026-11-18T17:05:00Z');
    const now = new Date('2026-11-18T20:00:00Z');
    const files = [
      file('factura 1111.pdf', { add_time: '2026-11-18 17:04:10' }),
      file('voucher-1.jpg', { add_time: '2026-11-18 17:05:40' }),
      file('factura 1234.pdf', { add_time: '2026-11-18 19:30:00' }),
      file('voucher-2.jpg', { add_time: '2026-11-18 19:31:00' }),
    ];
    const r = selectShippingFiles(files, { document: FACTURA, lastNoticeAt, now });
    expect(r.ok && [r.document.fileName, r.voucher?.fileName]).toEqual(['factura 1234.pdf', 'voucher-2.jpg']);
    const onlyOld = selectShippingFiles(files.slice(0, 2), { document: FACTURA, lastNoticeAt, now });
    expect(onlyOld.ok === false && onlyOld.problems[0].message).toMatch(/cuenta solo uno agregado después del último aviso/);
  });

  it('un archivo sin fecha o sin id no cuenta', () => {
    expect(select([file('factura 1234.pdf', { add_time: 'ayer' }), file('x.pdf', { id: null })]).ok).toBe(false);
  });
});

describe('la foto del comprobante', () => {
  it('opcional; una sola foto, aunque no diga comprobante', () => {
    const r = select([file('factura 1234.pdf'), file('IMG_2041.jpg')]);
    expect(r.ok && r.voucher?.fileName).toBe('IMG_2041.jpg');
  });

  it('gana la que dice voucher o comprobante', () => {
    const r = select([file('factura 1234.pdf'), file('IMG_2041.jpg'), file('Voucher Starken.PNG')]);
    expect(r.ok && r.voucher?.fileName).toBe('Voucher Starken.PNG');
  });

  it('2 fotos candidatas: no sale (no se adivina)', () => {
    expect(messages(select([file('factura 1234.pdf'), file('IMG_1.jpg'), file('IMG_2.jpeg')]))).toEqual([
      'Hay 2 fotos («IMG_1.jpg», «IMG_2.jpeg») y ninguna dice «comprobante» o «voucher» en el nombre: deja solo la del comprobante.',
    ]);
    expect(messages(select([file('factura 1234.pdf'), file('comprobante 1.jpg'), file('voucher 2.png')]))[0]).toMatch(/^Hay 2 fotos de comprobante/);
  });

  it('HEIC no se acepta', () => {
    expect(messages(select([file('factura 1234.pdf'), file('IMG_3001.HEIC')]))).toEqual([
      'La foto «IMG_3001.HEIC» no es JPG ni PNG: súbela como JPG o PNG (o bórrala si no es el comprobante).',
    ]);
  });
});

describe('topes por file_size, antes de descargar', () => {
  it('3 MB el PDF y 5 MB la foto', () => {
    expect(select([file('factura 1234.pdf', { file_size: MAX_DOCUMENT_BYTES })]).ok).toBe(true);
    expect(messages(select([file('factura 1234.pdf', { file_size: MAX_DOCUMENT_BYTES + 1 })]))).toEqual([
      'El PDF «factura 1234.pdf» supera el máximo de 3 MB (pesa 3.145.729 bytes).',
    ]);
    expect(messages(select([file('factura 1234.pdf'), file('voucher.jpg', { file_size: 6 * 1024 * 1024 })]))).toEqual([
      'La foto del comprobante «voucher.jpg» supera el máximo de 5 MB (pesa 6.291.456 bytes).',
    ]);
    expect(select([file('factura 1234.pdf'), file('voucher.jpg', { file_size: MAX_VOUCHER_BYTES })]).ok).toBe(true);
  });

  it('sin file_size no se descarga a ciegas', () => {
    expect(messages(select([file('factura 1234.pdf', { file_size: undefined })]))).toEqual(['No se pudo leer el tamaño de el PDF «factura 1234.pdf».']);
  });

  it('el tope de la descarga va en la selección', () => {
    const r = select([file('factura 1234.pdf'), file('voucher.jpg')]);
    expect(r.ok && [r.document.maxBytes, r.voucher?.maxBytes]).toEqual([MAX_DOCUMENT_BYTES, MAX_VOUCHER_BYTES]);
  });
});

describe('bytes descargados', () => {
  const PDF = new TextEncoder().encode('%PDF-1.7\n%prueba');
  const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
  const starken = resolveCarrier({ id: 'starken' });
  const ctx = { document: FACTURA, carrier: starken, orderNormalized: '123456789' };
  const doc = { id: 1, role: 'document' as const, fileName: 'factura.pdf', size: PDF.length, maxBytes: MAX_DOCUMENT_BYTES };
  const photo = { id: 2, role: 'voucher' as const, fileName: 'voucher.jpg', size: 8, maxBytes: MAX_VOUCHER_BYTES };

  it('nombres limpios: Factura-<N>.pdf, Guia-de-despacho-<N>.pdf y Comprobante-<Operador>-<orden>', () => {
    expect(checkDownloadedFile(doc, PDF, ctx)).toMatchObject({ ok: true, attachment: { fileName: 'Factura-1234.pdf', contentType: 'application/pdf' } });
    expect(checkDownloadedFile(doc, PDF, { ...ctx, document: GUIA })).toMatchObject({ ok: true, attachment: { fileName: 'Guia-de-despacho-291.pdf' } });
    expect(checkDownloadedFile(photo, JPEG, ctx)).toMatchObject({ ok: true, attachment: { fileName: 'Comprobante-Starken-123456789.jpg', contentType: 'image/jpeg' } });
    // la extensión sale de los bytes, no del nombre
    expect(checkDownloadedFile(photo, PNG, ctx)).toMatchObject({ ok: true, attachment: { fileName: 'Comprobante-Starken-123456789.png', contentType: 'image/png' } });
    expect(voucherFileName(resolveCarrier({ id: 'pullman-cargo' }), '23501234567', 'jpg')).toBe('Comprobante-Pullman-Cargo-23501234567.jpg');
  });

  it('tipo por bytes: un PDF con extensión .jpg no pasa como comprobante; una foto no pasa como factura', () => {
    expect(checkDownloadedFile(photo, PDF, ctx)).toMatchObject({ ok: false, problem: { message: 'La foto del comprobante «voucher.jpg» no es JPG ni PNG.' } });
    expect(checkDownloadedFile(doc, JPEG, ctx)).toMatchObject({ ok: false, problem: { message: 'El PDF «factura.pdf» no es un PDF: adjunta la factura N° 1234 en PDF.' } });
  });

  it('vacío o más grande que el tope', () => {
    expect(checkDownloadedFile(doc, new Uint8Array(), ctx).ok).toBe(false);
    expect(checkDownloadedFile({ ...doc, maxBytes: 4 }, PDF, ctx).ok).toBe(false);
  });

  it('los nombres limpios son los que la selección ignora después (el aviso que vuelve por correo)', () => {
    const names = [
      (checkDownloadedFile(doc, PDF, ctx) as { attachment: { fileName: string } }).attachment.fileName,
      (checkDownloadedFile(doc, PDF, { ...ctx, document: GUIA }) as { attachment: { fileName: string } }).attachment.fileName,
      (checkDownloadedFile(photo, JPEG, { ...ctx, carrier: resolveCarrier({ id: 'cruz-del-sur' }) }) as { attachment: { fileName: string } }).attachment.fileName,
    ];
    const r = select([...names.map((n) => file(n)), file('otro.pdf')]);
    expect(r.ok && [r.document.fileName, r.voucher]).toEqual(['otro.pdf', null]);
  });
});
