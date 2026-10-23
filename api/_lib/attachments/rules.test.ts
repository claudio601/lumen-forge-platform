// api/_lib/attachments/rules.test.ts
// Reglas de los adjuntos del cotizador: extensiones, rutas de Blob, nombres limpios, primeros
// bytes de cada tipo (buenos y falsos), el límite de 5 y el peso legible.

import { describe, expect, it } from 'vitest';
import {
  ATTACHMENT_TYPES,
  MAX_FILE_BYTES,
  MAX_FILES,
  MAX_NAME_LENGTH,
  STORED_PATHNAME_RE,
  UPLOAD_PATHNAME_RE,
  attachmentExt,
  checkSelectedFile,
  formatBytes,
  matchesExtension,
  parseAttachmentRefs,
  pathnameExt,
  sanitizeFileName,
  sniffType,
} from './rules';

const UUID = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b';
const bytes = (...parts: (string | number[])[]) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? Array.from(p, (c) => c.charCodeAt(0)) : p)));

describe('extensiones y tipos', () => {
  it('acepta PDF, JPG (y JPEG), PNG, DWG, DXF y XLSX, sin importar mayúsculas', () => {
    expect(attachmentExt('bases.PDF')).toBe('pdf');
    expect(attachmentExt('foto.jpeg')).toBe('jpg');
    expect(attachmentExt('foto.JPG')).toBe('jpg');
    expect(attachmentExt('plano.dwg')).toBe('dwg');
    expect(attachmentExt('plano.DXF')).toBe('dxf');
    expect(attachmentExt('planilla.xlsx')).toBe('xlsx');
    expect(attachmentExt('logo.png')).toBe('png');
  });

  it.each(['bases.doc', 'planilla.xls', 'virus.exe', 'sin-extension', 'archivo.pdf.exe', '', 'x.'])('rechaza "%s"', (name) => {
    expect(attachmentExt(name)).toBeNull();
  });

  it('el tipo se fija según la extensión (los navegadores no reconocen DWG ni DXF)', () => {
    expect(ATTACHMENT_TYPES).toEqual({
      pdf: 'application/pdf',
      jpg: 'image/jpeg',
      png: 'image/png',
      dwg: 'image/vnd.dwg',
      dxf: 'image/vnd.dxf',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
  });

  it('al elegir: formato, peso (hasta 20 MB) y archivo vacío', () => {
    expect(checkSelectedFile({ name: 'bases.doc', size: 10 })).toEqual({ ok: false, reason: 'format' });
    expect(checkSelectedFile({ name: 'plano.dwg', size: MAX_FILE_BYTES + 1 })).toEqual({ ok: false, reason: 'size' });
    expect(checkSelectedFile({ name: 'ficha.pdf', size: 0 })).toEqual({ ok: false, reason: 'empty' });
    expect(checkSelectedFile({ name: 'ficha.pdf', size: MAX_FILE_BYTES })).toEqual({ ok: true, ext: 'pdf' });
  });
});

describe('rutas de Blob', () => {
  it('el permiso solo acepta cotizador/<uuid>.<ext>', () => {
    expect(UPLOAD_PATHNAME_RE.test(`cotizador/${UUID}.pdf`)).toBe(true);
    for (const bad of [
      `cotizador/${UUID}.PDF`,
      `cotizador/${UUID}.jpeg`,
      `cotizador/${UUID}.exe`,
      `otra/${UUID}.pdf`,
      `cotizador/../${UUID}.pdf`,
      `cotizador/${UUID}-abc.pdf`,
      `cotizador/bases.pdf`,
      `cotizador/${UUID}.pdf/x`,
      `/cotizador/${UUID}.pdf`,
    ]) {
      expect(UPLOAD_PATHNAME_RE.test(bad), bad).toBe(false);
    }
  });

  it('la ruta guardada admite el sufijo al azar de Blob', () => {
    expect(STORED_PATHNAME_RE.test(`cotizador/${UUID}-oYnXSVczoLa9yBYMFJOSNdaiiervF5.dwg`)).toBe(true);
    expect(STORED_PATHNAME_RE.test(`cotizador/${UUID}.dwg`)).toBe(true);
    expect(STORED_PATHNAME_RE.test(`cotizador/${UUID}-x/y.dwg`)).toBe(false);
    expect(STORED_PATHNAME_RE.test(`cotizador/${UUID}-a b.dwg`)).toBe(false);
    expect(pathnameExt(`cotizador/${UUID}-abc.xlsx`)).toBe('xlsx');
    expect(pathnameExt('https://x.blob.vercel-storage.com/cotizador/a.pdf')).toBeNull();
  });
});

describe('sanitizeFileName', () => {
  it('quita rutas, controles y caracteres que Windows no acepta, y deja una línea', () => {
    expect(sanitizeFileName('C:\\Users\\juan\\Escritorio\\bases.pdf', 'pdf')).toBe('bases.pdf');
    expect(sanitizeFileName('../../etc/plano.dwg', 'dwg')).toBe('plano.dwg');
    expect(sanitizeFileName('pla<no>:"x"|?*.dwg', 'dwg')).toBe('planox.dwg');
    expect(sanitizeFileName('ficha\ntécnica\u0000\t v2.pdf', 'pdf')).toBe('ficha técnica v2.pdf');
    expect(sanitizeFileName('\u202egpj.exe.pdf', 'pdf')).toBe('gpj.exe.pdf');
  });

  it('conserva tildes y ñ', () => {
    expect(sanitizeFileName('Iluminación Ñuñoa.xlsx', 'xlsx')).toBe('Iluminación Ñuñoa.xlsx');
  });

  it('conserva la extensión real: la agrega si el nombre no la trae o trae otra', () => {
    expect(sanitizeFileName('foto.jpeg', 'jpg')).toBe('foto.jpeg');
    expect(sanitizeFileName('bases', 'pdf')).toBe('bases.pdf');
    expect(sanitizeFileName('bases.doc', 'pdf')).toBe('bases.doc.pdf');
    expect(sanitizeFileName('', 'dwg')).toBe('archivo.dwg');
    expect(sanitizeFileName(42, 'dwg')).toBe('archivo.dwg');
    expect(sanitizeFileName('...', 'png')).toBe('archivo.png');
  });

  it(`máximo ${MAX_NAME_LENGTH} caracteres, sin perder la extensión`, () => {
    const name = sanitizeFileName('b'.repeat(300) + '.xlsx', 'xlsx');
    expect(name).toHaveLength(MAX_NAME_LENGTH);
    expect(name.endsWith('.xlsx')).toBe(true);
  });
});

describe('sniffType: primeros bytes', () => {
  const good: [string, Uint8Array, string][] = [
    ['pdf', bytes('%PDF-1.7\n%âãÏÓ'), 'PDF'],
    ['png', bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]), 'PNG'],
    ['jpg', bytes([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]), 'JPEG'],
    ['xlsx', bytes([0x50, 0x4b, 0x03, 0x04, 0x14, 0]), 'XLSX (zip)'],
    ['dwg', bytes('AC1032\0\0\0'), 'DWG 2018'],
    ['dwg', bytes('AC1009'), 'DWG R12'],
    ['dxf', bytes('  0\r\nSECTION\r\n  2\r\nHEADER\r\n'), 'DXF de texto'],
    ['dxf', bytes('999\nhecho con un programa\n0\nSECTION\n2\nHEADER\n'), 'DXF con comentario 999'],
    ['dxf', bytes('AutoCAD Binary DXF\r\n\x1a\x00'), 'DXF binario'],
  ];
  it.each(good)('%s bueno: %s', (ext, data) => {
    expect(sniffType(data)).toBe(ext);
    expect(matchesExtension(data, ext as never)).toBe(true);
  });

  const fakes: [string, Uint8Array][] = [
    ['pdf', bytes('MZ\x90\x00 este es un .exe renombrado')],
    ['pdf', bytes(' %PDF-1.7')],
    ['png', bytes([0x89, 0x50, 0x4e, 0x47])],
    ['jpg', bytes([0xff, 0xd8])],
    ['dwg', bytes('AC20')],
    ['dxf', bytes('SECTION\n0\n')],
    ['dxf', bytes('0\nSECTIONS\n')],
    ['xlsx', bytes('PK\x05\x06')],
    ['pdf', new Uint8Array()],
  ];
  it.each(fakes)('%s falso', (ext, data) => {
    expect(matchesExtension(data, ext as never)).toBe(false);
  });

  it('un PNG no pasa por JPG ni un PDF por DWG', () => {
    expect(matchesExtension(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'jpg')).toBe(false);
    expect(matchesExtension(bytes('%PDF-1.4'), 'dwg')).toBe(false);
  });
});

describe('parseAttachmentRefs', () => {
  const ref = (n: number, ext = 'pdf') => ({ pathname: `cotizador/${UUID.slice(0, -1)}${n}-sufijo${n}.${ext}`, nombre: `archivo ${n}.${ext}` });

  it('sin archivos: nada', () => {
    expect(parseAttachmentRefs({})).toEqual({ refs: [], discarded: 0 });
    expect(parseAttachmentRefs({ archivos: null })).toEqual({ refs: [], discarded: 0 });
    expect(parseAttachmentRefs(null)).toEqual({ refs: [], discarded: 0 });
  });

  it(`hasta ${MAX_FILES}: el sexto se descarta`, () => {
    const { refs, discarded } = parseAttachmentRefs({ archivos: [1, 2, 3, 4, 5, 6].map((n) => ref(n)) });
    expect(refs).toHaveLength(MAX_FILES);
    expect(discarded).toBe(1);
    expect(refs[0]).toEqual({ pathname: ref(1).pathname, nombre: 'archivo 1.pdf', ext: 'pdf' });
  });

  it('descarta las mal formadas y las repetidas, nunca lanza', () => {
    const { refs, discarded } = parseAttachmentRefs({
      archivos: [
        ref(1, 'dwg'),
        ref(1, 'dwg'),
        { pathname: 'cotizador/../secreto.pdf', nombre: 'x.pdf' },
        { pathname: 'https://evil.example/x.pdf', nombre: 'x.pdf' },
        { pathname: ref(2).pathname },
        { pathname: ref(3).pathname, nombre: 7 },
        'texto',
        null,
        ref(4, 'xlsx'),
      ],
    });
    expect(refs.map((r) => r.ext)).toEqual(['dwg', 'xlsx']);
    expect(discarded).toBe(7);
  });

  it('archivos que no es una lista cuenta como una referencia descartada', () => {
    expect(parseAttachmentRefs({ archivos: 'cotizador/x.pdf' })).toEqual({ refs: [], discarded: 1 });
  });

  it('el nombre llega limpio', () => {
    const { refs } = parseAttachmentRefs({ archivos: [{ pathname: ref(1, 'dwg').pathname, nombre: 'C:\\planos\\<plano>.dwg' }] });
    expect(refs[0].nombre).toBe('plano.dwg');
  });
});

describe('formatBytes', () => {
  it.each([
    [85 * 1024, '85 KB'],
    [100, '1 KB'],
    [2.1 * 1024 * 1024, '2,1 MB'],
    [34 * 1024 * 1024, '34 MB'],
    [19.9 * 1024 * 1024, '19,9 MB'],
    [MAX_FILE_BYTES, '20 MB'],
  ])('%i bytes son %s', (n, text) => {
    expect(formatBytes(n)).toBe(text);
  });
});
