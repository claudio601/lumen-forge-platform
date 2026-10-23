// api/_lib/attachments/transfer.test.ts
// Textos del traspaso de adjuntos (lista de la nota principal y segunda nota) y el tiempo de
// la función: CREATE_MAX_DURATION_S debe ser el maxDuration de create.ts en vercel.json. El
// traspaso completo (Blob → Pipedrive) se prueba en api/_tests/project-quotes.create.test.ts.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CREATE_MAX_DURATION_S, attachmentListLines, failureText, transferDeadline, transferReport, type TransferOutcome } from './transfer';

const vercel = JSON.parse(readFileSync(new URL('../../../vercel.json', import.meta.url), 'utf-8')) as {
  functions?: Record<string, { maxDuration?: number }>;
};

const item = (nombre: string, size?: number) => ({
  pathname: 'cotizador/x.pdf',
  nombre,
  ext: 'pdf' as const,
  blob: size === undefined ? undefined : { url: 'u', size, uploadedAt: new Date(), contentType: 'application/pdf' },
});

describe('transfer', () => {
  it('maxDuration de create.ts en vercel.json = CREATE_MAX_DURATION_S (60 s sin Fluid compute)', () => {
    expect(vercel.functions?.['api/project-quotes/create.ts']?.maxDuration).toBe(CREATE_MAX_DURATION_S);
    expect(CREATE_MAX_DURATION_S).toBe(60);
    expect(transferDeadline(0)).toBe(50_000); // 10 s para la nota y el correo de fallas
  });

  it('lista de la nota principal: nombre y peso (si Blob respondió) y las referencias descartadas', () => {
    expect(attachmentListLines([item('bases.pdf', 2.1 * 1024 * 1024), item('ficha.pdf')], 1)).toEqual([
      'Archivos que envió el cliente (2): bases.pdf (2,1 MB), ficha.pdf. Quedan en la pestaña Archivos del negocio.',
      'Se descartó 1 referencia de archivo no válida.',
    ]);
    expect(attachmentListLines([], 3)).toEqual(['Se descartaron 3 referencias de archivo no válidas.']);
    expect(attachmentListLines([])).toEqual([]);
  });

  it('segunda nota: nada si todo quedó en Archivos', () => {
    expect(transferReport([{ nombre: 'a.pdf', ext: 'pdf', status: 'attached' }])).toBeNull();
    expect(transferReport([])).toBeNull();
  });

  it('segunda nota con una falla: el texto de la especificación', () => {
    const outcomes: TransferOutcome[] = [
      { nombre: 'bases.pdf', ext: 'pdf', status: 'attached' },
      { nombre: 'plano.dwg', ext: 'dwg', status: 'failed', code: 'bad_content' },
      { nombre: 'ficha.pdf', ext: 'pdf', status: 'attached' },
    ];
    expect(transferReport(outcomes)).toEqual({
      lines: [
        'Adjuntos: 2 de 3 quedaron en Archivos.',
        'No se pudo adjuntar "plano.dwg" (no es un DWG válido). Pedirlo al cliente por correo.',
      ],
      needsFollowUp: true,
    });
  });

  it('varias fallas, un pendiente y uno ya adjuntado', () => {
    const report = transferReport([
      { nombre: 'a.pdf', ext: 'pdf', status: 'failed', code: 'too_big' },
      { nombre: 'b.xlsx', ext: 'xlsx', status: 'failed', code: 'pipedrive' },
      { nombre: 'c.dwg', ext: 'dwg', status: 'pending' },
      { nombre: 'd.pdf', ext: 'pdf', status: 'missing' },
    ]);
    expect(report?.lines).toEqual([
      'Adjuntos: 0 de 4 quedaron en Archivos.',
      'No se pudo adjuntar "a.pdf" (pesa más de 20 MB).',
      'No se pudo adjuntar "b.xlsx" (Pipedrive no lo aceptó).',
      'Pedirlos al cliente por correo.',
      '"c.dwg" quedó pendiente (no alcanzó el tiempo de la solicitud): el barrido diario lo reintenta. Si mañana no aparece en Archivos, pedirlo al cliente por correo.',
      '"d.pdf": ya adjuntado en el envío anterior o vencido.',
    ]);
    expect(report?.needsFollowUp).toBe(true);
  });

  it('solo «ya adjuntado»: nota, pero sin correo de seguimiento', () => {
    expect(transferReport([{ nombre: 'd.pdf', ext: 'pdf', status: 'missing' }])?.needsFollowUp).toBe(false);
  });

  it('cada motivo tiene su texto', () => {
    expect(failureText('bad_content', 'xlsx')).toBe('no es un XLSX válido');
    expect(failureText('too_old', 'pdf')).toBe('venció: se subió hace más de 2 horas');
    expect(failureText('pipedrive_size', 'pdf')).toBe('Pipedrive lo rechazó por su tamaño');
    expect(failureText('read_failed', 'pdf')).toBe('no se pudo leer del almacenamiento temporal');
  });
});
