// scripts/aviso-render.ts
// `npm run aviso:render -- --fixture`: arma el aviso de despacho con datos ficticios y escribe el
// HTML y el texto en reports/aviso-despacho/ (gitignored), para revisarlo a ojo sin Pipedrive
// (spec Nivel 2, §10). Nombres, comunas, órdenes y montos inventados; los productos se resuelven
// con products.ts desde SKU publicados del catálogo (si un SKU sale del catálogo, la línea pasa
// a su texto, sin enlace). Nunca usa datos de avisos reales: el repo es público.

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { productsFromField } from '../api/_lib/shipping/products';
import { buildShippingNotice, type ShippingNoticeData } from '../api/_lib/shipping/template';

export const OUT_DIR = 'reports/aviso-despacho';

/**
 * Productos de «Despacho · Productos»: SKU del catálogo y una línea sin SKU conocido, con su texto.
 * Si un SKU sale del catálogo, una fila de prueba sin enlace (la muestra no depende de los datos del día).
 */
function products(field: string): ShippingNoticeData['products'] {
  const { items, problems } = productsFromField(field);
  return problems.length ? [{ quantity: 1, name: 'Producto de prueba (un SKU de la muestra salió del catálogo)', siteId: null }] : items;
}

export function fixtures(): Record<string, ShippingNoticeData> {
  const base = {
    preview: false,
    greetingName: 'Ana',
    reference: 'RC-ab12cd',
    shipDate: '2026-11-19',
    hasVoucher: true,
  } as const;
  return {
    // Starken, retiro en agencia, por pagar, con fecha estimada y voucher.
    'starken-retiro': {
      ...base,
      carrier: { id: 'starken' },
      order: '123.456.789',
      delivery: 'pickup',
      place: 'La Serena',
      freight: { kind: 'due', amountClp: 14_460 },
      packages: 1,
      kilos: 3.2,
      eta: '2026-11-23',
      document: { type: 'factura', number: '1234' },
      products: products('10 APB40N\n2 CABLE-PRUEBA — Cable eléctrico 3x1,5 mm, rollo de 10 m'),
    },
    // A domicilio, flete pagado, sin fecha estimada ni voucher; página de seguimiento sin el número.
    'domicilio-pagado': {
      ...base,
      greetingName: 'Pedro',
      reference: 'NE-5k2x9',
      carrier: { id: 'chilexpress' },
      order: '998877665544',
      delivery: 'home',
      place: 'Viña del Mar',
      freight: { kind: 'paid' },
      packages: 2,
      kilos: 14.5,
      eta: null,
      document: { type: 'factura', number: '1240' },
      hasVoucher: false,
      products: products('4 PLRE6N\n1 APB407'),
    },
    // Pullman Cargo con guía de despacho, a domicilio, flete pagado.
    'pullman-guia': {
      ...base,
      greetingName: null,
      reference: null,
      carrier: { id: 'pullman-cargo' },
      order: '23501234567',
      delivery: 'home',
      place: 'Rancagua',
      freight: { kind: 'paid' },
      packages: 3,
      kilos: 33.7,
      eta: null,
      document: { type: 'guia', number: '291' },
      products: products('3 APB40F'),
    },
    // Operador sin fila en carriers.ts (opción nueva en Pipedrive): sin botón, textos genéricos.
    'operador-desconocido': {
      ...base,
      greetingName: 'Luis',
      carrier: { id: null, label: 'Rapid Cargo' },
      order: 'RC-4455',
      delivery: 'pickup',
      place: 'Temuco',
      freight: { kind: 'due', amountClp: 9_800 },
      packages: 2,
      kilos: 12,
      eta: '2026-11-24',
      document: { type: 'factura', number: '1251' },
      products: products('6 PLRE3C'),
    },
    // Sin lista de productos: el detalle va en la factura. Cruz del Sur (sin botón).
    'sin-productos': {
      ...base,
      greetingName: 'Carla',
      carrier: { id: 'cruz-del-sur' },
      order: '5550001',
      delivery: 'pickup',
      place: 'Puerto Montt',
      freight: { kind: 'paid' },
      packages: 4,
      kilos: 41,
      eta: null,
      document: { type: 'factura', number: '1262' },
      products: [],
    },
    // Vista previa (solo al dueño): PDQ a domicilio, por pagar, guía de despacho.
    'vista-previa': {
      ...base,
      preview: true,
      carrier: { id: 'pdq' },
      order: '7712',
      delivery: 'home',
      place: 'Providencia',
      freight: { kind: 'due', amountClp: 5_880 },
      packages: 1,
      kilos: 2,
      eta: '2026-11-20',
      document: { type: 'guia', number: '305' },
      products: products('2 PLRE9F'),
    },
  };
}

export function renderFixtures(root: string, log: (m: string) => void = console.log): string[] {
  const dir = resolve(root, OUT_DIR);
  mkdirSync(dir, { recursive: true });
  const written: string[] = [];
  for (const [name, data] of Object.entries(fixtures())) {
    const notice = buildShippingNotice(data);
    writeFileSync(resolve(dir, `${name}.html`), notice.html);
    writeFileSync(resolve(dir, `${name}.txt`), `Asunto: ${notice.subject}\nTexto previo: ${notice.preheader}\n\n${notice.text}`);
    written.push(`${OUT_DIR}/${name}.html`, `${OUT_DIR}/${name}.txt`);
    log(`${OUT_DIR}/${name}.html · ${notice.subject}`);
  }
  return written;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  if (!process.argv.includes('--fixture')) {
    console.log('Uso: npm run aviso:render -- --fixture (datos ficticios; escribe en reports/aviso-despacho/).');
    process.exit(1);
  }
  renderFixtures(process.cwd());
}
