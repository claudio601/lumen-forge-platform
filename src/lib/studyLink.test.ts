// Caja «Estudio DIALux (servicio cotizado)» (auditoría UX, E-02): qué fichas la llevan, a dónde
// lleva, qué preselecciona en el formulario y qué no dice nunca.

import { describe, expect, it } from 'vitest';
import { products } from '@/data/products';
import { categories } from '@/data/catalog/categories.config';
import { STUDY_BOX_CATEGORIES, STUDY_BOX_EXCLUDED, studyBoxHref, studyPrefill, studyProductNote } from './studyLink';
import { DIALUX_BOX_TEXT } from '@/config/navigation';
import { validateEstudioPayload } from '../../api/_lib/forms/estudioLuminicoValidation';

const SITE = 'https://nuevo.elights.cl';
const url = (path: string) => SITE + path;
const TIPOS = ['cancha_deportiva', 'industria_bodega', 'estacionamiento', 'edificio_comercial', 'vialidad_exterior', 'proyecto_especial'];

describe('caja del estudio DIALux: qué fichas la llevan', () => {
  it('las cinco categorías de la auditoría, todas del sitio', () => {
    expect(Object.keys(STUDY_BOX_CATEGORIES).sort()).toEqual(
      ['alumbrado-publico', 'campanas-led', 'iluminacion-antiexplosiva', 'proyectores-led', 'solar'],
    );
    const slugs = categories.map(c => c.slug);
    for (const slug of Object.keys(STUDY_BOX_CATEGORIES)) expect(slugs).toContain(slug);
  });

  it('cada tipo preseleccionado lo acepta el servidor', () => {
    for (const tipo of Object.values(STUDY_BOX_CATEGORIES).filter(Boolean)) {
      const { errors } = validateEstudioPayload({ tipoProyecto: tipo });
      expect(errors.join(' '), String(tipo)).not.toMatch(/tipoProyecto/);
    }
  });

  it('la llevan las fichas de esas categorías (también como categoría secundaria), salvo las excluidas, y ninguna otra', () => {
    let withBox = 0;
    for (const p of products) {
      const inList = (p.categories.some(c => c in STUDY_BOX_CATEGORIES) || p.category in STUDY_BOX_CATEGORIES) && !(p.jumpseller_id in STUDY_BOX_EXCLUDED);
      const href = studyBoxHref(p);
      expect(Boolean(href), p.id).toBe(inList);
      if (href) withBox++;
    }
    expect(withBox).toBeGreaterThan(0);
    expect(withBox).toBeLessThan(products.length);
  });

  it('no la llevan los productos que no son una luminaria para calcular (el trípode, la señalética)', () => {
    const base = { id: 'tripode-para-proyector-led', category: 'proyectores-led', categories: ['proyectores-led'] };
    expect(studyBoxHref({ ...base, jumpseller_id: 3770404 })).toBeNull();
    expect(studyBoxHref({ ...base, jumpseller_id: 1 })).not.toBeNull();
    // Cada excluido que sigue en el catálogo está en una de esas categorías (si no, sobra en la lista)
    for (const id of Object.keys(STUDY_BOX_EXCLUDED).map(Number)) {
      const p = products.find(x => x.jumpseller_id === id);
      if (!p) continue;
      expect([p.category, ...p.categories].some(c => c in STUDY_BOX_CATEGORIES), String(id)).toBe(true);
      expect(studyBoxHref(p), p.id).toBeNull();
    }
  });

  it('cada id de ficha tiene la forma que acepta el formulario', () => {
    for (const p of products) expect(studyPrefill(`?producto=${p.id}`, TIPOS, url).descripcionProyecto, p.id).toBe(studyProductNote(url(`/producto/${p.id}`)));
  });
});

describe('caja del estudio DIALux: a dónde lleva', () => {
  const base = { id: 'producto-de-prueba-100w', categories: [] as string[] };

  it('campana: /estudio-luminico?tipo=industria_bodega&producto=<id>#solicitar', () => {
    expect(studyBoxHref({ ...base, category: 'campanas-led', categories: ['campanas-led'] }))
      .toBe('/estudio-luminico?tipo=industria_bodega&producto=producto-de-prueba-100w#solicitar');
  });

  it('proyector: sin tipo (lo elige el cliente), salvo que otra categoría lo dé', () => {
    expect(studyBoxHref({ ...base, category: 'proyectores-led', categories: ['proyectores-led'] }))
      .toBe('/estudio-luminico?producto=producto-de-prueba-100w#solicitar');
    expect(studyBoxHref({ ...base, category: 'proyectores-led', categories: ['proyectores-led', 'alumbrado-publico'] }))
      .toBe('/estudio-luminico?tipo=vialidad_exterior&producto=producto-de-prueba-100w#solicitar');
  });

  it('panel: sin caja', () => {
    expect(studyBoxHref({ ...base, category: 'paneles-led', categories: ['paneles-led'] })).toBeNull();
  });
});

describe('formulario del estudio: lo que preselecciona la dirección', () => {
  it('tipo del formulario y ficha de referencia', () => {
    expect(studyPrefill('?tipo=industria_bodega&producto=campana-ufo-200w', TIPOS, url)).toEqual({
      tipoProyecto: 'industria_bodega',
      descripcionProyecto: 'Producto de referencia: https://nuevo.elights.cl/producto/campana-ufo-200w',
    });
  });

  it('nada más de la URL llega al formulario: tipos desconocidos e ids con otra forma se ignoran', () => {
    expect(studyPrefill('', TIPOS, url)).toEqual({});
    expect(studyPrefill('?tipo=otro&producto=', TIPOS, url)).toEqual({});
    for (const producto of ['<script>alert(1)</script>', 'https://otro.cl', '../admin', 'A-MAYUSCULA', 'con espacio', 'x'.repeat(200)]) {
      expect(studyPrefill(`?producto=${encodeURIComponent(producto)}`, TIPOS, url), producto).toEqual({});
    }
  });
});

describe('caja del estudio DIALux: el texto', () => {
  const all = Object.values(DIALUX_BOX_TEXT).join(' ');

  it('dice que el estudio es un servicio cotizado', () => {
    expect(DIALUX_BOX_TEXT.title).toBe('Estudio DIALux (servicio cotizado)');
    expect(DIALUX_BOX_TEXT.text).toMatch(/cotizamos/);
  });

  it('nunca gratis, sin costo ni descontable, y sin plazo (las 48 horas van solo en / y /estudio-luminico)', () => {
    expect(all).not.toMatch(/gratis|sin costo|sin cargo|descontable|cortes[ií]a|te lo calculamos/i);
    expect(all).not.toMatch(/\d|\bhoras?\b|\bd[ií]as?\b|\bplazo|inmediat|r[aá]pid/i);
  });
});
