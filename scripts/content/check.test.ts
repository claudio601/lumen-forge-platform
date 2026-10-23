import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ProductContent } from '../../src/data/catalog/types';
import type { SnapshotProduct } from '../../src/data/catalog/jumpseller.types';
import { checkContent, checkFacts, checkFormat, checkRules, repeatedSentences } from './check';
import { DS1_CERTIFIED_LINES } from '../../src/data/catalog/ds1';
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

  it('las opciones de las variantes también son datos de Jumpseller (las muestra el selector de la ficha)', () => {
    const benefit = { ...good, keyBenefits: ['Versión ámbar de 1600K y cálida de 2700K'] };
    expect(checkFacts(benefit, facts)).toContainEqual('cifra que no está en los datos de Jumpseller: "1600K"');
    const variants = [
      { id: 1, sku: 'A', price: 1, options: [{ name: 'Color de Luz', value: 'Luz Ámbar - 1600K' }] },
      { id: 2, sku: 'B', price: 1, options: [{ name: 'Color de Luz', value: 'Luz Cálida - 2700K' }] },
    ];
    const f = productFacts({ ...product, variants }, description, {});
    expect(f.variantOptions).toEqual(['Color de Luz: Luz Ámbar - 1600K', 'Color de Luz: Luz Cálida - 2700K']);
    expect(checkFacts(benefit, f)).toEqual([]);
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

  // D.S. N°1/2022 (auditoría UX, entrega 4, D-04): frases que estaban en content/*.json en
  // origin/main f6b50bb, antes de corregirlas
  it('D.S. N°1: rechaza el certificado sin respaldo, la sigla DS1, el DS43 y la luz azul en canchas', () => {
    const cases: [string, RegExp][] = [
      ['Se cotiza en luz fría de 6500K y cálida, y tiene certificación SEC y DS1.', /afirma el D\.S\. N°1 sin certificado/],
      ['Las versiones de 2200K y 2700K están indicadas como **DS1**, la norma chilena de contaminación lumínica.', /sigla «DS1»/],
      ['Tonos cálidos de 2200K y 2700K con 1% y 7% de luz azul, marcados como DS1.', /afirma el D\.S\. N°1 sin certificado/],
      ['La ficha incluye una aprobación de contaminación lumínica (E-013-01-2540).', /afirma el D\.S\. N°1 sin certificado/],
      ['La versión de luz cálida cuenta con certificación DS43, norma chilena de emisión.', /D\.S\. N°43/],
      ['En la ficha figura la certificación SEC, CE, RoHS y DS1/DS43.', /D\.S\. N°43/],
      ['¿Cumple con el D.S. N°1/2022? Sí, cumple el D.S. N°1.', /afirma el D\.S\. N°1 sin certificado/],
      ['En una cancha conviene partir por los cálidos, porque la norma pone exigencias a la emisión de luz azul.', /luz azul a canchas/],
    ];
    for (const [text, problem] of cases) {
      expect(rules(text).some(p => problem.test(p)), text).toBe(true);
    }
    // En toda la ficha: si es de canchas o estadios, la luz azul no va en ninguna parte
    const stadium = checkRules({ ...good, useCases: ['Canchas de fútbol', 'Estadios', 'Plazas'], description: good.description + '\n\nLa de 2200K declara 1% de luz azul.' });
    expect(stadium.some(p => p.startsWith('menciona la luz azul en una ficha de canchas'))).toBe(true);
  });

  it('D.S. N°1: acepta la norma por su nombre, la asesoría y la luz azul como dato fuera de canchas', () => {
    for (const text of [
      '¿Necesitas el D.S. N°1/2022? Te asesoramos: escríbenos a ventas@elights.cl con la comuna y el tipo de vía.',
      'Desde el 19 de octubre de 2026, el D.S. N°1/2022 rige en todo Chile para el alumbrado exterior nuevo.',
      'Ante un municipio, el cumplimiento se acredita con el certificado de cada luminaria.',
      'Se ofrece en dos versiones cálidas, de 2200K (1% de luz azul) y 2700K (7% de luz azul).',
      'Certificación SEC, CE y RoHS según la ficha.',
      'El D.S. N°43 quedó sin efecto el 19 de octubre de 2024, cuando entró en vigencia el D.S. N°1/2022.',
    ]) {
      expect(rules(text), text).toEqual([]);
    }
    // «N°1» del decreto no es declararse líder; «somos el N°1» sí
    expect(rules('Somos el N°1 en iluminación.')).toContain('se declara líder: "N°1"');
  });

  // Fórmulas equivalentes de cumplimiento (revisión de la entrega 4): la norma también se nombra
  // por su título, por los «cielos oscuros», por las Áreas de Protección Especial o como «Decreto 1»
  it('D.S. N°1: rechaza las fórmulas equivalentes de cumplimiento', () => {
    for (const text of [
      'La versión de 2200K es apta para Áreas de Protección Especial.',
      'Cumple la normativa lumínica chilena.',
      'Certificada para cielos oscuros.',
      'Cumple la norma de emisión de luminosidad artificial.',
      'Cumple el Decreto 1 del MMA.',
      'Cumple el decreto N°1 de 2022.',
    ]) {
      expect(rules(text).some(p => p.startsWith('afirma el D.S. N°1 sin certificado')), text).toBe(true);
    }
    // «decreto 10» o «DS 13» no son la norma
    expect(rules('Cumple el decreto 10 y el DS 13 de otra materia.').filter(p => p.includes('D.S. N°1'))).toEqual([]);
  });

  // Hallazgo de la revisión: «¿Sirve para un proyecto que debe cumplir el D.S. N°1/2022?»
  // respondido con «2200K (1% de luz azul) y 2700K (7% de luz azul)» se lee como «sí, cumple»
  it('D.S. N°1: el % de luz azul no va en la pregunta, la sección o el beneficio que nombra la norma', () => {
    const NEXT_TO_NORM = 'da el % de luz azul junto a la norma';
    const withFaq = (question: string, answer: string) => checkRules({ ...good, faq: [...good.faq, { question, answer }] });
    expect(
      withFaq('¿Sirve para un proyecto que debe cumplir el D.S. N°1/2022?', 'Se ofrece en 2200K (1% de luz azul) y 2700K (7% de luz azul).').some(p =>
        p.startsWith(NEXT_TO_NORM),
      ),
    ).toBe(true);
    expect(
      withFaq('¿Qué tono conviene en una calle?', 'Las cálidas: la de 2200K, con un 1% de luz azul. Si necesitas el D.S. N°1/2022, te asesoramos.').some(p =>
        p.startsWith(NEXT_TO_NORM),
      ),
    ).toBe(true);
    // Un subtítulo con la norma alcanza a sus párrafos
    const section = checkRules({
      ...good,
      description: good.description + '\n\n**Temperatura de color y D.S. N°1/2022**\n\nSe pide en 2200K, con 1% de luz azul, o en 2700K, con 7%.',
    });
    expect(section.some(p => p.startsWith(NEXT_TO_NORM))).toBe(true);
    expect(checkRules({ ...good, keyBenefits: [...good.keyBenefits, '2200K con 1% de luz azul, para el D.S. N°1/2022'] }).some(p => p.startsWith(NEXT_TO_NORM))).toBe(true);

    // El dato en su bloque y la asesoría en otro: se acepta (decisión del dueño)
    const apart = checkRules({
      ...good,
      description: good.description + '\n\n**Temperatura de color**\n\nSe pide en 2200K, con 1% de luz azul, o en 2700K, con 7%.',
      keyBenefits: [...good.keyBenefits, 'Cálidas de 2200K (1% de luz azul) y 2700K (7% de luz azul)'],
      faq: [
        ...good.faq,
        {
          question: '¿Qué hago si mi proyecto debe cumplir el D.S. N°1/2022?',
          answer: 'Escríbenos a ventas@elights.cl con la comuna y el tipo de alumbrado, y te asesoramos en la luminaria y la documentación que corresponden.',
        },
      ],
    });
    expect(apart.filter(p => p.includes('luz azul'))).toEqual([]);
  });

  // Líneas con certificado D.S. N°1 (decisión del dueño, 22-10-2026; 8 líneas, 33 productos),
  // cada una con sus versiones certificadas: la solar industrial All in One, en 2200K y 2700K
  it('D.S. N°1: en una línea certificada acepta el certificado de las versiones de 2200K y 2700K, y nada más', () => {
    const solar = DS1_CERTIFIED_LINES.solarIndustrial.ids[0];
    const ds1 = (problems: string[]) => problems.filter(p => /D\.S\. N°1|DS1|luz azul/.test(p));
    const certified = (text: string) => ds1(checkRules({ ...good, description: text }, solar));
    for (const text of [
      'Las versiones cálidas de 2200K y 2700K tienen certificado D.S. N°1/2022 de contaminación lumínica; al cotizar, pide el certificado de la versión que elijas.',
      '**Certificado D.S. N°1/2022 en 2200K y 2700K**\n\nAl cotizar, pide el certificado de la versión que elijas.',
      'Se cotiza en 2200K, 2700K, 4000K y 5000K. Las cálidas, de 2200K y 2700K, tienen certificado D.S. N°1/2022.',
    ]) {
      expect(certified(text), text).toEqual([]);
    }
    expect(
      ds1(
        checkRules(
          { ...good, faq: [...good.faq, { question: '¿Qué versiones tienen certificado D.S. N°1/2022?', answer: 'Las de luz cálida, de 2200K y 2700K, tienen certificado D.S. N°1/2022.' }] },
          solar,
        ),
      ),
    ).toEqual([]);

    const cases: [string, RegExp][] = [
      ['Tiene certificado D.S. N°1/2022 de contaminación lumínica.', /sin decir de qué versiones/],
      ['**Certificado D.S. N°1/2022**\n\nAl cotizar, pide el certificado de la versión que elijas.', /sin decir de qué versiones/],
      ['Las versiones de 2200K, 2700K y 4000K tienen certificado D.S. N°1/2022.', /junto a una versión sin certificado \(4000K/],
      ['La de 5000K es apta para Áreas de Protección Especial.', /sin decir de qué versiones/],
      ['Todas sus versiones, incluida la de 2700K, tienen certificado D.S. N°1/2022.', /de todas las versiones/],
      ['Versiones de 2200K y 2700K con certificación DS1.', /sigla «DS1»/],
      ['Las de 2200K (1% de luz azul) y 2700K (7% de luz azul) tienen certificado D.S. N°1/2022.', /% de luz azul junto a la norma/],
    ];
    for (const [text, problem] of cases) {
      expect(certified(text).some(p => problem.test(p)), text).toBe(true);
    }

    // Lo mismo en un producto fuera de las líneas certificadas (o sin id): sin certificado
    const text = 'Las versiones cálidas de 2200K y 2700K tienen certificado D.S. N°1/2022.';
    expect(ds1(checkRules({ ...good, description: text }))).toContainEqual(expect.stringContaining('afirma el D.S. N°1 sin certificado documentado'));
    expect(ds1(checkRules({ ...good, description: text }, 7))).toContainEqual(expect.stringContaining('afirma el D.S. N°1 sin certificado documentado'));
  });

  // Proyectores de estadio: decisión del dueño del 23-10-2026, que reemplaza «todas sus versiones»
  // (22-10): certificado solo en las versiones de hasta 5000K
  it('D.S. N°1: los proyectores de estadio dicen su certificado solo en sus versiones de hasta 5000K, y sin luz azul (los recintos deportivos van por temperatura de color)', () => {
    const sports = { ...good, useCases: ['Canchas de fútbol', 'Estadios', 'Gimnasios techados sin muros'] };
    const claim = 'Para alumbrado deportivo, su versión cálida de 3000K tiene certificado D.S. N°1/2022, la norma de contaminación lumínica. La fría de 6000K no lo tiene.';
    const ds1 = (problems: string[]) => problems.filter(p => /D\.S\. N°1|DS1|luz azul/.test(p));
    for (const stadium of [DS1_CERTIFIED_LINES.estadioModular.ids[0], DS1_CERTIFIED_LINES.estadio.ids[0]]) {
      expect(ds1(checkRules({ ...sports, description: claim }, stadium)), String(stadium)).toEqual([]);
      expect(
        ds1(checkRules({ ...sports, description: 'Sus versiones cálida de 2700K, neutra de 4000K y fría de 5000K tienen certificado D.S. N°1/2022.' }, stadium)),
        String(stadium),
      ).toEqual([]);
      // Sin límite, en una versión de más de 5000K o en «todas sus versiones»: no
      for (const [text, problem] of [
        ['Este proyector tiene certificado D.S. N°1/2022, la norma de contaminación lumínica.', /sin decir de qué versiones \(solo las de hasta 5000K\)/],
        ['Las de 5000K y 6500K tienen certificado D.S. N°1/2022.', /junto a una versión sin certificado \(6500K/],
        ['Tiene certificado D.S. N°1/2022 en todas sus versiones, como la de 4000K.', /de todas las versiones/],
        ['Las de 3000K y la fría tienen certificado D.S. N°1/2022.', /junto a una versión sin certificado \(fría/],
        ['La de 3000K tiene certificado D.S. N°1/2022. La versión de 6000K está certificada.', /extiende el certificado D\.S\. N°1 a una versión sin certificado \(6000K/],
      ] as const) {
        expect(ds1(checkRules({ ...sports, description: text }, stadium)).some(p => problem.test(p)), `${stadium}: ${text}`).toBe(true);
      }
      expect(checkRules({ ...sports, description: `${claim}\n\nLa de 2700K declara 7% de luz azul.` }, stadium)).toContainEqual(
        expect.stringContaining('menciona la luz azul en una ficha de canchas'),
      );
      expect(checkRules({ ...sports, description: 'Certificación SEC y DS1.' }, stadium)).toContainEqual(expect.stringContaining('sigla «DS1»'));
      // Aunque la ficha no nombre la cancha ni el alumbrado deportivo: la regla va por línea
      const plain = { ...good, description: 'Su versión cálida de 3000K tiene certificado D.S. N°1/2022.\n\nLa de 2700K tiene un 7% de luz azul.' };
      expect(checkRules(plain, stadium), String(stadium)).toContainEqual(expect.stringContaining('proyector de recintos deportivos'));
    }
    // En un producto de otra línea, ese dato en su propia sección no es un problema
    const solar = DS1_CERTIFIED_LINES.solarIndustrial.ids[0];
    expect(checkRules({ ...good, description: 'La de 2700K tiene un 7% de luz azul.' }, solar).filter(p => /luz azul/.test(p))).toEqual([]);
  });

  it('D.S. N°1: en un proyector de estadio, checkFacts acepta el certificado solo en las versiones de hasta 5000K que tiene entre sus variantes', () => {
    const ds1 = (problems: string[]) => problems.filter(p => /D\.S\. N°1/.test(p));
    const [estadio300, , estadio600] = DS1_CERTIFIED_LINES.estadio.ids;
    const stadium = (id: number, colors: string[]) =>
      productFacts(
        { ...product, jumpseller_id: id, variants: colors.map((value, i) => ({ id: i, sku: '', price: 1, options: [{ name: 'Color de Temperatura', value }] })) },
        description,
        {},
      );
    const facts300 = stadium(estadio300, ['Luz Cálida - 3000K', 'Luz Fría- 6000K']);
    const facts600 = stadium(estadio600, ['Luz Fría- 6000K']);
    const ok = 'Para alumbrado deportivo, su versión cálida de 3000K tiene certificado D.S. N°1/2022. La fría de 6000K no lo tiene.';
    expect(ds1(checkFacts({ ...good, description: ok }, facts300))).toEqual([]);
    // Una versión de hasta 5000K que el producto no tiene
    expect(ds1(checkFacts({ ...good, description: 'La de 4000K tiene certificado D.S. N°1/2022.' }, facts300))).toContainEqual(
      expect.stringContaining('en una versión que el producto no tiene (4000K; sus variantes: 3000K y 6000K)'),
    );
    // Sin ninguna versión de hasta 5000K: no se afirma (ofrece asesoría)
    expect(ds1(checkFacts({ ...good, description: 'Este proyector tiene certificado D.S. N°1/2022.' }, facts600))).toContainEqual(
      expect.stringContaining('no tiene versiones de hasta 5000K'),
    );
    expect(ds1(checkFacts({ ...good, description: '¿Necesitas el D.S. N°1/2022? Te asesoramos: escríbenos a ventas@elights.cl.' }, facts600))).toEqual([]);
    // También en la respuesta a la pregunta por el certificado y en la oración que sigue con «también»
    const faq = (question: string, answer: string) => ({ ...good, faq: [...good.faq.slice(1), { question, answer }] });
    expect(ds1(checkFacts(faq('¿Qué versiones tienen certificado D.S. N°1/2022?', 'Para alumbrado deportivo, la de 2700K.'), facts300))).toContainEqual(
      expect.stringContaining('en una versión que el producto no tiene (2700K; sus variantes: 3000K y 6000K)'),
    );
    expect(ds1(checkFacts({ ...good, description: 'La de 3000K tiene certificado D.S. N°1/2022. La de 4000K, también.' }, facts300))).toContainEqual(
      expect.stringContaining('en una versión que el producto no tiene (4000K'),
    );
  });

  it('D.S. N°1: en los estadios de 300 y 500W, que tienen dos versiones (una de 6000K), ni «ambas» ni «sus dos versiones», ni la respuesta ni el «también» que la extienden', () => {
    const ds1 = (problems: string[]) => problems.filter(p => /D\.S\. N°1/.test(p));
    const [estadio300, estadio500] = DS1_CERTIFIED_LINES.estadio.ids;
    expect([estadio300, estadio500]).toEqual([3313196, 3283555]);
    for (const [id, warm] of [
      [estadio300, '3000K'],
      [estadio500, '2200K'],
    ] as const) {
      for (const [text, problem] of [
        [`Ambas versiones, incluida la cálida de ${warm}, tienen certificado D.S. N°1/2022.`, /de todas las versiones/],
        [`Sus dos versiones, incluida la de ${warm}, tienen certificado D.S. N°1/2022.`, /de todas las versiones/],
        [`Las dos versiones tienen certificado D.S. N°1/2022: la de ${warm} y la otra.`, /de todas las versiones/],
        [`La de ${warm} tiene certificado D.S. N°1/2022, igual que la otra versión.`, /también en otra versión, sin nombrarla/],
        [`La de ${warm} tiene certificado D.S. N°1/2022. La de 6000K, también.`, /extiende el certificado D\.S\. N°1 a una versión sin certificado \(6000K/],
        [`La de ${warm} y la luz de día tienen certificado D.S. N°1/2022.`, /junto a una versión sin certificado \(luz de día/],
      ] as const) {
        expect(ds1(checkRules({ ...good, description: text }, id)).some(p => problem.test(p)), `${id}: ${text}`).toBe(true);
      }
      const answer = { ...good, faq: [...good.faq.slice(1), { question: '¿Qué versiones tienen certificado D.S. N°1/2022?', answer: `La cálida de ${warm} y la fría de 6000K.` }] };
      expect(ds1(checkRules(answer, id)), String(id)).toContainEqual(expect.stringContaining('extiende el certificado D.S. N°1 a una versión sin certificado (6000K'));
      const ok = { ...good, description: `Para alumbrado deportivo, su versión cálida de ${warm} tiene certificado D.S. N°1/2022. La fría de 6000K no lo tiene.` };
      expect(ds1(checkRules(ok, id)), String(id)).toEqual([]);
    }
  });

  it('D.S. N°1: en los Slim SMD la de 3000K no tiene certificado, y en la Pagoda solar UFO son la de 1600K y la de 2700K', () => {
    const ds1 = (problems: string[]) => problems.filter(p => /D\.S\. N°1/.test(p));
    const slim = DS1_CERTIFIED_LINES.slim.ids[0];
    expect(ds1(checkRules({ ...good, description: 'Las versiones de 2200K y 2700K tienen certificado D.S. N°1/2022.' }, slim))).toEqual([]);
    expect(ds1(checkRules({ ...good, description: 'Las cálidas de 2200K, 2700K y 3000K tienen certificado D.S. N°1/2022.' }, slim))).toContainEqual(
      expect.stringContaining('junto a una versión sin certificado (3000K'),
    );
    const pagoda = DS1_CERTIFIED_LINES.pagoda.ids[0];
    expect(ds1(checkRules({ ...good, description: 'Sus versiones ámbar de 1600K y cálida de 2700K tienen certificado D.S. N°1/2022.' }, pagoda))).toEqual([]);
    expect(ds1(checkRules({ ...good, description: 'La de 2200K tiene certificado D.S. N°1/2022.' }, pagoda))).toContainEqual(
      expect.stringContaining('solo las de 1600K y 2700K'),
    );
    // Cuáles no lo tienen va en otra oración, sin nombrar la norma
    for (const [id, text] of [
      [slim, 'Las versiones cálidas de 2200K y 2700K tienen certificado D.S. N°1/2022. La de 3000K y la fría de 6500K no lo tienen.'],
      [pagoda, 'Sus versiones ámbar de 1600K y cálida de 2700K tienen certificado D.S. N°1/2022. La neutra de 4000K y la fría de 5000K no lo tienen.'],
    ] as const) {
      expect(ds1(checkRules({ ...good, description: text }, id)), text).toEqual([]);
    }
  });

  it('D.S. N°1: en las líneas certificadas por versión, tampoco lo extiende a una versión nombrada sin «K», por su tono o en otra oración', () => {
    const ds1 = (problems: string[]) => problems.filter(p => /D\.S\. N°1/.test(p));
    for (const id of [DS1_CERTIFIED_LINES.slim.ids[0], DS1_CERTIFIED_LINES.island.ids[0]]) {
      for (const text of [
        // En la oración del certificado: el tono o la cifra sin «K»
        'Las versiones de 2200K, 2700K y la fría tienen certificado D.S. N°1/2022.',
        'La de 2700K y la neutra tienen certificado D.S. N°1/2022.',
        'Las cálidas de 2200K, 2700K y 3000 tienen certificado D.S. N°1/2022.',
        // En otra oración, sin nombrar la norma
        'Las de 2200K y 2700K tienen certificado D.S. N°1/2022. La de 3000K también lo tiene.',
        'Las de 2200K y 2700K tienen certificado D.S. N°1/2022. La versión de 4000K está certificada.',
        'Las de 2200K y 2700K tienen certificado D.S. N°1/2022. La de 4000K tiene el mismo certificado.',
      ]) {
        expect(ds1(checkRules({ ...good, description: text }, id)), `${id}: ${text}`).not.toEqual([]);
      }
      for (const text of [
        // El año de la norma, una fecha o un flujo no son temperaturas de color
        'Sus versiones de 2200K y 2700K tienen certificado D.S. N°1/2022, exigible desde el 19-10-2026 en todo Chile.',
        'La de 2700K, con 9.000 lm, tiene certificado D.S. N°1/2022.',
        // Decir cuáles no lo tienen, preguntarlo o nombrar la certificación SEC está bien
        'Las de 2200K y 2700K tienen certificado D.S. N°1/2022. La de 3000K y la fría no lo tienen.',
        '¿La de 4000K también lo tiene?',
        'Está certificado por la SEC y se ofrece en luz fría de 6500K o en luz cálida de 2700K.',
      ]) {
        expect(ds1(checkRules({ ...good, description: text }, id)), `${id}: ${text}`).toEqual([]);
      }
    }
  });

  it('D.S. N°1: la Island (ornamental) dice su certificado en 2200K y 2700K, sin nombrar en esa oración la 4000K ni la 5000K', () => {
    const ds1 = (problems: string[]) => problems.filter(p => /D\.S\. N°1|DS1/.test(p));
    const ok = 'Sus versiones cálidas, de 2200K y 2700K, tienen certificado D.S. N°1/2022. También se ofrece en neutra de 4000K y en fría de 5000K.';
    for (const id of DS1_CERTIFIED_LINES.island.ids) {
      expect(ds1(checkRules({ ...good, description: ok }, id)), String(id)).toEqual([]);
      // En la misma oración, la temperatura sin certificado se lee como certificada
      const joined = 'Tiene certificado D.S. N°1/2022 en 2200K y 2700K, no en 4000K ni 5000K.';
      expect(ds1(checkRules({ ...good, description: joined }, id)), String(id)).toContainEqual(expect.stringContaining('junto a una versión sin certificado'));
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
