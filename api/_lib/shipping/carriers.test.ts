// api/_lib/shipping/carriers.test.ts
// Operadores del aviso de despacho (spec Nivel 2, §5.3). Que los nombres sean los de
// REGION_CARRIERS lo vigila scripts/shipping-carriers.test.ts (puede importar src/).

import { describe, expect, it } from 'vitest';
import {
  CARRIERS,
  carrierFileLabel,
  carrierFromLabel,
  numberCellLabel,
  numberPhrase,
  resolveCarrier,
  slugify,
  trackingLink,
} from './carriers';

/** Dominios verificados el 18-11-2026 (operadores-seguimiento-2026-11-18.md). */
const ALLOWED_DOMAINS = ['starken.cl', 'samex.cl', 'pullmancargo.cl', 'varmontt.cl', 'chilexpress.cl', 'transportesmena.cl', 'pdq.cl'];

describe('tabla de operadores', () => {
  it('ids y etiquetas únicos', () => {
    expect(new Set(CARRIERS.map((c) => c.id)).size).toBe(CARRIERS.length);
    expect(new Set(CARRIERS.map((c) => c.label.toLowerCase())).size).toBe(CARRIERS.length);
  });

  it('todo enlace es https y de un dominio verificado', () => {
    for (const c of CARRIERS) {
      if (!c.trackingUrl) continue;
      const url = new URL(c.trackingUrl.replace('{n}', '123'));
      expect(url.protocol, c.id).toBe('https:');
      expect(ALLOWED_DOMAINS.some((d) => url.hostname === d || url.hostname.endsWith(`.${d}`)), c.id).toBe(true);
      expect(url.username + url.password, c.id).toBe('');
    }
  });

  it('{n} aparece una vez si y solo si el operador acepta el número en la URL', () => {
    for (const c of CARRIERS) {
      const count = (c.trackingUrl ?? '').split('{n}').length - 1;
      expect(count, c.id).toBe(c.numberInUrl ? 1 : 0);
      if (!c.trackingUrl) expect(c.numberInUrl, c.id).toBe(false);
    }
  });

  it('PDQ nunca lleva el número (con ?q= mostró envíos ajenos)', () => {
    const pdq = resolveCarrier({ id: 'pdq' });
    expect(pdq.numberInUrl).toBe(false);
    expect(trackingLink(pdq, 'B065958')).toBe('https://www.pdq.cl/tracking');
  });

  it('Cruz del Sur y ECOEx van sin botón', () => {
    expect(trackingLink(resolveCarrier({ id: 'cruz-del-sur' }), '4726171')).toBeNull();
    expect(trackingLink(resolveCarrier({ id: 'ecoex' }), '01023453352')).toBeNull();
  });

  it('el documento del operador: Starken y Samex comprobante; Pullman orden de transporte; el resto orden de flete', () => {
    const doc = (id: Parameters<typeof resolveCarrier>[0]) => resolveCarrier(id).document.noun;
    expect(doc({ id: 'starken' })).toBe('comprobante');
    expect(doc({ id: 'samex' })).toBe('comprobante');
    expect(doc({ id: 'pullman-cargo' })).toBe('orden de transporte');
    for (const id of ['cruz-del-sur', 'ecoex', 'varmontt', 'pdq', 'chilexpress', 'transportes-mena'] as const) {
      expect(doc({ id }), id).toBe('orden de flete');
    }
  });

  it('solo Starken tiene regla de retiro y WhatsApp', () => {
    expect(CARRIERS.filter((c) => c.pickupRule).map((c) => c.id)).toEqual(['starken']);
    expect(CARRIERS.filter((c) => c.trackingExtra).map((c) => c.id)).toEqual(['starken']);
    expect(resolveCarrier({ id: 'starken' }).trackingExtra).toContain('+56 9 6194 1240');
  });
});

describe('enlace de seguimiento', () => {
  it('con el número en la URL, la orden normalizada va codificada', () => {
    expect(trackingLink(resolveCarrier({ id: 'starken' }), '123456789')).toBe('https://www.starken.cl/seguimiento?codigo=123456789');
    expect(trackingLink(resolveCarrier({ id: 'pullman-cargo' }), '23501234567')).toBe('https://pullmancargo.cl/seguimiento/23501234567');
    expect(trackingLink(resolveCarrier({ id: 'samex' }), '987654321')).toBe(
      'https://mysamex.samex.cl/gts/pub/locNumSeguimiento.seam?tipo=L&localizador=987654321',
    );
  });

  it('una orden sin normalizar no arma enlace (nunca entra texto libre en la URL)', () => {
    const starken = resolveCarrier({ id: 'starken' });
    expect(trackingLink(starken, '123"><script>')).toBeNull();
    expect(trackingLink(starken, 'javascript:alert(1)')).toBeNull();
    expect(trackingLink(starken, '')).toBeNull();
  });
});

describe('operador sin fila', () => {
  it('sale con su etiqueta, sin botón y con los textos genéricos', () => {
    const c = carrierFromLabel('  Rapid   Cargo ');
    expect(c.id).toBeNull();
    expect(c.label).toBe('Rapid Cargo');
    expect(c.slug).toBe('rapid-cargo');
    expect(trackingLink(c, '258615')).toBeNull();
    expect(c.numberLabel).toBe('orden de flete');
    expect(c.document.noun).toBe('comprobante');
    expect(c.pickupRule).toBeNull();
    expect(c.trackingExtra).toBeNull();
  });

  it('una etiqueta conocida, con otras mayúsculas o espacios, encuentra su fila', () => {
    expect(carrierFromLabel('ecoex').id).toBe('ecoex');
    expect(carrierFromLabel('pullman  cargo').id).toBe('pullman-cargo');
    expect(resolveCarrier({ id: null, label: 'STARKEN' }).id).toBe('starken');
  });
});

describe('textos del número', () => {
  it('«N°» una sola vez', () => {
    expect(numberPhrase(resolveCarrier({ id: 'starken' }), '123.456.789')).toBe('orden de flete N° 123.456.789');
    expect(numberPhrase(resolveCarrier({ id: 'pdq' }), '123456789012')).toBe('N° de guía 123456789012');
    expect(numberCellLabel(resolveCarrier({ id: 'samex' }))).toBe('OT');
    expect(numberCellLabel(resolveCarrier({ id: 'starken' }))).toBe('Orden de flete');
  });

  it('el operador en un nombre de archivo y en la clave', () => {
    expect(carrierFileLabel({ label: 'Pullman Cargo' })).toBe('Pullman-Cargo');
    expect(carrierFileLabel({ label: 'Transportes Ñandú' })).toBe('Transportes-Nandu');
    expect(slugify('Cruz del Sur')).toBe('cruz-del-sur');
  });
});
