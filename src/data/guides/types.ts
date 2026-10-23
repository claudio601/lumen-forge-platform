// src/data/guides/types.ts
// Tipos de las guías (/guias y /guias/<slug>; plan del blog, §5.1). La ficha liviana de cada
// guía vive en ./index.ts y su cuerpo en ./content/<slug>.ts, que se carga a pedido. Los enlaces
// internos son destinos tipados (una categoría, una guía, una lista de fichas, una ruta, un
// correo, un ancla o una URL externa) para que guides.test.ts pueda verificarlos.
// Solo imports relativos: lo importa src/lib/seo/routes.ts, que también corre en scripts/.

import type { Ds1LineKey } from '../catalog/ds1';

/** Pilares del blog (plan §1.1). */
export type GuidePillar = 'norma-luminica' | 'proyectos';

/** Intención del lector, que decide el llamado a la acción (plan §1.4). */
export type GuideIntent = 'normativa' | 'dimensionar' | 'elegir-producto' | 'planificar';

/** Rutas del sitio a las que puede llevar una guía. */
export type GuideRoute = '/cotizador' | '/estudio-luminico' | '/catalogo' | '/empresa';

/** Ficha de una guía: lo que necesitan el índice, las etiquetas para Google y las migas. */
export interface GuideMeta {
  /** Minúsculas, sin tildes, con guiones; nunca cambia una vez publicada (plan §1.2). */
  slug: string;
  /** El único H1 y el headline del JSON-LD. */
  h1: string;
  /** Sin la marca: la página agrega « | eLIGHTS» (de 20 a 55 caracteres; con la marca, de 30 a 65). */
  metaTitle: string;
  /** De 110 a 160 caracteres. */
  metaDescription: string;
  pillar: GuidePillar;
  /** La guía es la página pilar de su tema (sus migas no llevan el nivel del pilar). */
  isPillar?: true;
  /** Búsqueda objetivo (sin volúmenes: esos no van al repo, plan §5.1). */
  target: string;
  intent: GuideIntent;
  /** ISO 8601 con la zona horaria de Chile, como texto fijo (nunca new Date()). */
  datePublished: string;
  dateModified: string;
  /** Las mismas fechas como se ven («dd-mm-aaaa»). */
  publishedLabel: string;
  /** Solo si hubo un cambio de fondo (plan §1.7). */
  modifiedLabel?: string;
  /** Clave de GUIDE_AUTHORS. */
  author: GuideAuthorKey;
  /**
   * Si va a Google. false: «publicada sin indexar» (plan §2.2): se prerenderiza y se ve igual,
   * pero lleva noindex y queda fuera de indexableRoutes() y del sitemap.
   */
  index: boolean;
}

export type GuideAuthorKey = 'claudio-quero';

export interface GuideAuthor {
  name: string;
  /** Las líneas de experiencia que aprobó el autor, sin el nombre (va antes, en negrita). */
  bio: string;
  /** Página con los datos de la empresa (plan §1.7). */
  path: '/empresa';
}

/** Destino de un enlace del cuerpo. */
export type GuideLink =
  /** Una categoría de categories.config.ts. */
  | { category: string }
  /** Otra guía (su slug): si aún no está publicada, el enlace no se muestra. */
  | { guide: string }
  /** Una página fija del sitio. Los clics hacia /cotizador y /estudio-luminico se miden (guia_cta_click). */
  | { route: GuideRoute }
  /** Fichas, por id de Jumpseller y en orden de preferencia: lleva a la primera publicada; sin ninguna, no hay enlace. */
  | { products: readonly number[] }
  /** Correo a ventas (contactEmail), con su asunto si lo tiene. */
  | { mail: { subject?: string } }
  /** Una sección de la misma guía. */
  | { anchor: string }
  /** Una fuente oficial (https). */
  | { external: string };

/**
 * Un trozo de texto: texto simple, negrita, un enlace o un trozo que solo se muestra si la guía
 * que nombra está publicada (una oración que lleva a una guía que todavía no existe).
 */
export type Inline =
  | string
  | { b: string }
  | { text: string; to: GuideLink }
  | { ifGuide: string; parts: readonly Inline[] };

export type Rich = readonly Inline[];

/** Una línea con certificado D.S. N°1 en el bloque de la guía (ver ./ds1-block.ts). */
export interface Ds1BlockItem {
  line: Ds1LineKey;
  /** Nombre de la línea o del grupo de productos (enlazado a la primera ficha publicada de `products`). */
  name: string;
  /** Productos que nombra el ítem (ids de Jumpseller), en orden de preferencia para el enlace. */
  products: readonly number[];
  /** Versiones con certificado que nombra, en kelvin, de menor a mayor. */
  kelvin: readonly number[];
}

export type GuideBlock =
  | { type: 'p'; content: Rich; strong?: true }
  | { type: 'list'; items: readonly Rich[]; ordered?: true }
  | { type: 'table'; head: readonly string[]; rows: readonly (readonly Rich[])[] }
  /** Lista de líneas con certificado D.S. N°1/2022 (DS1_CERTIFIED_LINES). */
  | { type: 'ds1-lines'; items: readonly Ds1BlockItem[] };

export interface GuideSubsection {
  title: string;
  blocks: readonly GuideBlock[];
}

/** Una sección: un H2 con su id fijo y sus H3 (así la revisan las reglas del D.S. N°1/2022). */
export interface GuideSection {
  id: string;
  title: string;
  blocks: readonly GuideBlock[];
  subsections?: readonly GuideSubsection[];
  /**
   * Habla de alumbrado exterior (calles, patios, canchas, galpones sin muros): toda ficha que
   * enlaza es de una línea con certificado (ds1.ts; plan §1.5).
   */
  outdoor?: true;
}

export interface GuideSource {
  /** Nombre y organismo, como se lee en la lista. */
  label: string;
  url: string;
  /** «dd-mm-aaaa». */
  reviewed: string;
}

export interface GuideRelated {
  guide: string;
  title: string;
  text: string;
}

/** Recuadro final (plan §1.3, bloque 8): título, una oración y un botón; debajo, el correo de ventas. */
export interface GuideFinalBox {
  title: string;
  text: string;
  button: { label: string; route: '/cotizador' | '/estudio-luminico' };
}

/** El cuerpo de una guía (./content/<slug>.ts). */
export interface GuideContent {
  slug: string;
  /** Respuesta corta: párrafos antes del índice. */
  answer: readonly Rich[];
  sections: readonly GuideSection[];
  finalBox: GuideFinalBox;
  sources: readonly GuideSource[];
  /** «Fuentes revisadas el dd-mm-aaaa». */
  sourcesReviewed: string;
  /** Historial de cambios (guías con el D.S. N°1/2022). */
  history: readonly { date: string; change: string }[];
  related: readonly GuideRelated[];
}
