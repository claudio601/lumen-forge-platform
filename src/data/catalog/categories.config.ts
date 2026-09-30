// src/data/catalog/categories.config.ts
// Configuración liviana del catálogo: categorías del sitio, categorías "de proyecto",
// búsquedas populares y el mapa de categorías principales de Jumpseller.
// Header, Footer y la portada importan desde aquí para que el bundle principal no
// incluya el arreglo de productos. Solo imports relativos (lo usan también scripts/).

import type { Category } from './types';

export const PROJECT_CATEGORIES = [
    'alumbrado-publico',
    'iluminacion-exterior',
    'solar',
    'lineales-led',
    'emergencia-led',
    'iluminacion-antiexplosiva',
    'poste',
  ];
export const categories: Category[] = [
  { id: 'proyectores-led', name: 'Proyectores LED', slug: 'proyectores-led', icon: 'Projector', productCount: 68, subcategories: [] },
  { id: 'paneles-led', name: 'Paneles LED', slug: 'paneles-led', icon: 'PanelTop', productCount: 72, subcategories: [] },
  { id: 'iluminacion-exterior', name: 'Iluminación Exterior', slug: 'iluminacion-exterior', icon: 'SunMedium', productCount: 36, subcategories: [] },
  { id: 'campanas-led', name: 'Campanas LED', slug: 'campanas-led', icon: 'Warehouse', productCount: 26, subcategories: [] },
  { id: 'solar', name: 'Solar', slug: 'solar', icon: 'Sun', productCount: 11, subcategories: [] },
  { id: 'alumbrado-publico', name: 'Alumbrado Público', slug: 'alumbrado-publico', icon: 'RadioTower', productCount: 8, subcategories: [] },
  { id: 'cinta-led', name: 'Cinta LED', slug: 'cinta-led', icon: 'Waves', productCount: 19, subcategories: [] },
  { id: 'tubos-led', name: 'Tubos LED', slug: 'tubos-led', icon: 'TestTube', productCount: 17, subcategories: [] },
  { id: 'lineales-led', name: 'Lineales LED', slug: 'lineales-led', icon: 'Ruler', productCount: 10, subcategories: [] },
  { id: 'fuentes-de-poder', name: 'Fuentes de Poder', slug: 'fuentes-de-poder', icon: 'PlugZap', productCount: 14, subcategories: [] },
  { id: 'iluminacion-antiexplosiva', name: 'Iluminación Antiexplosiva', slug: 'iluminacion-antiexplosiva', icon: 'ShieldAlert', productCount: 13, subcategories: [] },
  { id: 'emergencia-led', name: 'Emergencia LED', slug: 'emergencia-led', icon: 'Siren', productCount: 11, subcategories: [] },
  { id: 'focos-a-riel', name: 'Focos a Riel', slug: 'focos-a-riel', icon: 'TrainTrack', productCount: 10, subcategories: [] },
  { id: 'ampolletas-led', name: 'Ampolletas LED', slug: 'ampolletas-led', icon: 'Lightbulb', productCount: 6, subcategories: [] },
  { id: 'poste', name: 'Poste', slug: 'poste', icon: 'UtilityPole', productCount: 3, subcategories: [] },
];

export const popularSearches = [
  'Panel LED',
  'Proyector LED',
  'Campana LED',
  'Tubo LED',
  'Cinta LED',
  'Alumbrado Público',
];

/**
 * Categorías principales (parent_id = null) de Jumpseller → slug del sitio.
 * Verificado contra la tienda el 2026-09-30. Las subcategorías de Jumpseller se
 * resuelven subiendo por parent_id hasta una de estas.
 */
export const JUMPSELLER_TOP_CATEGORY_TO_SLUG: Readonly<Record<number, string>> = {
  285716: 'ampolletas-led',
  286961: 'tubos-led',
  286969: 'paneles-led',
  286977: 'cinta-led',
  286980: 'proyectores-led',
  286988: 'campanas-led',
  286996: 'iluminacion-exterior',
  287004: 'lineales-led',
  287009: 'emergencia-led',
  287014: 'fuentes-de-poder',
  297140: 'iluminacion-antiexplosiva',
  380811: 'solar',
  383327: 'alumbrado-publico',
  407229: 'focos-a-riel',
  1637360: 'poste',
};

/** Categorías principales de Jumpseller que el sitio ignora a propósito. */
export const IGNORED_JUMPSELLER_CATEGORY_IDS: readonly number[] = [
  285715, // Ofertas Flash (colección promocional, no es una familia de productos)
];
