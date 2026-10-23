// src/data/guides/text.ts
// El texto plano de una guía, como se lee en la página: lo usan las pruebas (reglas del sitio y
// del D.S. N°1/2022 sobre el contenido) y el índice de secciones. Sin dependencias.

import { ds1ItemSentence } from './ds1-block';
import type { GuideBlock, GuideContent, GuideLink, GuideSection, Inline, Rich } from './types';

/**
 * Qué trozos condicionales se leen: 'all' los incluye todos (la versión más larga del texto, la
 * que se publica cuando existan todas las guías que nombra); 'published' solo los de guías ya
 * publicadas (lo que se ve hoy).
 */
export interface TextOptions {
  guides?: 'all' | ((slug: string) => boolean);
}

const shows = (slug: string, o: TextOptions) => (typeof o.guides === 'function' ? o.guides(slug) : true);

export function richText(rich: Rich, o: TextOptions = {}): string {
  return rich.map(part => inlineText(part, o)).join('');
}

function inlineText(part: Inline, o: TextOptions): string {
  if (typeof part === 'string') return part;
  if ('b' in part) return part.b;
  if ('ifGuide' in part) return shows(part.ifGuide, o) ? richText(part.parts, o) : '';
  return part.text;
}

/** Los textos de un bloque, cada uno por separado (un párrafo, un ítem de lista o una fila de tabla). */
export function blockTexts(block: GuideBlock, o: TextOptions = {}): string[] {
  switch (block.type) {
    case 'p':
      return [richText(block.content, o)].filter(Boolean);
    case 'list':
      return block.items.map(item => richText(item, o));
    case 'table':
      // Cada fila se lee como una oración (así la revisa el detector del D.S. N°1/2022)
      return [block.head.join(' '), ...block.rows.map(row => row.map(cell => richText(cell, o)).join(' '))];
    case 'ds1-lines':
      return block.items.map(ds1ItemSentence);
  }
}

/** Los textos de una sección: el H2, sus bloques y cada H3 con los suyos. */
export function sectionTexts(section: GuideSection, o: TextOptions = {}): string[] {
  return [
    section.title,
    ...section.blocks.flatMap(b => blockTexts(b, o)),
    ...(section.subsections ?? []).flatMap(sub => [sub.title, ...sub.blocks.flatMap(b => blockTexts(b, o))]),
  ];
}

/** Todos los textos propios de la guía (sin el pie del sitio ni los datos del autor). */
export function guideTexts(c: GuideContent, o: TextOptions = {}): string[] {
  return [
    ...c.answer.map(p => richText(p, o)),
    ...c.sections.flatMap(s => sectionTexts(s, o)),
    c.finalBox.title,
    c.finalBox.text,
    c.finalBox.button.label,
    ...c.sources.map(s => s.label),
    ...c.history.map(h => h.change),
    ...c.related.flatMap(r => [r.title, r.text]),
  ];
}

/** Todos los enlaces de un texto, con su sección (los de los trozos condicionales también). */
export function richLinks(rich: Rich): { text: string; to: GuideLink; ifGuide?: string }[] {
  return rich.flatMap(part => {
    if (typeof part === 'string' || 'b' in part) return [];
    if ('ifGuide' in part) return richLinks(part.parts).map(l => ({ ...l, ifGuide: l.ifGuide ?? part.ifGuide }));
    return [{ text: part.text, to: part.to }];
  });
}

function blockLinks(block: GuideBlock): { text: string; to: GuideLink; ifGuide?: string }[] {
  switch (block.type) {
    case 'p':
      return richLinks(block.content);
    case 'list':
      return block.items.flatMap(richLinks);
    case 'table':
      return block.rows.flatMap(row => row.flatMap(richLinks));
    case 'ds1-lines':
      return block.items.filter(item => !item.noLink).map(item => ({ text: item.name, to: { products: item.products } }));
  }
}

/** Los enlaces de una guía, sección por sección (id de la sección o 'answer'), más las guías relacionadas. */
export function guideLinks(c: GuideContent): { section: string; text: string; to: GuideLink; ifGuide?: string; outdoor?: true }[] {
  return [
    ...c.answer.flatMap(p => richLinks(p).map(l => ({ section: 'answer', ...l }))),
    ...c.sections.flatMap(s =>
      [...s.blocks, ...(s.subsections ?? []).flatMap(sub => sub.blocks)].flatMap(b =>
        blockLinks(b).map(l => ({ section: s.id, ...l, ...(s.outdoor ? { outdoor: true as const } : {}) })),
      ),
    ),
    ...c.related.map(r => ({ section: 'guias-relacionadas', text: r.title, to: { guide: r.guide } as GuideLink })),
  ];
}
