import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ProductContent } from '../../src/data/catalog/types';
import type { SnapshotProduct } from '../../src/data/catalog/jumpseller.types';
import { checkContent, checkFacts, checkFormat, checkRules, repeatedSentences } from './check';
import { productFacts } from './facts';
import { CONTENT_DIR } from './files';
import { renderContentReport, reviewContent } from './report';

const product = { jumpseller_id: 7, name: 'PROYECTOR LED 100W IP66', sku: 'PRY100', brand: null, categories: ['proyectores-led'] };
const description = {
  electricos: [
    { label: 'Potencia', value: '100W' },
    { label: 'Tensión', value: '100-277V' },
    { label: 'Flujo luminoso', value: '13.000 Lm.' },
    { label: 'Temperatura de color', value: 'Luz fría - 6500K' },
  ],
  construccion: [
    { label: 'Grado de protección', value: 'IP66 - IK08' },
    { label: 'Garantía', value: '1 año' },
    { label: 'Certificación', value: 'SEC' },
  ],
  componentes: [{ label: 'Chip LED', value: 'Bridgelux' }],
};
const facts = productFacts(product, description, { 'proyectores-led': 'Proyectores LED' });

const paragraph = 'El proyector entrega 13.000 lm con 100W y luz fría de 6500K, con protección IP66 e IK08 para exteriores.';
const good: ProductContent = {
  metaTitle: 'Proyector LED 100W IP66 luz fría | eLIGHTS',
  metaDescription: 'Proyector LED de 100W y 13.000 lm con protección IP66 e IK08 para patios, bodegas y fachadas. Cotiza con despacho a todo Chile.',
  description: [
    paragraph,
    '**Rendimiento lumínico**',
    'Con chip Bridgelux y tensión de 100 a 277V, se conecta a la red eléctrica habitual. ' + paragraph + ' ' + paragraph,
    '**Construcción y protección**',
    'Certificación SEC y garantía de 1 año. ' + paragraph + ' ' + paragraph,
    '**Compra y despacho**',
    'Despacho a todo Chile en hasta 2 días hábiles. ' + paragraph + ' ' + paragraph + ' ' + paragraph + ' ' + paragraph,
    '- Patios industriales\n- Fachadas',
  ].join('\n\n'),
  keyBenefits: ['13.000 lm con 100W de consumo', 'IP66 e IK08 para exterior', 'Chip LED Bridgelux', 'Certificación SEC'],
  useCases: ['Patios de carga', 'Fachadas', 'Estacionamientos'],
  faq: [
    { question: '¿Sirve para exteriores?', answer: 'Sí: su grado IP66 protege contra polvo y chorros de agua, y el IK08 contra impactos moderados en patios y fachadas.' },
    { question: '¿Qué garantía tiene?', answer: 'Tiene garantía de 1 año contra defectos de fabricación, según los datos del producto en eLIGHTS.' },
    {
      question: '¿Cuánto demora el despacho?',
      answer: 'eLIGHTS despacha a todo Chile en hasta 2 días hábiles desde que se confirma el pago; a regiones se suma el viaje del transportista, que se informa en la cotización.',
    },
  ],
};

describe('verificación del contenido SEO', () => {
  it('un contenido correcto pasa todas las verificaciones', () => {
    expect(checkContent(good, facts)).toEqual([]);
  });

  it('rechaza cifras que no están en los datos, también en rangos y con separador de miles', () => {
    const c = { ...good, keyBenefits: [...good.keyBenefits, 'Vida útil de 50.000 horas', 'Funciona de 90 a 277V', 'Ahorra hasta 80% de energía'] };
    const problems = checkFacts(c, facts);
    expect(problems).toContain('cifra que no está en los datos de Jumpseller: "50.000 horas"');
    expect(problems).toContain('cifra que no está en los datos de Jumpseller: "90 a 277V"');
    expect(problems).toContain('cifra que no está en los datos de Jumpseller: "80%"');
    expect(checkFacts({ ...good, keyBenefits: ['Flujo de 13000 lm'] }, facts)).toEqual([]);
  });

  it('la cifra tiene que estar con su unidad: un "5" de otro dato no respalda "5 años"', () => {
    const c = { ...good, keyBenefits: ['Garantía de 5 años contra defectos', 'Opera hasta 100 °C', 'Vida útil de 50 mil horas', 'Corriente de 8,5A'] };
    expect(checkFacts(c, facts)).toEqual([
      'cifra que no está en los datos de Jumpseller: "5 años"',
      'cifra que no está en los datos de Jumpseller: "100 °C"',
      'cifra que no está en los datos de Jumpseller: "50 mil horas"',
      'cifra que no está en los datos de Jumpseller: "8,5A"',
    ]);
    // "1 año" sí: la fila Garantía lo dice; "1.200" se lee como mil doscientos, no 1,2
    expect(checkFacts({ ...good, keyBenefits: ['Garantía de 1 año'] }, facts)).toEqual([]);
    expect(checkFacts({ ...good, keyBenefits: ['Entrega 13.000 lm'] }, facts)).toEqual([]);
    expect(checkFacts({ ...good, keyBenefits: ['Entrega 13 lm'] }, facts)).toEqual(['cifra que no está en los datos de Jumpseller: "13 lm"']);
  });

  it('"IP66 y 3 años" no es un rango; "entre 100 y 277V" sí; las medidas "A x B mm" dan unidad a todas', () => {
    expect(checkFacts({ ...good, keyBenefits: ['IP66 y 1 año de garantía', 'Funciona entre 100 y 277V'] }, facts)).toEqual([]);
    expect(checkFacts({ ...good, keyBenefits: ['Funciona entre 90 y 277V'] }, facts)).toEqual(['cifra que no está en los datos de Jumpseller: "entre 90 y 277V"']);
    const f = { ...facts, construccion: [...facts.construccion, { label: 'Dimensiones', value: 'Ø390 x 120 mm' }] };
    expect(checkFacts({ ...good, keyBenefits: ['Mide 390 mm de diámetro y 120 mm de alto'] }, f)).toEqual([]);
  });

  it('una fila sin unidad en el valor toma la de su etiqueta', () => {
    const f = productFacts(product, { construccion: [{ label: 'Alto (mm)', value: '20' }, { label: 'Temperatura de operación', value: '-20 ~ 45' }] }, {});
    expect(checkFacts({ ...good, keyBenefits: ['Solo 20 mm de alto', 'Opera entre -20 °C y 45 °C'] }, { ...facts, construccion: f.construccion })).not.toContainEqual(
      expect.stringMatching(/20 mm|45 °C/),
    );
  });

  it('los grados se reconocen con guion, espacio o minúsculas, y "cree" (verbo) no es una marca', () => {
    expect(checkFacts({ ...good, keyBenefits: ['Grado ip-68 y IPX8'] }, facts)).toEqual([
      'certificación o grado que no está en los datos de Jumpseller: "IP68"',
      'certificación o grado que no está en los datos de Jumpseller: "IPX8"',
    ]);
    expect(checkFacts({ ...good, keyBenefits: ['Quien cree que basta con potencia se equivoca'] }, facts)).toEqual([]);
    expect(checkFacts({ ...good, keyBenefits: ['LED CREE de alto rendimiento'] }, facts)).toEqual(['marca que no está en los datos de Jumpseller: "CREE"']);
  });

  it('rechaza certificaciones, grados y marcas que no están en los datos', () => {
    const c = { ...good, keyBenefits: ['Certificación CE y RoHS', 'Grado IP67', 'Driver Mean Well'] };
    const problems = checkFacts(c, facts);
    expect(problems).toEqual([
      'certificación o grado que no está en los datos de Jumpseller: "CE"',
      'certificación o grado que no está en los datos de Jumpseller: "RoHS"',
      'certificación o grado que no está en los datos de Jumpseller: "IP67"',
      'marca que no está en los datos de Jumpseller: "Mean Well"',
    ]);
  });

  it('reglas del sitio: stock, precios, gratis, mismo día, URLs', () => {
    const faq = [
      { question: '¿Hay stock?', answer: 'Hay stock disponible para entrega inmediata en todo Santiago, consulta por los plazos.' },
      { question: '¿Precio?', answer: 'Desde $19.990 con estudio lumínico gratis, despacho el mismo día y más en https://elights.cl.' },
    ];
    const problems = checkRules({ ...good, faq });
    expect(problems.some(p => p.includes('stock'))).toBe(true);
    expect(problems).toContain('promete algo gratis: "gratis"');
    expect(problems).toContain('promete despacho el mismo día: "mismo día"');
    expect(problems).toContain('trae URLs: "https://"');
  });

  const rules = (text: string) => checkRules({ ...good, description: text });
  const FLEET = 'afirma que eLIGHTS tiene camiones, flota o reparto propio (no está confirmado)';
  const ARRIVAL = 'promete que el pedido llega en 2 días hábiles';

  it('rechaza la flota propia (no está confirmada), pero no los camiones o flotas como lugar o cliente', () => {
    for (const text of [
      'Despachamos a todo Chile en hasta 2 días hábiles, con camiones propios en la Provincia de Santiago.',
      'En la Provincia de Santiago repartimos con flota propia.',
      'Dentro de Santiago el pedido va con reparto propio.',
      'Dentro de la Provincia de Santiago va en nuestros camiones.',
      'El reparto lo hacen nuestros propios camiones.',
      'Lo llevan los camiones de eLIGHTS hasta tu obra.',
      'En la Provincia de Santiago lo repartimos nosotros.',
      'Contamos con vehículos propios para llevar el pedido.',
      'En la Provincia de Santiago, el reparto es directo.',
    ]) {
      expect(rules(text), text).toContainEqual(expect.stringContaining(FLEET));
    }
    for (const text of [
      'Sirve en patios de camiones, accesos de camiones y estacionamientos de buses.',
      'Galpones de mantención de flotas y equipos pesados.',
      'Vehículos de servicio técnico y flotas de mantención.',
      'Los focos se reparten entre los tres circuitos del riel, cada uno con encendido propio.',
      'En la Región Metropolitana, eLIGHTS ofrece la instalación como servicio aparte.',
    ]) {
      expect(rules(text), text).toEqual([]);
    }
  });

  it('rechaza la llegada en 2 días hábiles (son de despacho), pero no las frases de despacho', () => {
    for (const text of [
      'El pedido llega a cualquier región en hasta 2 días hábiles.',
      'Los kits llegan a todo Chile en hasta 2 días hábiles.',
      'Una vez confirmado el pedido, te llega a tu obra en hasta 2 días hábiles.',
      'Sí, llegamos a cualquier región del país en hasta 2 días hábiles.',
      'El pedido sale a cualquier región y llega en hasta 2 días hábiles.',
      'Tu pedido viaja a cualquier ciudad de Chile en hasta 2 días hábiles.',
      'Hacemos llegar el pedido a todo el país en hasta 2 días hábiles.',
      'Los pedidos se reparten a todo el país en hasta 2 días hábiles.',
      'Los pedidos salen a cualquier región, con llegada en hasta 2 días hábiles.',
      'La entrega en cualquier región del país toma hasta 2 días hábiles.',
      'Recibes tu pedido en hasta 2 días hábiles.',
      'Lo recibirás en tu obra en hasta 2 días hábiles.',
      'El despacho, en hasta 2 días hábiles, llega a todo Chile.',
      // destino más duración: se lee como plazo de llegada
      'El despacho a cualquier región de Chile toma hasta 2 días hábiles.',
      'Los envíos a todo Chile tardan hasta 2 días hábiles.',
      'El despacho, con destino a cualquier región, demora hasta 2 días hábiles.',
      'El despacho cubre todo Chile y demora hasta 2 días hábiles.',
      'Los despachos a Santiago y regiones toman hasta 2 días hábiles.',
      'El envío sale a cualquier región y tarda hasta 2 días hábiles.',
      'El despacho tarda hasta 2 días hábiles y llega a todo el país.',
      // la cifra en letras
      'El pedido llega a cualquier región en hasta dos días hábiles.',
      // "entregamos" con destino y el orden invertido
      'Te lo entregamos en tu obra, en cualquier región, en hasta 2 días hábiles.',
      'Despachamos y entregamos en todo Chile en hasta 2 días hábiles.',
      'En hasta 2 días hábiles el pedido llega a cualquier región.',
      // nombrar al transportista no aclara que el viaje se suma
      'El despacho a cualquier región toma hasta 2 días hábiles, con el transportista que prefieras.',
      'Los envíos a todo Chile tardan hasta 2 días hábiles, puerta a puerta con el operador logístico.',
      'El despacho a todo Chile toma hasta 2 días hábiles y el transportista lo deja en tu obra.',
      // alcanzar o cubrir el país en el plazo
      'El despacho alcanza todo el territorio nacional en hasta 2 días hábiles.',
      'El despacho cubre todo Chile, en hasta 2 días hábiles.',
      // destino puntual con "se hace en" o "es en"
      'El despacho a cualquier región se hace en hasta 2 días hábiles.',
      'El despacho, a cualquier punto de Chile, se hace en hasta 2 días hábiles.',
      'La compra se factura y el despacho a cualquier región de Chile es en hasta 2 días hábiles.',
      'Una vez confirmada la compra, el despacho es en hasta 2 días hábiles a cualquier región.',
      'Coordinamos un despacho de hasta 2 días hábiles a cualquier punto del país.',
      // enviar a un destino en el plazo
      'Enviamos las cajas a cualquier región de Chile en hasta 2 días hábiles.',
      'Enviamos a todo Chile en hasta 2 días hábiles.',
      'Hacemos envíos a todo el territorio en hasta 2 días hábiles.',
      'El envío a todo Chile se hace en hasta 2 días hábiles.',
      'Enviamos el pedido a todo el país con despacho en hasta 2 días hábiles.',
      'Preparamos la cotización formal, con envío a todo Chile en hasta 2 días hábiles.',
    ]) {
      expect(rules(text), text).toContainEqual(expect.stringContaining(ARRIVAL));
    }
    expect(rules('Despacho en hasta dos días hábiles.')).toContainEqual(expect.stringContaining('escribe el plazo en letras'));
    for (const text of [
      'El pedido se despacha en hasta 2 días hábiles, y a regiones se suma el tiempo de viaje del transportista, que se informa en la cotización.',
      'Despachamos a todo Chile en hasta 2 días hábiles; a regiones, el pedido sale con el transportista y el tiempo de viaje te lo informamos en la cotización.',
      'Recibirás la cotización formal con factura, y el pedido se despacha a todo Chile en hasta 2 días hábiles.',
      'Te llega la cotización formal y despachamos en hasta 2 días hábiles desde que se confirma el pago.',
      'Si va a regiones, en hasta 2 días hábiles lo entregamos al transportista, y el viaje hasta tu ciudad te lo informamos en la cotización.',
      'El plazo de entrega al transportista es de hasta 2 días hábiles.',
      'El pedido se despacha en hasta 2 días hábiles y llega a regiones con el transportista.',
      'La luz llega a cualquier punto del recinto de forma pareja.',
      'El despacho toma hasta 2 días hábiles desde que se confirma el pago.',
      'El despacho a todo Chile se hace en hasta 2 días hábiles.',
      'El despacho a todo Chile toma hasta 2 días hábiles; a regiones, sale en ese plazo con el transportista y el viaje se informa en la cotización.',
      'En los envíos a regiones, la cotización indica cuánto tarda el viaje con el transportista.',
      'Despachamos en hasta 2 días hábiles; si va a regiones, en ese plazo lo entregamos al transportista y el tiempo de viaje te lo indicamos en la cotización.',
      'Te enviamos la cotización formal y despachamos a todo Chile en hasta 2 días hábiles.',
      'El despacho cubre todo Chile y se hace en hasta 2 días hábiles.',
      'El despacho es en hasta 2 días hábiles hacia cualquier punto de Chile; en regiones, ese plazo es para dejar el pedido con un operador logístico, y el tiempo de viaje te lo informamos en la cotización.',
      'Despachamos a todo Chile en hasta 2 días hábiles; cuando el destino está en regiones, a ese plazo se suma el viaje con el transportista, indicado en la cotización.',
      // entrega o llegada con el transportista, si la oración aclara el viaje y la cotización
      'La entrega en regiones al transportista es en hasta 2 días hábiles, y el viaje se informa en la cotización.',
      'El despacho tarda hasta 2 días hábiles y llega a regiones con el transportista, en el plazo de viaje que se informa en la cotización.',
    ]) {
      expect(rules(text), text).toEqual([]);
    }
  });

  it('rechaza el plazo de despacho encadenado con dos o más punto y coma', () => {
    const CHAINED = 'encadena el plazo de despacho con dos o más ";"';
    for (const text of [
      'Con esos datos te enviamos una cotización formal; la compra se factura y despachamos en hasta 2 días hábiles; a regiones, en ese plazo los kits pasan al transportista, y el viaje que se suma figura en la cotización.',
      'Al cotizar, indica la cantidad; emitimos factura; despachamos en hasta 2 días hábiles.',
    ]) {
      expect(rules(text), text).toContainEqual(expect.stringContaining(CHAINED));
    }
    for (const text of [
      'Con esos datos te enviamos una cotización formal; la compra se factura y despachamos en hasta 2 días hábiles. Si los kits van a regiones, en ese plazo pasan al transportista, y el viaje que se suma figura en la cotización.',
      // dos ";" en una oración sin el plazo de despacho no se marcan
      'Tiene IP65; cuerpo de aluminio; y driver Mean Well.',
    ]) {
      expect(rules(text), text).toEqual([]);
    }
  });

  it('formato: largos, subtítulos, listas y preguntas', () => {
    const c = { ...good, metaTitle: 'PROYECTOR', description: 'Texto corto\n- a\nb', faq: [{ question: 'Sirve?', answer: 'Sí.' }] };
    const problems = checkFormat(c);
    expect(problems).toContain('metaTitle (caracteres): 9 (debe estar entre 30 y 65)');
    expect(problems).toContain('metaTitle debe terminar en " | eLIGHTS"');
    expect(problems).toContain('description: una lista tiene que ir sola en su bloque y cada línea empezar con "- "');
    expect(problems).toContain('faq: la pregunta "Sirve?" debe ir entre ¿ y ?');
  });

  it('detecta oraciones largas repetidas en muchos productos', () => {
    const many = new Map(Array.from({ length: 6 }, (_, i) => [i, good] as const));
    expect(repeatedSentences(many).map(r => r.sentence)).toContain(paragraph);
    expect(repeatedSentences(new Map([[1, good]]))).toEqual([]);
  });
});

describe('revisión diaria en la sincronización', () => {
  it('avisa el contenido que ya no calza con Jumpseller y el que no tiene producto', () => {
    const root = mkdtempSync(join(tmpdir(), 'content-'));
    mkdirSync(join(root, CONTENT_DIR), { recursive: true });
    writeFileSync(join(root, CONTENT_DIR, '7.json'), JSON.stringify(good));
    writeFileSync(join(root, CONTENT_DIR, '99.json'), JSON.stringify(good));
    const snapshot = [{ ...product, permalink: 'p', price: 1, featured: false, images: [], variants: [] }] as SnapshotProduct[];
    const options = { categoryNames: {}, site: () => ({ sku: 'PRY100', brand: '' }), hasEditorial: () => false };

    const ok = reviewContent(root, snapshot, { 7: description }, options);
    expect(ok).toEqual({ written: 1, targets: 1, mismatched: [], orphans: [99] });

    // Jumpseller cambia el flujo: el texto queda desactualizado
    const changed = { 7: { ...description, electricos: [{ label: 'Potencia', value: '100W' }, { label: 'Flujo luminoso', value: '12.000 Lm.' }] } };
    const review = reviewContent(root, snapshot, changed, options);
    expect(review.mismatched[0].problems).toContain('cifra que no está en los datos de Jumpseller: "13.000 lm"');
    const report = renderContentReport(review, new Map([[7, 'PROYECTOR LED 100W IP66']]));
    expect(report).toContain('⚠️ A corregir');
    expect(report).toContain('7 PROYECTOR LED 100W IP66');
    expect(report).toContain('sin producto publicado (se puede borrar): 99');
  });
});
