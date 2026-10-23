// src/data/guides/index.ts
// Lista liviana de las guías publicadas (plan del blog, §5.1): la ficha de cada una, sin su
// cuerpo, que vive en ./content/<slug>.ts y se carga a pedido (./content.ts). En el repo solo
// hay guías aprobadas por el dueño: un borrador vive fuera del repo. Para despublicar una guía
// se sacan su ficha de aquí y su archivo de content/ (guides.test.ts exige que coincidan).
// Solo imports relativos: lo importa src/lib/seo/routes.ts, que también corre en scripts/.

import { GUIDES_PATH, guidePath } from './paths';
import type { GuideAuthor, GuideAuthorKey, GuideMeta, GuidePillar } from './types';

export { GUIDES_PATH, guidePath, PLANNED_GUIDE_SLUGS } from './paths';

/** Pilares (plan §1.1), en el orden del índice /guias. */
export const GUIDE_PILLARS: readonly { key: GuidePillar; name: string }[] = [
  { key: 'norma-luminica', name: 'Norma lumínica (D.S. N°1/2022)' },
  { key: 'proyectos', name: 'Proyectos de iluminación: dimensionar y planificar' },
];

/** Autores (plan §1.7): la firma y las líneas de experiencia que aprobó el dueño el 23-10-2026. */
export const GUIDE_AUTHORS: Readonly<Record<GuideAuthorKey, GuideAuthor>> = {
  'claudio-quero': {
    name: 'Claudio Quero',
    bio:
      'eCommerce manager de eLIGHTS.cl, especialista en iluminación desde 2016. Prepara las cotizaciones de los proyectos de ' +
      'iluminación de los clientes, los orienta cuando el proyecto no tiene una especificación clara y propone homologaciones ' +
      'con productos eLIGHTS cuando el mandante lo permite.',
    path: '/empresa',
  },
};

/** Las guías publicadas, en orden de publicación. */
export const GUIDES: readonly GuideMeta[] = [
  {
    // G1, el pilar de la norma lumínica. Texto aprobado por el dueño el 23-10-2026 (v2).
    slug: 'norma-luminica-ds-1-2022',
    h1: 'Norma lumínica (D.S. N°1/2022): qué revisar en un proyecto de alumbrado exterior',
    metaTitle: 'Norma lumínica D.S. N°1/2022: qué revisar al cotizar',
    metaDescription:
      'Desde cuándo se exige la norma lumínica, qué pide según el tipo de alumbrado y qué revisar antes de cotizar luminarias para un proyecto exterior.',
    pillar: 'norma-luminica',
    isPillar: true,
    target: 'norma lumínica',
    intent: 'normativa',
    // «Publicada el» es el día en que la guía sale en el sitio y no cambia nunca (plan §1.7). Si la
    // fusión a main no es el 23-10-2026, ese día se cambian estas tres fechas y la primera línea
    // del historial (content/<slug>.ts), y se vuelven a revisar las fuentes («Plazos revisados»,
    // «Fuentes revisadas» y cada `reviewed`).
    datePublished: '2026-10-23T00:00:00-03:00',
    dateModified: '2026-10-23T00:00:00-03:00',
    publishedLabel: '23-10-2026',
    author: 'claudio-quero',
    // Publicada sin indexar hasta el OK del dueño (plan §2.2, decisión 16)
    index: false,
  },
];

/** La ficha de una guía publicada, o undefined. */
export const guideMeta = (slug: string): GuideMeta | undefined => GUIDES.find(g => g.slug === slug);

/** ¿La guía está publicada? Un enlace a una guía que no lo está se esconde solo (plan §1.5). */
export const isPublishedGuide = (slug: string) => GUIDES.some(g => g.slug === slug);

/** El título completo de la pestaña: «<metaTitle> | eLIGHTS» (formato de las fichas, plan §5.3). */
export const guideTitle = (meta: Pick<GuideMeta, 'metaTitle'>) => `${meta.metaTitle} | eLIGHTS`;

/** La guía pilar publicada de un tema, si existe (las migas solo enlazan páginas que existen). */
export const pillarGuide = (pillar: GuidePillar): GuideMeta | undefined => GUIDES.find(g => g.pillar === pillar && g.isPillar);

/**
 * El índice /guias (plan §5.4): H1 neutro a propósito, para no competir con la guía pilar por
 * «norma lumínica».
 */
export const GUIDES_INDEX = {
  h1: 'Guías de iluminación LED para proyectos',
  metaTitle: 'Guías de iluminación LED para proyectos',
  metaDescription:
    'Guías prácticas para proyectos de iluminación LED en Chile: qué exige la norma lumínica, qué revisar y qué datos reunir antes de cotizar.',
  intro: 'Guías prácticas para quienes preparan un proyecto de iluminación: qué exige la norma, qué revisar y qué datos reunir antes de cotizar.',
} as const;

/** Migas del índice /guias. */
export const GUIDES_INDEX_CRUMBS: readonly { name: string; path: string }[] = [
  { name: 'Inicio', path: '/' },
  { name: 'Guías', path: GUIDES_PATH },
];

/**
 * Migas de una guía (plan §1.3): Inicio › Guías › [Pilar] › Guía. Sin el nivel del pilar en la
 * guía que es el propio pilar, ni mientras la guía pilar de su tema no esté publicada: cada miga
 * del JSON-LD lleva una URL, y no puede apuntar a una guía que no existe.
 */
export function guideCrumbs(meta: GuideMeta): { name: string; path: string }[] {
  const pillar = meta.isPillar ? undefined : pillarGuide(meta.pillar);
  return [...GUIDES_INDEX_CRUMBS, ...(pillar ? [{ name: pillar.h1, path: guidePath(pillar.slug) }] : []), { name: meta.h1, path: guidePath(meta.slug) }];
}
