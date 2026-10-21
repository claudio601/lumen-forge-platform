// src/data/catalog/category-intros.ts
// Introducción de una categoría, sobre la grilla de /catalogo/<slug> (auditoría UX, entrega 4:
// E-01 y la propuesta de contenido D.S. N°1 de la sección 5.4). Va aparte de
// categories.config.ts para no sumarle texto al bundle principal (encabezado, pie y portada):
// solo la importa CatalogPage, que se carga en su propio trozo.
//
// D.S. N°1/2022 (reglas en ./ds1.ts, que vigila src/config/contentTruth.test.ts): el certificado
// solo se afirma de las BESTLED (DS1_CERTIFIED_IDS); el resto de la categoría (solares y otros
// sin certificado documentado) no se nombra con sello. Fechas y exigencias verificadas en el
// texto del decreto (BCN, idNorma 1197027: art. 3 letras a, z y aa; arts. 5, 6, 7, 11, 12 y 20)
// y en la tabla de plazos del MMA, el 21-10-2026. "Nuevo" es lo del art. 3 aa): fuera de las
// Áreas de Protección Especial, la luminaria de un proyecto de instalación o recambio adjudicado
// o iniciado antes del 19-10-2026 es existente y cumple al recambio (art. 11 N°1). Sin "recambio
// total al 2029" ni el anteproyecto de agosto de 2026 (preguntas 6 y 8 del informe UX,
// pendientes del dueño y del abogado).

import { ADVISORY_LINK } from '../../config/navigation';
import { DS1_CERTIFIED_IDS } from './ds1';

/**
 * Destino de un botón: una ruta del sitio, la ficha de un producto (ids de Jumpseller en orden de
 * preferencia: lleva al primero publicado y, si no hay ninguno, el botón no se muestra) o un
 * correo a ventas con su asunto.
 */
export type CategoryIntroTarget = { path: string } | { products: readonly number[] } | { mailSubject: string };

export interface CategoryIntro {
  title: string;
  /** Lo que se ve siempre: párrafos cortos. */
  paragraphs: readonly string[];
  /** Botones bajo los párrafos. */
  actions: readonly { label: string; to: CategoryIntroTarget; hint?: string }[];
  /** Detalle plegable (<details>): queda en el HTML para buscadores y lectores de pantalla. */
  details: { summary: string; items: readonly { label: string; text: string }[] };
  /** Fuentes oficiales del texto y la fecha en que se revisaron. */
  sources: { links: readonly { label: string; href: string }[]; reviewed: string };
}

/** BESTLED 60W: la ficha a la que lleva "Ver BESTLED con certificado D.S. N°1" (informe UX, A-01 y E-01). */
export const BESTLED_60W_ID = 2301101;
/**
 * Destino de "Ver BESTLED con certificado D.S. N°1": la 60W y, si la sincronización deja de
 * publicarla, la primera BESTLED certificada que siga publicada.
 */
export const DS1_BUTTON_PRODUCTS: readonly number[] = [BESTLED_60W_ID, ...DS1_CERTIFIED_IDS.filter(id => id !== BESTLED_60W_ID)];

export const CATEGORY_INTROS: Readonly<Record<string, CategoryIntro>> = {
  'alumbrado-publico': {
    title: 'Alumbrado público y D.S. N°1/2022',
    paragraphs: [
      'Desde el 19 de octubre de 2026, el D.S. N°1/2022 del Ministerio del Medio Ambiente, la norma de contaminación lumínica, se exige en todo Chile a las luminarias exteriores de los proyectos de instalación o recambio que se adjudican o comienzan desde esa fecha. En las Áreas de Protección Especial se exige desde el 19 de octubre de 2024.',
      'Las BESTLED tienen certificado D.S. N°1 en dos variantes: 2700K, para el resto del país, y 2200K, apta también para las Áreas de Protección Especial.',
    ],
    actions: [
      { label: 'Ver BESTLED con certificado D.S. N°1', to: { products: DS1_BUTTON_PRODUCTS } },
      {
        label: '¿Tu comuna es Área de Protección Especial? Pregúntanos',
        to: { mailSubject: 'Consulta D.S. N°1/2022: ¿mi comuna es Área de Protección Especial?' },
      },
      { label: '¿Necesitas el D.S. N°1? Te asesoramos', to: { path: ADVISORY_LINK.to }, hint: ADVISORY_LINK.hint },
    ],
    details: {
      summary: 'Qué exige la norma según el tipo de alumbrado',
      items: [
        {
          label: 'Calles, pasajes, plazas y alumbrado industrial',
          text: 'El contenido de luz azul no puede superar el 1 % en las Áreas de Protección Especial ni el 7 % en el resto del país, y la luminaria no puede emitir luz sobre la horizontal.',
        },
        {
          label: 'Canchas y recintos deportivos',
          text: 'El criterio es otro. La norma fija una temperatura de color máxima según la clase del recinto y exige apagar el alumbrado entre las 00:00 y las 07:00, salvo eventos autorizados. Cuentan como alumbrado exterior aunque estén techados, si no tienen muros.',
        },
        {
          label: 'Alumbrado ornamental y de fachadas',
          text: 'Temperatura de color de hasta 2.700 K, o de 2.200 K en las Áreas de Protección Especial, sin luz hacia el cielo y con el mismo horario de apagado.',
        },
        {
          label: 'Áreas de Protección Especial',
          text: 'Son comunas declaradas, no regiones completas, y áreas de protección de la biodiversidad. Revisa la comuna del proyecto o pregúntanos.',
        },
        {
          label: 'Proyectos adjudicados o iniciados antes',
          text: 'Las luminarias de proyectos adjudicados, en ejecución o ya instalados antes de esas fechas cuentan como existentes: cumplen la norma cuando se recambian. En parte de las Áreas de Protección Especial hay además un plazo máximo: pregúntanos por tu comuna.',
        },
        {
          label: 'Cómo se acredita',
          text: 'Con el certificado de cada luminaria, que emite un organismo autorizado por la SEC. La luminaria se instala respetando el ángulo de montaje que indica ese certificado.',
        },
      ],
    },
    sources: {
      links: [
        { label: 'D.S. N°1/2022 (Biblioteca del Congreso Nacional)', href: 'https://www.bcn.cl/leychile/navegar?i=1197027' },
        { label: 'tabla de plazos del Ministerio del Medio Ambiente', href: 'https://luminica.mma.gob.cl/plazos-norma-luminica/' },
      ],
      reviewed: '21-10-2026',
    },
  },
};
