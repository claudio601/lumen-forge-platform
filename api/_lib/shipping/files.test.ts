// api/_lib/shipping/files.test.ts
// Archivos del aviso de despacho (spec Nivel 2, §4.3 y §10; desde el 19-11-2026 el PDF es opcional y
// la foto del comprobante obligatoria): 0, 1 o 2 PDF, el número como entero
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
/** Como la API real: `name` es el nombre visible y `file_name`, la clave del almacenamiento (sin extensión). */
function file(fileName: string, over: Partial<DealFileMeta> = {}): DealFileMeta {
  const id = nextId++;
  return {
    id,
    name: fileName,
    file_name: `k${String(id).padStart(4, '0')}aB3dE5fG7hJ9kL1mN3pQ5rS7tV9w`,
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

describe('el PDF del documento (opcional desde el 19-11-2026: la factura se envía antes del despacho)', () => {
  it('sin PDF sale igual, solo con la foto del comprobante', () => {
    const r = select([file('comprobante.jpg')]);
    expect(r.ok && [r.document, r.voucher.fileName]).toEqual([null, 'comprobante.jpg']);
  });

  it('un PDF sin el número no se adjunta: puede ser un adjunto del cliente de /cotizador', () => {
    const r = select([file('documento.pdf'), file('plano.pdf'), file('comprobante.jpg')]);
    expect(r.ok && r.document).toBeNull();
  });

  it('se adjunta el que lleva el número en el nombre', () => {
    const r = select([file('cotizacion-2026-11-12.pdf'), file('factura_1234.pdf'), file('comprobante.jpg')]);
    expect(r.ok && r.document?.fileName).toBe('factura_1234.pdf');
  });

  it('2 con el número: no sale y los nombra', () => {
    expect(messages(select([file('1234.pdf'), file('factura 1234 copia.pdf'), file('comprobante.jpg')]))[0]).toMatch(/^Hay 2 PDF con el N° 1234/);
  });

  it('guía de despacho: la misma regla', () => {
    const r = select([file('cotizacion.pdf'), file('guia 291.pdf'), file('voucher.jpg')], { document: GUIA });
    expect(r.ok && r.document?.fileName).toBe('guia 291.pdf');
    expect(messages(select([file('guia 291.pdf'), file('guia-291 (1).pdf'), file('voucher.jpg')], { document: GUIA }))[0]).toMatch(/deja solo el de la guía de despacho N° 291\.$/);
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
      file('factura-ok-1234.pdf'),
      file('comprobante.jpg'),
    ]);
    expect(r.ok && [r.document?.fileName, r.voucher.fileName]).toEqual(['factura-ok-1234.pdf', 'comprobante.jpg']);
  });

  it('(prueba real, 19-11) el nombre es `name`: `file_name` es la clave del almacenamiento, sin extensión', () => {
    const r = select([file('factura-1234.pdf'), file('comprobante-starken.jpg')]);
    expect(r.ok && [r.document?.fileName, r.voucher.fileName]).toEqual(['factura-1234.pdf', 'comprobante-starken.jpg']);
    // Sin `name`, el de `file_name` (respaldo).
    const legacy = select([{ ...file('x'), name: undefined, file_name: 'factura 1234.pdf' }, file('comprobante.jpg')]);
    expect(legacy.ok && legacy.document?.fileName).toBe('factura 1234.pdf');
  });

  it('(prueba real, 19-11) un PDF o una foto que quedó en Google Drive se nombra, en vez de enviar sin él', () => {
    const drive = { remote_location: 'googledocs' };
    const driveMessage = (name: string) =>
      `El archivo «${name}» quedó guardado en Google Drive y el aviso no lo puede descargar: súbelo de nuevo al negocio con Google Drive desconectado en Pipedrive (Herramientas y aplicaciones → Documentos), o avísale a Claude.`;
    // El PDF es opcional, pero si el dueño subió el de la factura y quedó en Drive, el aviso no sale sin él.
    expect(messages(select([file('factura-1234.pdf', drive), file('comprobante.jpg')]))).toEqual([driveMessage('factura-1234.pdf')]);
    expect(messages(select([file('factura-1234.pdf'), file('comprobante.jpg', drive)]))).toEqual([driveMessage('comprobante.jpg')]);
    // Si en Pipedrive hay uno que sirve, el de Drive no importa; tampoco los de Drive viejos o de un correo.
    const ok = select([file('factura-1234.pdf'), file('factura-1234 drive.pdf', drive), file('voucher.jpg'), file('voucher drive.jpg', drive)]);
    expect(ok.ok && [ok.document?.fileName, ok.voucher.fileName]).toEqual(['factura-1234.pdf', 'voucher.jpg']);
    expect(messages(select([file('viejo.jpg', { ...drive, add_time: '2026-11-08 12:00:00' })]))[0]).toMatch(/^Falta la foto del comprobante/);
  });

  it('se ignoran los nombres que pone el aviso (factura, guía y comprobante)', () => {
    const r = select([file('Factura-1234.pdf'), file('Guia-de-despacho-291.pdf'), file('Comprobante-Starken-123456789.jpg'), file('Comprobante-Transportes-TVP.png'), file('nuevo 1234.pdf'), file('comprobante nuevo.jpg')]);
    expect(r.ok && [r.document?.fileName, r.voucher.fileName]).toEqual(['nuevo 1234.pdf', 'comprobante nuevo.jpg']);
  });

  it('ventana de 7 días: los adjuntos de una solicitud PY- de hace 10 días no cuentan', () => {
    const r = select([file('plano-cliente.pdf', { add_time: '2026-11-08 12:00:00' }), file('foto-cliente.jpg', { add_time: '2026-11-08 12:00:00' })]);
    expect(r.ok).toBe(false);
    expect(select([file('reciente.jpg', { add_time: '2026-11-11 17:06:00' })]).ok).toBe(true);
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
    expect(r.ok && [r.document?.fileName, r.voucher.fileName]).toEqual(['factura 1234.pdf', 'voucher-2.jpg']);
    const onlyOld = selectShippingFiles(files.slice(0, 2), { document: FACTURA, lastNoticeAt, now });
    expect(onlyOld.ok === false && onlyOld.problems[0].message).toMatch(/cuenta solo una agregada después del último aviso/);
  });

  it('un archivo sin fecha o sin id no cuenta', () => {
    expect(select([file('comprobante.jpg', { add_time: 'ayer' }), file('voucher.jpg', { id: null })]).ok).toBe(false);
  });
});

describe('la foto del comprobante (obligatoria desde el 19-11-2026)', () => {
  it('sin foto, el aviso no sale', () => {
    expect(messages(select([file('factura 1234.pdf')]))).toEqual([
      'Falta la foto del comprobante del operador: súbela en JPG o PNG a Archivos del negocio (cuenta solo una agregada en los últimos 7 días; no cuentan los adjuntos de correos).',
    ]);
  });

  it('una sola foto, aunque no diga comprobante', () => {
    const r = select([file('factura 1234.pdf'), file('IMG_2041.jpg')]);
    expect(r.ok && r.voucher.fileName).toBe('IMG_2041.jpg');
  });

  it('gana la que dice voucher o comprobante', () => {
    const r = select([file('factura 1234.pdf'), file('IMG_2041.jpg'), file('Voucher Starken.PNG')]);
    expect(r.ok && r.voucher.fileName).toBe('Voucher Starken.PNG');
  });

  it('2 fotos candidatas: no sale (no se adivina)', () => {
    expect(messages(select([file('factura 1234.pdf'), file('IMG_1.jpg'), file('IMG_2.jpeg')]))).toEqual([
      'Hay 2 fotos («IMG_1.jpg», «IMG_2.jpeg») y ninguna dice «comprobante» o «voucher» en el nombre: deja solo la del comprobante.',
    ]);
    expect(messages(select([file('factura 1234.pdf'), file('comprobante 1.jpg'), file('voucher 2.png')]))[0]).toMatch(/^Hay 2 fotos de comprobante/);
  });

  it('HEIC no se acepta (un solo mensaje, sin además «falta la foto»)', () => {
    expect(messages(select([file('factura 1234.pdf'), file('IMG_3001.HEIC')]))).toEqual([
      'La foto «IMG_3001.HEIC» no es JPG ni PNG: súbela como JPG o PNG (o bórrala si no es el comprobante).',
    ]);
  });
});

describe('topes por file_size, antes de descargar', () => {
  it('3 MB el PDF y 5 MB la foto', () => {
    expect(select([file('factura 1234.pdf', { file_size: MAX_DOCUMENT_BYTES }), file('voucher.jpg')]).ok).toBe(true);
    expect(messages(select([file('factura 1234.pdf', { file_size: MAX_DOCUMENT_BYTES + 1 }), file('voucher.jpg')]))).toEqual([
      'El PDF «factura 1234.pdf» supera el máximo de 3 MB (pesa 3.145.729 bytes).',
    ]);
    expect(messages(select([file('factura 1234.pdf'), file('voucher.jpg', { file_size: 6 * 1024 * 1024 })]))).toEqual([
      'La foto del comprobante «voucher.jpg» supera el máximo de 5 MB (pesa 6.291.456 bytes).',
    ]);
    expect(select([file('factura 1234.pdf'), file('voucher.jpg', { file_size: MAX_VOUCHER_BYTES })]).ok).toBe(true);
  });

  it('sin file_size no se descarga a ciegas', () => {
    expect(messages(select([file('factura 1234.pdf', { file_size: undefined }), file('voucher.jpg')]))).toEqual(['No se pudo leer el tamaño de el PDF «factura 1234.pdf».']);
  });

  it('el tope de la descarga va en la selección', () => {
    const r = select([file('factura 1234.pdf'), file('voucher.jpg')]);
    expect(r.ok && [r.document?.maxBytes, r.voucher.maxBytes]).toEqual([MAX_DOCUMENT_BYTES, MAX_VOUCHER_BYTES]);
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
    // Sin orden de flete (opcional desde el 24-11-2026): sin el guion final.
    expect(voucherFileName(resolveCarrier({ id: null, label: 'Transportes TVP' }), '', 'png')).toBe('Comprobante-Transportes-TVP.png');
    expect(checkDownloadedFile(photo, JPEG, { ...ctx, orderNormalized: '' })).toMatchObject({ ok: true, attachment: { fileName: 'Comprobante-Starken.jpg' } });
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
    const r = select([...names.map((n) => file(n)), file('otro 1234.pdf'), file('comprobante.jpg')]);
    expect(r.ok && [r.document?.fileName, r.voucher.fileName]).toEqual(['otro 1234.pdf', 'comprobante.jpg']);
  });
});
