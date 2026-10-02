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
    { question: '¿Cuánto demora el despacho?', answer: 'eLIGHTS despacha a todo Chile en hasta 2 días hábiles, con camiones propios en la Provincia de Santiago.' },
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
