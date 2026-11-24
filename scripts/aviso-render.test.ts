// scripts/aviso-render.test.ts
// `npm run aviso:render -- --fixture` (spec Nivel 2, §10): las muestras cubren Starken retiro,
// domicilio pagado, Pullman con guía de despacho, operador desconocido, sin productos, sin los
// campos opcionales (Transportes TVP: sin orden, entrega, agencia o comuna, flete ni kilos) y vista
// previa, y se escriben en la carpeta pedida (en el uso real, reports/aviso-despacho/, gitignored).

import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { fixtures, OUT_DIR, renderFixtures } from './aviso-render';

describe('aviso:render --fixture', () => {
  const root = mkdtempSync(join(tmpdir(), 'aviso-render-'));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('cubre las combinaciones pedidas', () => {
    const f = fixtures();
    expect(Object.keys(f)).toEqual(['starken-retiro', 'domicilio-pagado', 'pullman-guia', 'operador-desconocido', 'sin-productos', 'tvp-sin-datos', 'vista-previa']);
    expect(f['tvp-sin-datos']).toMatchObject({ order: null, delivery: null, place: null, freight: null, kilos: null });
    expect(f['starken-retiro']).toMatchObject({ carrier: { id: 'starken' }, delivery: 'pickup', freight: { kind: 'due' } });
    expect(f['domicilio-pagado']).toMatchObject({ delivery: 'home', freight: { kind: 'paid' } });
    expect(f['pullman-guia']).toMatchObject({ carrier: { id: 'pullman-cargo' }, document: { type: 'guia' } });
    expect(f['operador-desconocido'].carrier).toEqual({ id: null, label: 'Rapid Cargo' });
    expect(f['sin-productos'].products).toEqual([]);
    expect(f['vista-previa'].preview).toBe(true);
  });

  it('escribe el HTML y el texto de cada muestra', () => {
    const logs: string[] = [];
    const written = renderFixtures(root, (m) => logs.push(m));
    expect(written).toHaveLength(14);
    expect(readdirSync(join(root, OUT_DIR))).toHaveLength(14);
    const guia = readFileSync(join(root, OUT_DIR, 'pullman-guia.txt'), 'utf8');
    expect(guia).toMatch(/^Asunto: Tu pedido va en camino — Guía de despacho N° 291, Pullman Cargo orden de transporte 23501234567\n/);
    const tvp = readFileSync(join(root, OUT_DIR, 'tvp-sin-datos.txt'), 'utf8');
    expect(tvp).toMatch(/^Asunto: Tu pedido va en camino — Factura N° 1270, Transportes TVP\nTexto previo: Transportes TVP · Despachado el jueves 19 de noviembre\n/);
    expect(tvp).toContain('\nQué va en tu envío (5 bultos):\n');
    expect(tvp).not.toMatch(/Seguimiento|- Entrega:|- Flete:| kg/);
    expect(readFileSync(join(root, OUT_DIR, 'vista-previa.html'), 'utf8')).toContain('Vista previa:');
    expect(logs).toHaveLength(7);
  });
});
