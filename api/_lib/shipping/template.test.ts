// api/_lib/shipping/template.test.ts
// Plantilla del aviso de despacho (spec Nivel 2, §5 y §10): escape, enlaces solo de carriers.ts y
// SITE_URL, las combinaciones (agencia/domicilio, por pagar/pagado, con o sin fecha estimada y
// PDF del documento, Starken/otro/desconocido, factura/guía, sin productos), los campos opcionales
// (sin orden, entrega, agencia o comuna, flete ni kilos: dueño, 24-11-2026), el texto y el HTML con los
// mismos datos, las reglas del correo (600 px, sin var(--, flex ni <style>) y las del sitio (sin
// «gratis», stock, «24–48 h», nuevo.elights.cl, «bodega» ni frases retiradas). Datos inventados.

import { describe, expect, it } from 'vitest';
import { PICKUP_PLACE, whatsappDisplayNumber } from '../../../src/config/business';
import { LEGAL_RUT } from '../../../src/config/site';
import { retiredIn } from '../../../src/test/retired';
import { SITE_URL } from '../site';
import { CARRIERS, type CarrierRef } from './carriers';
import { assertSafeLinks, buildShippingNotice, COMPANY_PHONE, COMPANY_RUT, productUrl, type ShippingNoticeData } from './template';

const base: ShippingNoticeData = {
  preview: false,
  greetingName: 'Ana',
  reference: 'RC-ab12cd',
  carrier: { id: 'starken' },
  order: '123.456.789',
  delivery: 'pickup',
  place: 'La Serena',
  freight: { kind: 'due', amountClp: 14_460 },
  packages: 1,
  kilos: 3.2,
  shipDate: '2026-11-19',
  eta: '2026-11-23',
  document: { type: 'factura', number: '1234' },
  products: [
    { quantity: 10, name: 'Panel LED de prueba 48W, luz neutra 4000K', siteId: 'panel-led-prueba-48w' },
    { quantity: 2, name: 'Cable de prueba 3x1,5 mm', siteId: null },
  ],
  hasDocument: true,
};

const build = (over: Partial<ShippingNoticeData> = {}) => buildShippingNotice({ ...base, ...over });

/** Texto visible del HTML: sin etiquetas, comentarios ni entidades. */
function visible(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<br>/g, '\n')
    .replace(/<\/?(?:b|a)\b[^>]*>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#8204;/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
}

const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));

const CARRIER_CASES: CarrierRef[] = [{ id: 'starken' }, { id: 'pullman-cargo' }, { id: 'varmontt' }, { id: 'cruz-del-sur' }, { id: null, label: 'Rapid Cargo' }];

/** Todas las combinaciones de §10 (5 operadores × 2 entregas × 2 fletes × fecha × PDF × documento × productos). */
function* combinations(): Generator<ShippingNoticeData> {
  for (const carrier of CARRIER_CASES)
    for (const delivery of ['pickup', 'home'] as const)
      for (const freight of [{ kind: 'due', amountClp: 9_870 }, { kind: 'paid' }] as const)
        for (const eta of ['2026-11-24', null])
          for (const hasDocument of [true, false])
            for (const document of [{ type: 'factura', number: '1234' }, { type: 'guia', number: '291' }] as const)
              for (const products of [base.products, []])
                yield { ...base, carrier, delivery, freight, eta, hasDocument, document, products, packages: products.length ? 1 : 3 };
}

describe('reglas de todo aviso (todas las combinaciones)', () => {
  const all = [...combinations()].map((data) => ({ data, notice: buildShippingNotice(data) }));

  it('arma las 320 combinaciones', () => {
    expect(all).toHaveLength(320);
  });

  it('sin «gratis», stock, «24–48 h», nuevo.elights.cl, «bodega», la dirección de retiro ni «hoy»', () => {
    for (const { notice } of all) {
      for (const out of [notice.subject, notice.preheader, notice.html, notice.text]) {
        expect(out).not.toMatch(/gratis|gratuit/i);
        expect(out).not.toMatch(/stock/i);
        expect(out).not.toMatch(/24\s*[–-]\s*48|48\s*h/i);
        expect(out).not.toMatch(/nuevo\.elights\.cl/i);
        expect(out).not.toMatch(/\bbodega\b/i);
        expect(out).not.toMatch(/quinta normal/i);
        expect(out).not.toContain(PICKUP_PLACE);
        expect(out).not.toMatch(/\bhoy\b/i);
      }
    }
  });

  it('ninguna frase retirada del sitio (src/test/retired.ts)', () => {
    for (const { notice } of all) {
      expect(retiredIn(visible(notice.html), true)).toEqual([]);
      expect(retiredIn(notice.text, true)).toEqual([]);
      expect(retiredIn(notice.subject, true)).toEqual([]);
    }
  });

  it('HTML de correo: 600 px, tablas y estilos en línea, sin var(--, flex, grid ni <style>', () => {
    for (const { notice } of all) {
      expect(notice.html).toContain('width="600"');
      expect(notice.html).toContain('max-width:600px');
      expect(notice.html).toContain('role="presentation"');
      expect(notice.html).not.toContain('var(--');
      expect(notice.html).not.toMatch(/display\s*:\s*(?:flex|grid)/i);
      expect(notice.html).not.toMatch(/<style|<script|<img|<link/i);
      expect(notice.html).toMatch(/^<!doctype html>\n<html lang="es">/);
    }
  });

  it('enlaces: solo https al seguimiento de carriers.ts y a SITE_URL/producto/', () => {
    const allowed = new Set([new URL(SITE_URL).origin, ...CARRIERS.flatMap((c) => (c.trackingUrl ? [new URL(c.trackingUrl.replace('{n}', '0')).origin] : []))]);
    for (const { notice } of all) {
      for (const href of hrefs(notice.html)) {
        const url = new URL(href);
        expect(url.protocol).toBe('https:');
        expect(allowed.has(url.origin)).toBe(true);
        if (url.origin === new URL(SITE_URL).origin) expect(url.pathname).toMatch(/^\/producto\/[a-z0-9-]+$/);
      }
    }
  });

  it('el texto y el HTML llevan los mismos datos', () => {
    for (const { data, notice } of all) {
      const html = visible(notice.html);
      const label = 'label' in data.carrier ? data.carrier.label : CARRIERS.find((c) => c.id === data.carrier.id)!.label;
      const facts = [
        label,
        data.order,
        data.place,
        'jueves 19 de noviembre',
        // sin el PDF y con lista de productos, el correo no nombra el documento (se envió antes)
        ...(data.hasDocument || !data.products.length ? [data.document.number, data.document.type === 'guia' ? 'guía de despacho N° 291' : 'factura N° 1234'] : []),
        data.packages === 1 ? '1 bulto' : '3 bultos',
        '3,2 kg',
        ...(data.eta ? ['martes 24 de noviembre'] : []),
        ...(data.freight.kind === 'due' ? ['$9.870'] : ['pagado']),
        ...data.products.map((p) => p.name),
        ` de ${label}.`,
        ...(data.delivery === 'pickup' ? ['cédula de identidad'] : []),
        'escríbenos el mismo día con fotos',
        COMPANY_PHONE,
        COMPANY_RUT,
      ];
      for (const fact of facts) {
        expect(notice.text, fact).toContain(fact);
        expect(html, fact).toContain(fact);
      }
      for (const href of hrefs(notice.html)) {
        // la ficha técnica y el seguimiento también van en el texto (salvo el botón de Starken,
        // cuyo enlace con el número va en «Seguimiento:»)
        expect(notice.text).toContain(href);
      }
      if (!data.eta) expect(`${notice.text}${html}`).not.toContain('Entrega estimada');
      const doc = data.document.type === 'guia' ? 'guía de despacho N° 291' : 'factura N° 1234';
      // Sin el PDF (la factura se envía antes del despacho): solo la foto del comprobante, y el detalle «va en» el documento, sin «adjunta».
      if (!data.hasDocument) {
        expect(notice.text).not.toContain(`${doc} en PDF`);
        expect(`${notice.text}${html}`).not.toContain(`${doc} adjunta`);
      }
    }
  });

  it('firma estándar y pie', () => {
    for (const { notice } of all) {
      expect(notice.text).toContain('Quedo atento.\n\nSaludos cordiales,\nClaudio Quero\neLIGHTS.cl SpA\nclaudio@elights.cl\n');
      expect(notice.html).toContain('Quedo atento.<br><br>Saludos cordiales,<br>Claudio Quero<br>eLIGHTS.cl SpA<br>claudio@elights.cl');
      expect(visible(notice.html)).toContain(`¿Dudas con tu pedido? Responde este correo o llámanos al ${COMPANY_PHONE}.`);
    }
  });

  it('nunca sale el aviso de vista previa fuera de la vista previa', () => {
    for (const { notice } of all) {
      expect(notice.subject).toMatch(/^Tu pedido va en camino — /);
      expect(`${notice.html}${notice.text}`).not.toMatch(/vista previa/i);
    }
  });
});

describe('teléfono y RUT', () => {
  it('son los de src/config (api/ no importa src/)', () => {
    expect(COMPANY_PHONE).toBe(whatsappDisplayNumber);
    expect(COMPANY_RUT).toBe(LEGAL_RUT);
  });
});

describe('asunto, encabezado y documentos', () => {
  it('factura con Starken', () => {
    const n = build();
    expect(n.subject).toBe('Tu pedido va en camino — Factura N° 1234, Starken orden de flete 123.456.789');
    expect(n.preheader).toBe('Starken, orden de flete N° 123.456.789 · Entrega estimada: lunes 23 de noviembre');
    expect(n.html).toContain('Factura N° 1234<br>Pedido RC-ab12cd<br>Despachado el jueves 19 de noviembre');
    expect(n.text).toContain('Te adjuntamos la factura N° 1234 en PDF y el comprobante de Starken.');
  });

  it('guía de despacho con Pullman Cargo (requisito del 18-11)', () => {
    const n = build({ carrier: { id: 'pullman-cargo' }, order: '23501234567', document: { type: 'guia', number: '291' }, products: [] });
    expect(n.subject).toBe('Tu pedido va en camino — Guía de despacho N° 291, Pullman Cargo orden de transporte 23501234567');
    expect(n.html).toContain('Guía de despacho N° 291<br>');
    expect(n.html).toContain('<title>Aviso de despacho · Guía de despacho N° 291</title>');
    expect(n.text).toContain('Te adjuntamos la guía de despacho N° 291 en PDF y la orden de transporte de Pullman Cargo.');
    expect(n.text).toContain('el detalle de los productos va en la guía de despacho N° 291 adjunta.');
    expect(visible(n.html)).toContain('El detalle de los productos va en la guía de despacho N° 291 adjunta.');
    expect(`${n.subject}${n.html}${n.text}`).not.toMatch(/factura/i);
  });

  it('sin el PDF (la factura se envía antes del despacho), solo la foto del comprobante', () => {
    const n = build({ hasDocument: false, products: [] });
    expect(n.text).toContain('\nTe adjuntamos el comprobante de Starken.\n');
    expect(n.text).toContain('el detalle de los productos va en la factura N° 1234.');
    expect(visible(n.html)).toContain('El detalle de los productos va en la factura N° 1234.');
    expect(`${n.text}${n.html}`).not.toMatch(/en PDF|adjunta\b/);
  });

  it('la referencia solo si calza con el formato del servidor (nunca WA-, que lleva el teléfono)', () => {
    expect(build({ reference: 'NE-5k2x9' }).html).toContain('Cotización NE-5k2x9');
    const wa = build({ reference: 'WA-56912345678' });
    expect(wa.html).not.toContain('WA-');
    expect(build({ reference: null }).html).toContain('Factura N° 1234<br>Despachado el');
  });

  it('un salto de línea en un campo no arma líneas nuevas en el asunto ni en el texto', () => {
    const n = build({ order: '123\n456', place: 'La\r\nSerena', greetingName: 'Ana\nBcc: x@y.cl' });
    expect(n.subject).toBe('Tu pedido va en camino — Factura N° 1234, Starken orden de flete 123 456');
    expect(n.text).toContain('Hola Ana Bcc: x@y.cl,');
    expect(n.text).toContain('retiro en la agencia Starken de La Serena.');
  });
});

describe('seguimiento por operador', () => {
  it('Starken: botón con la orden en la URL, «Ingresa…», la app y el WhatsApp', () => {
    const n = build();
    expect(hrefs(n.html)).toContain('https://www.starken.cl/seguimiento?codigo=123456789');
    expect(n.html).toContain('Seguir mi envío en Starken');
    expect(visible(n.html)).toContain('Ingresa la orden de flete 123.456.789. También puedes seguirlo en la app de Starken o por su WhatsApp +56 9 6194 1240.');
    expect(n.text).toContain(
      '- Seguimiento: orden de flete N° 123.456.789, en https://www.starken.cl/seguimiento?codigo=123456789, en la app de Starken o por su WhatsApp +56 9 6194 1240.',
    );
  });

  it('Samex y Pullman: la orden en la URL', () => {
    expect(hrefs(build({ carrier: { id: 'samex' }, order: 'OT 77-12' }).html)).toContain(
      'https://mysamex.samex.cl/gts/pub/locNumSeguimiento.seam?tipo=L&localizador=OT7712',
    );
    expect(hrefs(build({ carrier: { id: 'pullman-cargo' }, order: '2350-123' }).html)).toContain('https://pullmancargo.cl/seguimiento/2350123');
  });

  it('página sin el número (Varmontt, Chilexpress, Mena, PDQ): «Ingresa … en su página»', () => {
    const v = build({ carrier: { id: 'varmontt' }, order: '4455' });
    expect(hrefs(v.html)).toEqual(['https://varmontt.cl/seguimiento-varmontt/', `${SITE_URL}/producto/panel-led-prueba-48w`]);
    expect(visible(v.html)).toContain('Ingresa la orden de servicio 4455 en su página.');
    expect(v.text).toContain('- Seguimiento: ingresa la orden de servicio 4455 en https://varmontt.cl/seguimiento-varmontt/.');
    const p = build({ carrier: { id: 'pdq' }, order: '7712' });
    expect(hrefs(p.html)[0]).toBe('https://www.pdq.cl/tracking');
    expect(p.html).not.toContain('?q=');
    expect(visible(p.html)).toContain('Ingresa el N° de guía 7712 en su página.');
    expect(visible(build({ carrier: { id: 'transportes-mena' }, order: '88' }).html)).toContain('Ingresa el N° de orden 88 en su página.');
  });

  it('Cruz del Sur y ECOEx: sin botón, «Guarda la orden de flete…»', () => {
    for (const id of ['cruz-del-sur', 'ecoex'] as const) {
      const n = build({ carrier: { id }, order: '5550001' });
      expect(n.html).not.toContain('Seguir mi envío');
      expect(hrefs(n.html).filter((h) => !h.startsWith(SITE_URL))).toEqual([]);
      expect(visible(n.html)).toContain(`Guarda la orden de flete 5550001: con ella consultas tu envío en ${n.subject.includes('ECOEx') ? 'ECOEx' : 'Cruz del Sur'}.`);
      expect(visible(n.html)).toContain('Aquí tienes los datos del envío y lo que necesitas para retirarlo.');
    }
  });

  it('operador desconocido (opción nueva): su etiqueta, sin botón, textos genéricos y solo la cédula al retirar', () => {
    const n = build({ carrier: { id: null, label: 'Rapid Cargo' }, order: 'RC-4455' });
    expect(n.subject).toBe('Tu pedido va en camino — Factura N° 1234, Rapid Cargo orden de flete RC-4455');
    expect(n.html).not.toContain('Seguir mi envío');
    expect(n.text).toContain('Te adjuntamos la factura N° 1234 en PDF y el comprobante de Rapid Cargo.');
    expect(n.text).toContain('Al retirarlo: lleva tu cédula de identidad y la orden de flete RC-4455. Revisa que la caja');
    expect(`${n.html}${n.text}`).not.toMatch(/10 días|bodegaje/);
  });

  it('la regla de 10 días y bodegaje solo con Starken y solo al retirar', () => {
    expect(build().text).toContain('Tienes 10 días corridos desde la fecha de entrega para retirarlo; después Starken cobra bodegaje por día y por kilo.');
    expect(build({ delivery: 'home' }).text).not.toContain('10 días');
    expect(build({ carrier: { id: 'pullman-cargo' } }).text).not.toContain('10 días');
  });
});

describe('entrega, flete, pasos y productos', () => {
  it('retiro: agencia, «al retirarlo», pasos En agencia / Retirado', () => {
    const n = build();
    const html = visible(n.html);
    expect(html).toContain('Lo entregamos a Starken el jueves 19 de noviembre, para retiro en su agencia de La Serena.');
    expect(html).toContain('Retiro en agencia Starken, La Serena');
    expect(html).toContain('Por pagar: $14.460. Lo pagas a Starken al retirarlo.');
    expect(html).toMatch(/Pedido confirmado .*Despachado .*En agencia .*Retirado/);
    expect(n.text).toContain('- Flete: por pagar, $14.460. Lo pagas a Starken al retirarlo.');
    expect(n.html).toContain('#FFF6E0');
  });

  it('por pagar sin monto (el comprobante de PDQ no lo trae, 25-11-2026): la misma frase, sin cifra', () => {
    const n = build({ carrier: { id: 'pdq' }, order: '8084765', delivery: 'home', place: 'Copiapó', freight: { kind: 'due', amountClp: null }, packages: 6, kilos: null });
    const html = visible(n.html);
    expect(html).toContain('Flete por pagar: lo pagas a PDQ al recibirlo.');
    expect(n.text).toContain('- Flete: por pagar. Lo pagas a PDQ al recibirlo.');
    expect(`${n.subject}\n${n.preheader}\n${n.text}\n${html}`).not.toMatch(/\$|null|NaN|undefined/);
    expect(n.html).toContain('#FFF6E0');
  });

  it('domicilio pagado: comuna, «al recibirlo», pasos En reparto / Entregado', () => {
    const n = build({ delivery: 'home', place: 'Viña del Mar', freight: { kind: 'paid' }, packages: 2 });
    const html = visible(n.html);
    expect(html).toContain('con entrega en tu dirección de Viña del Mar.');
    expect(html).toContain('A domicilio, Viña del Mar');
    expect(html).toContain('El flete ya está pagado: no pagas nada al recibirlo.');
    expect(html).toMatch(/En reparto .*Entregado/);
    expect(html).not.toContain('cédula');
    expect(n.text).toContain('- Entrega: a domicilio en Viña del Mar.');
    expect(n.text).toContain('- Flete: pagado por eLIGHTS.cl. No pagas nada al recibirlo.');
    expect(n.text).toContain('Al recibirlo: revisa que las cajas estén en buen estado antes de firmar.');
  });

  it('sin fecha estimada: la celda «Carga» completa el par y el texto previo usa el día del despacho', () => {
    const n = build({ eta: null });
    expect(visible(n.html)).toContain('Carga 1 bulto, 3,2 kg');
    expect(n.preheader).toBe('Starken, orden de flete N° 123.456.789 · Despachado el jueves 19 de noviembre');
    const withEta = visible(build().html);
    expect(withEta).toContain('Entrega estimada lunes 23 de noviembre');
    expect(withEta).not.toContain('Carga 1 bulto');
  });

  it('sin nombre: «Hola, tu pedido va en camino»', () => {
    const n = build({ greetingName: null });
    expect(n.html).toContain('>Hola, tu pedido va en camino</h1>');
    expect(n.text).toMatch(/^Hola,\n/);
  });

  it('productos: la ficha técnica solo con un id del sitio válido', () => {
    const n = build();
    expect(n.text).toContain('- 10 Panel LED de prueba 48W, luz neutra 4000K\n  Ficha técnica: https://elights.cl/producto/panel-led-prueba-48w\n- 2 Cable de prueba 3x1,5 mm\n');
    expect(n.html.match(/Ficha técnica/g)).toHaveLength(1);
    expect(productUrl('panel-led-prueba-48w')).toBe(`${SITE_URL}/producto/panel-led-prueba-48w`);
    for (const bad of ['javascript:alert(1)', '../admin', 'a/b', 'Panel', 'x?y=1', '', null]) expect(productUrl(bad)).toBeNull();
    const evil = build({ products: [{ quantity: 1, name: 'x', siteId: 'javascript:alert(1)' }] });
    expect(evil.html).not.toContain('javascript:');
    expect(evil.html).not.toContain('Ficha técnica');
  });
});

describe('escape', () => {
  it('escapa todo valor de Pipedrive (<script>, comillas y &)', () => {
    const n = build({
      greetingName: '<script>alert("x")</script>',
      place: `O'Higgins & "Centro"`,
      order: '12<b>3',
      carrier: { id: null, label: 'Carga <i>Sur</i> & Cía' },
      products: [{ quantity: 1, name: '<img src=x onerror=alert(1)> "Foco" O\'Brien & Co', siteId: 'foco-prueba' }],
    });
    expect(n.html).not.toMatch(/<script|<img|<b>3|<i>Sur/);
    expect(n.html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    expect(n.html).toContain('O&#39;Higgins &amp; &quot;Centro&quot;');
    expect(n.html).toContain('12&lt;b&gt;3');
    expect(n.html).toContain('Carga &lt;i&gt;Sur&lt;/i&gt; &amp; Cía');
    expect(n.html).toContain('&lt;img src=x onerror=alert(1)&gt; &quot;Foco&quot; O&#39;Brien &amp; Co');
    expect(n.html).not.toContain('<b>3');
    // el texto plano va sin escapar (text/plain)
    expect(n.text).toContain(`retiro en la agencia Carga <i>Sur</i> & Cía de O'Higgins & "Centro".`);
  });

  it('assertSafeLinks rechaza javascript:, http, otros dominios y etiquetas peligrosas', () => {
    expect(() => assertSafeLinks('<a href="https://www.starken.cl/seguimiento?codigo=1">x</a>')).not.toThrow();
    expect(() => assertSafeLinks(`<a href="${SITE_URL}/producto/x">x</a>`)).not.toThrow();
    for (const bad of [
      '<a href="javascript:alert(1)">x</a>',
      "<a href='JaVaScRiPt:alert(1)'>x</a>",
      '<a href="http://elights.cl/producto/x">x</a>',
      '<a href="https://elights.cl.evil.example/">x</a>',
      '<a href="https://evil.example/?u=https://elights.cl">x</a>',
      '<a href="data:text/html,hola">x</a>',
      '<a href="/producto/x">x</a>',
      '<img alt="">',
      '<style>p{}</style>',
      '<script>1</script>',
    ]) {
      expect(() => assertSafeLinks(bad), bad).toThrow();
    }
  });
});

describe('vista previa', () => {
  it('prefijo en el asunto y franja en el HTML y en el texto', () => {
    const n = build({ preview: true });
    expect(n.subject).toBe('[Vista previa] Tu pedido va en camino — Factura N° 1234, Starken orden de flete 123.456.789');
    const notice = 'Vista previa: este correo no le llegó al cliente. Para enviárselo, elige «Enviar al cliente» en «Despacho · Aviso» del negocio.';
    expect(visible(n.html)).toContain(notice);
    expect(n.text.startsWith(`[${notice}]\n\nHola Ana,\n`)).toBe(true);
  });
});

describe('datos que no sirven', () => {
  it('lanza en vez de armar un correo con un hueco', () => {
    expect(() => build({ order: ' .-. ' })).toThrow();
    expect(() => build({ packages: 0 })).toThrow();
    expect(() => build({ kilos: Number.NaN })).toThrow();
    expect(() => build({ kilos: 0 })).toThrow();
    expect(() => build({ shipDate: '2026-02-30' })).toThrow();
    expect(() => build({ eta: '23-11-2026' })).toThrow();
  });

  it('una orden o un lugar con solo espacios cuentan como vacíos: se omiten, sin hueco', () => {
    const n = build({ order: '  ', place: '  ' });
    expect(n.subject).toBe('Tu pedido va en camino — Factura N° 1234, Starken');
    expect(n.text).toContain('- Entrega: retiro en la agencia Starken.');
    expect(n.text).not.toContain('Seguimiento');
  });
});

// ── Campos opcionales (dueño, 24-11-2026) ───────────────────────────────────

describe('campos opcionales (dueño, 24-11-2026): sin orden, entrega, agencia o comuna, flete ni kilos', () => {
  const TVP: CarrierRef = { id: null, label: 'Transportes TVP' };
  const EMPTY: Partial<ShippingNoticeData> = { carrier: TVP, order: null, delivery: null, place: null, freight: null, kilos: null, packages: 5, eta: null };
  /** Cómo nombran la orden los operadores de las pruebas: ninguna frase lo dice si no hay orden. */
  const ORDER_WORDS = /orden de (?:flete|transporte|servicio)|N° de guía|N° de orden|\bOT\b/;

  /** Con y sin cada opcional (5 operadores × orden × entrega × lugar × flete × kilos × fecha estimada). */
  function* optionalCombinations(): Generator<ShippingNoticeData> {
    for (const carrier of CARRIER_CASES)
      for (const order of ['123.456.789', null])
        for (const delivery of ['pickup', 'home', null] as const)
          for (const place of ['La Serena', null])
            for (const freight of [{ kind: 'due', amountClp: 9_870 }, { kind: 'due', amountClp: null }, { kind: 'paid' }, null] as const)
              for (const kilos of [3.2, null])
                for (const eta of ['2026-11-24', null]) yield { ...base, carrier, order, delivery, place, freight, kilos, eta, packages: 2 };
  }

  const all = [...optionalCombinations()].map((data) => ({ data, notice: buildShippingNotice(data) }));

  it('arma las 960 combinaciones, sin huecos ni restos de un dato vacío', () => {
    expect(all).toHaveLength(960);
    for (const { notice } of all) {
      for (const out of [notice.subject, notice.preheader, notice.text, visible(notice.html)]) {
        expect(out).not.toMatch(/undefined|null|NaN|\s[,.:]|,\.|\(\)/);
      }
      // Una lista de viñetas sin líneas no se escribe: nunca tres saltos seguidos ni una viñeta vacía.
      expect(notice.text).not.toMatch(/\n\n\n|^- *$/m);
      expect(notice.html).toContain('width="600"');
      expect(retiredIn(notice.text, true)).toEqual([]);
    }
  });

  it('el texto y el HTML dicen lo mismo, y cada línea sale solo con su dato', () => {
    for (const { data, notice } of all) {
      const html = visible(notice.html);
      const both = `${notice.subject}\n${notice.preheader}\n${notice.text}\n${html}`;
      const op = 'label' in data.carrier ? data.carrier.label : CARRIERS.find((c) => c.id === data.carrier.id)!.label;
      const facts = [op, '2 bultos', 'jueves 19 de noviembre'];
      if (data.order) facts.push(data.order);
      if (data.delivery && data.place) facts.push(data.place);
      if (data.kilos) facts.push('3,2 kg');
      if (data.freight?.kind === 'due') facts.push(data.freight.amountClp !== null ? '$9.870' : 'por pagar');
      if (data.freight?.kind === 'paid') facts.push('pagado');
      if (data.eta) facts.push('martes 24 de noviembre');
      for (const fact of facts) {
        expect(notice.text, fact).toContain(fact);
        expect(html, fact).toContain(fact);
      }

      // Sin orden: ni asunto, ni texto previo, ni seguimiento, ni «la orden de flete de …».
      if (!data.order) {
        expect(both).not.toMatch(ORDER_WORDS);
        expect(both).not.toMatch(/Seguimiento|Seguir mi envío|Ingresa |Guarda /);
        expect(hrefs(notice.html).every((h) => h.startsWith(`${SITE_URL}/producto/`))).toBe(true);
        expect(notice.subject).toBe(`Tu pedido va en camino — Factura N° 1234, ${op}`);
        expect(notice.text).toContain(`el comprobante de ${op}.`);
      } else {
        expect(notice.text).toContain('- Seguimiento: ');
      }

      // Entrega: sin ella, ni la línea ni el lugar, y el cierre neutro; con ella y sin lugar, sin lugar.
      if (!data.delivery) {
        expect(notice.text).not.toContain('- Entrega:');
        expect(both).not.toMatch(/Retiro en agencia|A domicilio|cédula|La Serena/);
        expect(notice.text).toContain(`\nAl recibirlo: revisa que las cajas estén en buen estado antes de firmar. Si ves algún daño, déjalo anotado con ${op} y escríbenos el mismo día con fotos.\n`);
        expect(html).toMatch(/Despachado .*En camino .*Entregado/);
      } else if (!data.place) {
        expect(notice.text).toContain(data.delivery === 'pickup' ? `\n- Entrega: retiro en la agencia ${op}.\n` : '\n- Entrega: a domicilio.\n');
        expect(html).toContain(data.delivery === 'pickup' ? `Entrega Retiro en agencia ${op} ` : 'Entrega A domicilio ');
      } else {
        expect(notice.text).toContain(data.delivery === 'pickup' ? `\n- Entrega: retiro en la agencia ${op} de La Serena.\n` : '\n- Entrega: a domicilio en La Serena.\n');
      }

      if (!data.freight) {
        expect(notice.text).not.toContain('- Flete:');
        expect(notice.html).not.toContain('>Flete</h2>');
      }
      if (!data.kilos) {
        expect(both).not.toContain(' kg');
        expect(notice.text).toMatch(/\nQué va en tu envío \(2 bultos\):/);
        expect(html).toContain('Qué va en tu envío · 2 bultos');
      }
      if (!data.order && !data.eta && !data.delivery && !data.freight) {
        expect(notice.text).toContain('el jueves 19 de noviembre.\n\nQué va en tu envío (');
      }
    }
  });

  it('los cinco vacíos: asunto, texto previo y texto completos (Transportes TVP, 5 bultos)', () => {
    const n = build(EMPTY);
    expect(n.subject).toBe('Tu pedido va en camino — Factura N° 1234, Transportes TVP');
    expect(n.preheader).toBe('Transportes TVP · Despachado el jueves 19 de noviembre');
    expect(n.text).toBe(
      [
        'Hola Ana,',
        '',
        'Tu pedido ya va en camino: lo entregamos a Transportes TVP el jueves 19 de noviembre.',
        '',
        'Qué va en tu envío (5 bultos):',
        '- 10 Panel LED de prueba 48W, luz neutra 4000K',
        `  Ficha técnica: ${SITE_URL}/producto/panel-led-prueba-48w`,
        '- 2 Cable de prueba 3x1,5 mm',
        '',
        'Te adjuntamos la factura N° 1234 en PDF y el comprobante de Transportes TVP.',
        '',
        'Al recibirlo: revisa que las cajas estén en buen estado antes de firmar. Si ves algún daño, déjalo anotado con Transportes TVP y escríbenos el mismo día con fotos.',
        '',
        'Quedo atento.',
        '',
        'Saludos cordiales,',
        'Claudio Quero',
        'eLIGHTS.cl SpA',
        'claudio@elights.cl',
        '',
        `¿Dudas con tu pedido? Responde este correo o llámanos al ${COMPANY_PHONE}.`,
        `eLIGHTS.cl SpA · RUT ${COMPANY_RUT} · claudio@elights.cl · elights.cl`,
        '',
      ].join('\n'),
    );
    const html = visible(n.html);
    expect(html).toContain('Hola Ana, tu pedido va en camino Lo entregamos a Transportes TVP el jueves 19 de noviembre. Aquí tienes los datos del envío y lo que necesitas para recibirlo.');
    expect(html).toContain('Operador Transportes TVP Carga 5 bultos');
    expect(html).toMatch(/Pedido confirmado .*Despachado .*En camino .*Entregado/);
    expect(html).toContain('Qué va en tu envío · 5 bultos');
    expect(html).toContain('Al recibirlo Revisa que las cajas estén en buen estado antes de firmar.');
    expect(html).toContain('Documentos Te adjuntamos la factura N° 1234 en PDF y el comprobante de Transportes TVP.');
    expect(n.html).not.toContain('>Flete</h2>');
    expect(n.html).not.toContain('Seguir mi envío');
    expect(hrefs(n.html)).toEqual([`${SITE_URL}/producto/panel-led-prueba-48w`]);
  });

  it('solo sin orden: sin seguimiento ni botón, y «lleva tu cédula de identidad» sin la orden', () => {
    const n = build({ order: null });
    expect(n.subject).toBe('Tu pedido va en camino — Factura N° 1234, Starken');
    expect(n.preheader).toBe('Starken · Entrega estimada: lunes 23 de noviembre');
    expect(n.text).toContain(
      'jueves 19 de noviembre.\n\n- Entrega estimada: lunes 23 de noviembre, según Starken.\n- Entrega: retiro en la agencia Starken de La Serena.\n- Flete: por pagar, $14.460. Lo pagas a Starken al retirarlo.\n\nQué va',
    );
    expect(n.text).toContain('Al retirarlo: lleva tu cédula de identidad. Tienes 10 días corridos desde la fecha de entrega para retirarlo;');
    expect(n.text).toContain('Te adjuntamos la factura N° 1234 en PDF y el comprobante de Starken.');
    const html = visible(n.html);
    expect(html).toContain('Aquí tienes los datos del envío y lo que necesitas para retirarlo.');
    expect(html).toContain('Operador Starken Entrega estimada lunes 23 de noviembre Entrega Retiro en agencia Starken, La Serena Carga 1 bulto, 3,2 kg');
    expect(hrefs(n.html).filter((h) => !h.startsWith(SITE_URL))).toEqual([]);
    expect(`${n.subject}${n.preheader}${n.text}${html}`).not.toMatch(/123\.456\.789|orden de flete|Seguimiento|Seguir mi envío/);
    // Un operador cuyo documento es «la orden de flete» (Chilexpress) adjunta «el comprobante».
    const c = build({ carrier: { id: 'chilexpress' }, order: null, hasDocument: false });
    expect(c.text).toContain('\nTe adjuntamos el comprobante de Chilexpress.\n');
    expect(`${c.subject}${c.text}${c.html}`).not.toMatch(/orden de (?:flete|transporte)/);
  });

  it('con entrega y sin agencia o comuna: la entrega sin lugar', () => {
    const pickup = build({ place: null, eta: null });
    expect(pickup.text).toContain('\n- Entrega: retiro en la agencia Starken.\n');
    expect(visible(pickup.html)).toContain('Lo entregamos a Starken el jueves 19 de noviembre, para retiro en su agencia. Aquí tienes el seguimiento');
    expect(visible(pickup.html)).toContain('Entrega Retiro en agencia Starken Carga');
    const home = build({ delivery: 'home', place: null, eta: null });
    expect(home.text).toContain('\n- Entrega: a domicilio.\n');
    expect(visible(home.html)).toContain('Lo entregamos a Starken el jueves 19 de noviembre, con entrega en tu dirección. Aquí tienes');
    expect(visible(home.html)).toContain('Entrega A domicilio Carga');
  });

  it('sin entrega: sin la línea y con el cierre neutro «Al recibirlo» (sin cédula ni regla de retiro)', () => {
    const n = build({ delivery: null, packages: 3 });
    expect(n.text).not.toContain('- Entrega:');
    expect(n.text).not.toContain('La Serena');
    expect(n.text).toContain('\nAl recibirlo: revisa que las cajas estén en buen estado antes de firmar. Si ves algún daño, déjalo anotado con Starken y escríbenos el mismo día con fotos.\n');
    expect(n.text).toContain('- Flete: por pagar, $14.460. Lo pagas a Starken al recibirlo.');
    expect(`${n.text}${n.html}`).not.toMatch(/cédula|10 días|Al retirarlo/);
    expect(visible(n.html)).toMatch(/Despachado .*En camino .*Entregado/);
  });

  it('sin flete: sin la línea ni la sección', () => {
    const n = build({ freight: null });
    expect(n.text).not.toContain('- Flete:');
    expect(n.text).toContain('- Entrega: retiro en la agencia Starken de La Serena.\n\nQué va');
    expect(n.html).not.toContain('>Flete</h2>');
    // ni el recuadro amarillo de «Por pagar»
    expect(n.html).not.toContain('#FFF6E0');
  });

  it('sin kilos: «Qué va en tu envío (5 bultos)», sin los kg', () => {
    const n = build({ kilos: null, packages: 5, eta: null });
    expect(n.text).toContain('\nQué va en tu envío (5 bultos):\n');
    expect(visible(n.html)).toContain('Qué va en tu envío · 5 bultos');
    // Sin fecha estimada, la celda «Carga» completa el par con los bultos.
    expect(visible(n.html)).toContain('Carga 5 bultos');
    expect(`${n.text}${n.html}`).not.toContain(' kg');
  });
});
