import { describe, it, expect } from 'vitest';
import {
  categories,
  PROJECT_CATEGORIES,
  JUMPSELLER_TOP_CATEGORY_TO_SLUG,
  IGNORED_JUMPSELLER_CATEGORY_IDS,
} from './categories.config';
import { products } from '../products';

const slugs = categories.map(c => c.slug);

describe('categorías del sitio', () => {
  it('los slugs son únicos y coinciden con el id', () => {
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const c of categories) expect(c.id).toBe(c.slug);
  });

  it('las categorías de proyecto existen en el sitio', () => {
    for (const slug of PROJECT_CATEGORIES) expect(slugs).toContain(slug);
  });

  it('cada producto pertenece a una categoría del sitio', () => {
    for (const p of products) expect(slugs).toContain(p.category);
  });
});

describe('mapa de categorías principales de Jumpseller', () => {
  const entries = Object.entries(JUMPSELLER_TOP_CATEGORY_TO_SLUG);

  it('cubre las 15 categorías del sitio, cada una exactamente una vez', () => {
    const mapped = entries.map(([, slug]) => slug).sort();
    expect(mapped).toEqual([...slugs].sort());
  });

  it('"Ofertas Flash" (285715) se ignora y no está mapeada', () => {
    expect(IGNORED_JUMPSELLER_CATEGORY_IDS).toContain(285715);
    expect(JUMPSELLER_TOP_CATEGORY_TO_SLUG).not.toHaveProperty('285715');
  });
});
