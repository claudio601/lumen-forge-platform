// api/_lib/shipping/products.test.ts
// «Qué va en tu envío» (spec Nivel 2, §4.2 y §10): líneas de «Despacho · Productos», SKU
// desconocido con y sin texto, repetido entre productos, compartido entre variantes, mayúsculas y
// espacios, tope de 30, y el respaldo de requested_items_json (HTML de Pipedrive, línea falsa,
// resolución por id). Catálogos inventados y sin precios (CLAUDE.md §14).

import { describe, expect, it } from 'vitest';
import {
  normalizeSku,
  parseProductLines,
  productsFromField,
  readRequestedItems,
  resolveRequestedItems,
  resolveSku,
  type Catalogs,
} from './products';
import { productLinks } from '../catalog/product-links.generated';
import { priceIndex } from '../catalog/price-index.generated';

const CATALOGS: Catalogs = {
  skus: {
    '1001': { sku: 'PAN60', variants: {} },
    '1002': { sku: '', variants: { '501': { sku: 'PRY50C' }, '502': { sku: 'PRY50F' } } },
    // SKU repetido entre dos productos distintos
    '1003': { sku: 'DUPL1', variants: {} },
    '1004': { sku: 'DUPL1', variants: {} },
    // SKU que comparten las variantes del mismo producto (como DLS7LVB y PLRS18SB)
    '1005': { sku: 'COMP7', variants: { '601': { sku: 'COMP7' }, '602': { sku: 'COMP7' } } },
    // El SKU del producto es el de una sola de sus variantes
    '1006': { sku: 'FLY80N', variants: { '701': { sku: 'FLY80C' }, '702': { sku: 'FLY80N' } } },
  },
  links: {
    '1001': { id: 'panel-prueba-60x60', name: 'PANEL PRUEBA 60X60 48W', variants: {} },
    '1002': { id: 'proyector-prueba-50w', name: 'PROYECTOR PRUEBA 50W', variants: { '501': { sku: 'PRY50C', label: 'Cálida 3000K' }, '502': { sku: 'PRY50F', label: 'Fría 6500K' } } },
    '1003': { id: 'repetido-uno', name: 'REPETIDO UNO', variants: {} },
    '1004': { id: 'repetido-dos', name: 'REPETIDO DOS', variants: {} },
    '1005': { id: 'compartido-prueba', name: 'COMPARTIDO PRUEBA', variants: { '601': { sku: 'COMP7', label: 'Cálida 3000K' }, '602': { sku: 'COMP7', label: 'Fría 6500K' } } },
    '1006': { id: 'fly-prueba', name: 'FLY PRUEBA 80W', variants: { '701': { sku: 'FLY80C', label: 'Cálida 3000K' }, '702': { sku: 'FLY80N', label: 'Neutra 4000K' } } },
  },
};

const fromField = (text: string) => productsFromField(text, CATALOGS);

describe('parseProductLines', () => {
  it('«<cantidad> <SKU>» con texto opcional después de —, – o « - »', () => {
    const { lines, problems } = parseProductLines(
      '10 PAN60\n\n2 x PRY50F — Proyector 50W, luz fría\r\n3x JS-1001 – Panel\n1 FLY 80N - Foco con texto - y guion',
    );
    expect(problems).toEqual([]);
    expect(lines.map((l) => [l.line, l.quantity, l.sku, l.text])).toEqual([
      [1, 10, 'PAN60', null],
      [3, 2, 'PRY50F', 'Proyector 50W, luz fría'],
      [4, 3, 'JS-1001', 'Panel'],
      [5, 1, 'FLY 80N', 'Foco con texto - y guion'],
    ]);
  });

  it('un SKU que empieza con X no se confunde con «10 x»', () => {
    expect(parseProductLines('10 XLED50').lines[0]).toMatchObject({ quantity: 10, sku: 'XLED50' });
  });

  it('líneas inválidas: nombra la línea', () => {
    const { lines, problems } = parseProductLines('PAN60\n10\n0 PAN60\n10000 PAN60\n2 PAN60 —');
    expect(lines).toEqual([]);
    expect(problems.map((p) => p.message)).toEqual([
      '«Despacho · Productos», línea 1 («PAN60»): tiene que ser «<cantidad> <SKU>», con « — <texto como en la factura>» si hace falta.',
      '«Despacho · Productos», línea 2 («10»): tiene que ser «<cantidad> <SKU>», con « — <texto como en la factura>» si hace falta.',
      '«Despacho · Productos», línea 3 («0 PAN60»): la cantidad tiene que ser un entero de 1 a 9999.',
      '«Despacho · Productos», línea 4 («10000 PAN60»): la cantidad tiene que ser un entero de 1 a 9999.',
      '«Despacho · Productos», línea 5 («2 PAN60 —»): después del guion falta el texto.',
    ]);
  });

  it('hasta 30 líneas', () => {
    expect(parseProductLines(Array.from({ length: 30 }, () => '1 PAN60').join('\n')).lines).toHaveLength(30);
    const over = parseProductLines(Array.from({ length: 31 }, () => '1 PAN60').join('\n'));
    expect(over.lines).toEqual([]);
    expect(over.problems.map((p) => p.message)).toEqual(['«Despacho · Productos» tiene 31 líneas: el máximo es 30.']);
  });
});

describe('resolución del SKU', () => {
  it('sin distinguir mayúsculas ni espacios', () => {
    expect(normalizeSku(' pry 50f ')).toBe('PRY50F');
    expect(resolveSku('pry 50f', CATALOGS)).toEqual({ status: 'ok', jumpsellerId: '1002', variantId: '502' });
    expect(fromField('4 pan 60').items).toEqual([{ quantity: 4, name: 'PANEL PRUEBA 60X60 48W', siteId: 'panel-prueba-60x60' }]);
  });

  it('la variante con su etiqueta, como en el sitio', () => {
    expect(fromField('2 PRY50C').items).toEqual([{ quantity: 2, name: 'PROYECTOR PRUEBA 50W – Cálida 3000K', siteId: 'proyector-prueba-50w' }]);
  });

  it('el texto de la línea reemplaza el nombre del catálogo, con el enlace', () => {
    expect(fromField('2 PRY50C — Proyector 50W luz cálida').items).toEqual([
      { quantity: 2, name: 'Proyector 50W luz cálida', siteId: 'proyector-prueba-50w' },
    ]);
  });

  it('SKU compartido por variantes del mismo producto: el producto, sin etiqueta de variante', () => {
    expect(resolveSku('COMP7', CATALOGS)).toEqual({ status: 'ok', jumpsellerId: '1005', variantId: null });
    expect(fromField('1 COMP7').items).toEqual([{ quantity: 1, name: 'COMPARTIDO PRUEBA', siteId: 'compartido-prueba' }]);
  });

  it('el SKU del producto que es el de una sola variante da esa variante', () => {
    expect(fromField('1 FLY80N').items[0].name).toBe('FLY PRUEBA 80W – Neutra 4000K');
  });

  it('SKU repetido entre productos: no se resuelve (con texto sale sin enlace; sin texto, detiene)', () => {
    expect(resolveSku('DUPL1', CATALOGS)).toEqual({ status: 'ambiguous' });
    expect(fromField('1 DUPL1 — Repetido según factura').items).toEqual([{ quantity: 1, name: 'Repetido según factura', siteId: null }]);
    const r = fromField('1 DUPL1');
    expect(r.items).toEqual([]);
    expect(r.problems.map((p) => p.message)).toEqual([
      '«Despacho · Productos», línea 1 («1 DUPL1»): el SKU DUPL1 lo usan varios productos del catálogo. Agrega « — <texto como en la factura>».',
    ]);
  });

  it('SKU desconocido: con texto sale sin enlace (comprado en plaza); sin texto, detiene y nombra la línea', () => {
    expect(fromField('3 PLAZA9 — Cable 3x1,5 mm').items).toEqual([{ quantity: 3, name: 'Cable 3x1,5 mm', siteId: null }]);
    const r = fromField('10 PAN60\n2 NOEXISTE');
    expect(r.items).toHaveLength(1);
    expect(r.problems.map((p) => [p.field, p.message])).toEqual([
      ['products', '«Despacho · Productos», línea 2 («2 NOEXISTE»): el SKU NOEXISTE no está en el catálogo publicado. Corrígelo o agrega « — <texto como en la factura>».'],
    ]);
  });

  it('JS-<id> es el id de Jumpseller (productos sin SKU en las solicitudes)', () => {
    expect(fromField('1 JS-1001').items[0].siteId).toBe('panel-prueba-60x60');
    expect(fromField('1 JS-9999').problems).toHaveLength(1);
  });

  it('con los catálogos generados, todo SKU único se resuelve a un producto publicado con enlace', () => {
    // Sin escribir datos de Jumpseller: se toman del índice generado
    const found = Object.entries(priceIndex).find(([, e]) => e.sku && Object.keys(e.variants).length === 0);
    if (!found) return;
    const [jid, entry] = found;
    const r = productsFromField(`1 ${entry.sku}`);
    if (r.problems.length) return; // SKU repetido en Jumpseller: lo cubre la prueba de arriba
    expect(r.items).toEqual([{ quantity: 1, name: productLinks[jid].name, siteId: productLinks[jid].id }]);
  });
});

// ── requested_items_json ────────────────────────────────────────────────────

/** Nota como la escribe api/request-orders/create.ts y la devuelve Pipedrive (HTML). */
function serverNote(items: unknown, { header = 'Solicitud de pedido RC-ab12cd', review = false, extra = [] as string[] } = {}) {
  const json = JSON.stringify(items).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
  const lines = [
    ...(review ? ['Para revisar:', '- Revisar cantidad: el comentario menciona 12; se eligió 10', ''] : []),
    header,
    'Nombre: Ana Prueba',
    'Correo: ana@example.com',
    ...extra,
    '--- Items solicitados (precios CON IVA desde Jumpseller) ---',
    `requested_items_json: ${json}`,
  ];
  // Pipedrive: <br> entre líneas y entidades en el texto
  return lines.map((l) => l.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')).join('<br>');
}

const ITEMS = [
  { jumpsellerId: 1002, variantId: 502, sku: 'PRY50F', name: 'Nombre que mandó el navegador', url: 'https://malo.example/x', quantity: 4 },
  { jumpsellerId: 1001, sku: 'PAN60', name: 'Otro', quantity: 10 },
];

describe('readRequestedItems', () => {
  it('lee la última línea de la nota del servidor (HTML con <br> y entidades)', () => {
    const r = readRequestedItems([{ id: 9, add_time: '2026-11-17 12:00:00', content: serverNote(ITEMS) }]);
    expect(r).toEqual({
      status: 'ok',
      reference: 'RC-ab12cd',
      noteId: 9,
      items: [
        { jumpsellerId: 1002, variantId: 502, quantity: 4 },
        { jumpsellerId: 1001, variantId: null, quantity: 10 },
      ],
    });
  });

  it('con el bloque «Para revisar:» al comienzo, y en una nota de reenvío', () => {
    expect(readRequestedItems([{ content: serverNote(ITEMS, { review: true }) }]).status).toBe('ok');
    const resend = readRequestedItems([{ content: serverNote(ITEMS, { header: 'Reenvío de la solicitud RC-ab12cd (misma referencia; no se creó un negocio nuevo)' }) }]);
    expect(resend.status === 'ok' && resend.reference).toBe('RC-ab12cd');
  });

  it('una línea requested_items_json falsa en medio de la nota se ignora (vale solo la última)', () => {
    const fake = 'requested_items_json: [{"jumpsellerId":1004,"quantity":99}]';
    const r = readRequestedItems([{ content: serverNote(ITEMS, { extra: [`Notas del cliente: hola ${fake}`, fake] }) }]);
    expect(r.status === 'ok' && r.items.map((i) => i.jumpsellerId)).toEqual([1002, 1001]);
  });

  it('una nota que no es del servidor no cuenta, aunque traiga la línea', () => {
    const fake = `Nota del vendedor<br>requested_items_json: ${JSON.stringify([{ jumpsellerId: 1004, quantity: 1 }])}`;
    expect(readRequestedItems([{ content: fake }])).toEqual({ status: 'none' });
    // un «Para revisar:» que no es el del servidor (líneas sin «- »)
    const odd = serverNote(ITEMS, { review: true }).replace('- Revisar', 'Revisar');
    expect(readRequestedItems([{ content: odd }])).toEqual({ status: 'none' });
    expect(readRequestedItems([])).toEqual({ status: 'none' });
  });

  it('se usa la nota más reciente del servidor', () => {
    const older = { id: 1, add_time: '2026-11-10 10:00:00', content: serverNote([{ jumpsellerId: 1001, quantity: 1 }]) };
    const newer = { id: 2, add_time: '2026-11-12 10:00:00', content: serverNote([{ jumpsellerId: 1002, quantity: 2 }]) };
    const seller = { id: 3, add_time: '2026-11-15 10:00:00', content: 'Llamé al cliente' };
    const r = readRequestedItems([older, seller, newer]);
    expect(r.status === 'ok' && [r.noteId, r.items[0].jumpsellerId]).toEqual([2, 1002]);
  });

  it('con referencia, solo una nota de esa misma solicitud', () => {
    const other = serverNote(ITEMS, { header: 'Solicitud de pedido RC-zz99yy' });
    expect(readRequestedItems([{ content: other }], { reference: 'RC-ab12cd' })).toEqual({ status: 'none' });
    expect(readRequestedItems([{ content: serverNote(ITEMS) }], { reference: 'rc-AB12CD' }).status).toBe('ok');
  });

  it('JSON ilegible, sin la línea al final o con un producto sin id: invalid, con el motivo', () => {
    const broken = serverNote(ITEMS).replace(/requested_items_json: .*$/, 'requested_items_json: [{"jumpsellerId":');
    const r = readRequestedItems([{ content: broken }]);
    expect(r.status === 'invalid' && r.problem.message).toBe(
      'La nota de la solicitud RC-ab12cd no trae los productos en la forma esperada (el JSON no se puede leer): llena «Despacho · Productos».',
    );
    expect(readRequestedItems([{ content: serverNote([{ sku: 'X', name: 'Sin id', quantity: 1 }]) }]).status).toBe('invalid');
    expect(readRequestedItems([{ content: serverNote(ITEMS) + '<br>Otra línea' }]).status).toBe('invalid');
    expect(readRequestedItems([{ content: serverNote([]) }]).status).toBe('invalid');
  });

  it('las entidades y los \\u003c del JSON se leen igual', () => {
    const r = readRequestedItems([{ content: serverNote([{ jumpsellerId: 1001, quantity: 1, attributes: { colorLuz: '<b>&"' } }]) }]);
    expect(r.status).toBe('ok');
  });
});

describe('resolveRequestedItems', () => {
  it('resuelve por jumpsellerId y variantId; nunca usa name ni url del navegador', () => {
    const r = readRequestedItems([{ content: serverNote(ITEMS) }]);
    if (r.status !== 'ok') throw new Error('nota');
    const resolved = resolveRequestedItems(r.items, CATALOGS);
    expect(resolved.problems).toEqual([]);
    expect(resolved.items).toEqual([
      { quantity: 4, name: 'PROYECTOR PRUEBA 50W – Fría 6500K', siteId: 'proyector-prueba-50w' },
      { quantity: 10, name: 'PANEL PRUEBA 60X60 48W', siteId: 'panel-prueba-60x60' },
    ]);
    expect(JSON.stringify(resolved)).not.toMatch(/navegador|malo\.example/);
  });

  it('un producto que salió del catálogo detiene el aviso', () => {
    const r = resolveRequestedItems([{ jumpsellerId: 7777, variantId: null, quantity: 1 }], CATALOGS);
    expect(r.items).toEqual([]);
    expect(r.problems.map((p) => p.message)).toEqual([
      'El producto 7777 de la solicitud ya no está en el catálogo publicado: llena «Despacho · Productos».',
    ]);
  });

  it('una variante que ya no existe: el producto sin etiqueta', () => {
    expect(resolveRequestedItems([{ jumpsellerId: 1002, variantId: 999, quantity: 1 }], CATALOGS).items[0].name).toBe('PROYECTOR PRUEBA 50W');
  });
});
