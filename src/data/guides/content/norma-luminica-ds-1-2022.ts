// src/data/guides/content/norma-luminica-ds-1-2022.ts
// G1 · Pilar de la norma lumínica. Texto aprobado por el dueño el 23-10-2026
// (~/proyectos/elights-blog-2026-10/borradores/g1-norma-luminica-v2.md, fuera del repo): se
// publica tal cual; aquí solo cambia el formato. Marcadores resueltos: fecha de revisión y de
// publicación (23-10-2026), enlaces «→ destino» a rutas del sitio y el bloque de luminarias con
// certificado (desde DS1_CERTIFIED_LINES; sus oraciones las aprueba el dueño). Las oraciones que
// llevan a guías que aún no existen (G3, G4, G5 y G7) se muestran solas cuando esas guías se
// publiquen. Sin preguntas frecuentes (decisión del dueño, 23-10-2026).

import type { GuideContent } from '../types';

const G3 = 'como-verificar-certificado-norma-luminica';
const G4 = 'luz-calida-o-fria-en-exteriores';
const G5 = 'como-iluminar-una-cancha-o-multicancha';
const G7 = 'iluminacion-de-patios-de-carga';

/** Asunto del correo para la consulta por un Área de Protección Especial (el de /catalogo/alumbrado-publico). */
const APE_SUBJECT = 'Consulta D.S. N°1/2022: ¿mi comuna es Área de Protección Especial?';
const SALES = 'ventas@elights.cl';

const A1 =
  'Desde el 19 de octubre de 2026, el D.S. N°1/2022 del Ministerio del Medio Ambiente, la norma de contaminación lumínica, se exige en todo Chile a las luminarias exteriores de los proyectos de instalación o recambio que a esa fecha no estaban adjudicados ni iniciados. En las Áreas de Protección Especial se exige desde el 19 de octubre de 2024.';
const A4 = 'El cumplimiento del proyecto depende también del diseño y de la instalación.';

const guide: GuideContent = {
  slug: 'norma-luminica-ds-1-2022',
  answer: [
    [
      `La norma lumínica regula la luz artificial que emite el alumbrado exterior en Chile. ${A1} Antes de cotizar, revisa el tipo de alumbrado, la zona y cuándo se adjudicó o empezó el proyecto, y pide el certificado de la versión exacta de cada luminaria.`,
    ],
  ],
  sections: [
    {
      id: 'que-es',
      title: 'Qué es la norma lumínica y qué protege',
      blocks: [
        {
          type: 'p',
          content: [
            'El D.S. N°1/2022 del Ministerio del Medio Ambiente se llama oficialmente «Establece norma de emisión de luminosidad artificial generada por alumbrados de exteriores, elaborada a partir de la revisión del Decreto Supremo Nº 43, de 2012, del Ministerio del Medio Ambiente»; ese D.S. N°43 quedó sin efecto cuando el D.S. N°1/2022 entró en vigencia.',
          ],
        },
        {
          type: 'p',
          content: [
            'Su objetivo es prevenir la contaminación por luminosidad artificial y proteger la calidad astronómica de los cielos nocturnos, la salud de las personas y la biodiversidad. La norma se aplica en todo el territorio nacional. Lo que exige cambia según el tipo de alumbrado, y desde cuándo se exige, según la zona.',
          ],
        },
      ],
    },
    {
      // Destino del correo del 12/11 (#plazos)
      id: 'plazos',
      title: 'Desde cuándo se exige la norma lumínica',
      blocks: [
        {
          type: 'p',
          content: [
            'El D.S. N°1/2022 se publicó en el Diario Oficial el 18 de octubre de 2023 y entró en vigencia el 19 de octubre de 2024. Los proyectos que ingresaron al Sistema de Evaluación de Impacto Ambiental (SEIA) después del 18 de octubre de 2023 ya quedan sujetos al decreto. Para los demás, desde cuándo se exige depende de la zona y de cuándo se adjudicó o empezó el proyecto.',
          ],
        },
      ],
      subsections: [
        { title: 'Proyectos nuevos o de recambio', blocks: [{ type: 'p', content: [A1] }] },
        {
          title: 'Instalaciones existentes',
          blocks: [
            {
              type: 'p',
              content: [
                'Las luminarias de proyectos adjudicados, en ejecución o ya instalados antes de esas fechas cuentan como existentes: cumplen la norma cuando se recambian. En parte de las Áreas de Protección Especial hay además un plazo máximo: pregúntanos por tu comuna.',
              ],
            },
            {
              type: 'p',
              content: [
                'Según el Ministerio del Medio Ambiente, el apagado entre las 00:00 y las 07:00 rige desde el 19 de octubre de 2024, también para las instalaciones existentes. El detalle por zona está en los ',
                { text: 'plazos de cumplimiento del Ministerio del Medio Ambiente', to: { external: 'https://luminica.mma.gob.cl/plazos-norma-luminica/' } },
                '.',
              ],
            },
          ],
        },
        {
          title: 'Qué cuenta como recambio',
          blocks: [
            {
              type: 'p',
              content: [
                'Según el Ministerio del Medio Ambiente, instalar luminarias nuevas en un sector que ya tenía alumbrado público es un recambio, y solo es una fuente nueva instalarlas donde no había luminarias. En los dos casos rigen las fechas de arriba: si el proyecto no estaba adjudicado ni iniciado a esa fecha, sus luminarias deben cumplir la norma.',
              ],
            },
            { type: 'p', strong: true, content: ['Plazos revisados el 23-10-2026.'] },
          ],
        },
      ],
    },
    {
      id: 'areas-de-proteccion-especial',
      title: '¿Tu proyecto está en un Área de Protección Especial?',
      blocks: [
        {
          type: 'p',
          content: [
            'Las Áreas de Protección Especial no son regiones completas. Son las Áreas Astronómicas (29 comunas de Antofagasta, Atacama y Coquimbo), las áreas protegidas para la biodiversidad y las zonas de reproducción de especies amenazadas que definen los planes RECOGE. Revisa si tu proyecto está en una de ellas en luminica.mma.gob.cl o pregúntanos en ',
            { text: SALES, to: { mail: { subject: APE_SUBJECT } } },
            '.',
          ],
        },
        {
          type: 'p',
          content: [
            'En las áreas protegidas ligadas a especies amenazadas por la luz artificial, el Área de Protección Especial se extiende hasta 5 km desde su límite, y los planes RECOGE suman las comunas de mayor impacto para la especie.',
          ],
        },
        {
          type: 'p',
          content: [
            'En la página de ',
            { text: 'Áreas de Protección Especial del Ministerio del Medio Ambiente', to: { external: 'https://luminica.mma.gob.cl/areas-de-proteccion-especial/' } },
            ' están las comunas de las Áreas Astronómicas y las resoluciones que fijan las demás áreas.',
          ],
        },
        {
          type: 'p',
          strong: true,
          content: ['¿No sabes si tu comuna es Área de Protección Especial? Escríbenos a ', { text: SALES, to: { mail: { subject: APE_SUBJECT } } }, '.'],
        },
      ],
    },
    {
      id: 'tipo-de-alumbrado',
      title: 'Qué exige la norma lumínica según el tipo de alumbrado',
      outdoor: true,
      blocks: [
        { type: 'p', content: ['El D.S. N°1/2022 diferencia las exigencias según el uso de la iluminación:'] },
        {
          type: 'table',
          head: ['Tipo de alumbrado', 'Qué limita', 'Apagado o reducción'],
          rows: [
            [
              ['Peatonal, vehicular e industrial'],
              ['El contenido de luz azul y la luz sobre la horizontal'],
              ['El industrial, donde no hay faena: se apaga o se reduce al menos a la mitad'],
            ],
            [['Ornamental'], ['La temperatura de color y la luz hacia el cielo'], ['Apagado de 00:00 a 07:00, salvo eventos autorizados']],
            [
              ['Publicitario'],
              ['La luminancia de los avisos luminosos y la dirección de la luz'],
              ['Apagado de 00:00 a 07:00, salvo los avisos con la ubicación y los precios de una estación de servicio'],
            ],
          ],
        },
      ],
      subsections: [
        {
          title: 'Calles, plazas y recintos industriales',
          blocks: [
            {
              type: 'p',
              content: [
                'El contenido de luz azul no puede superar el 1 % en las Áreas de Protección Especial ni el 7 % en el resto del país, y la luminaria no puede emitir luz sobre la horizontal.',
              ],
            },
            {
              type: 'p',
              content: [
                'El alumbrado peatonal (por lo general, en soportes de 3 a 5 m), el vehicular y el industrial se instalan con el ángulo de montaje que indica el certificado de la luminaria.',
              ],
            },
            {
              type: 'p',
              content: [
                'Los D.S. N°2, de 2014, y N°51, de 2015, del Ministerio de Energía, que reglamentan el alumbrado público vehicular y peatonal, siguen vigentes junto al D.S. N°1/2022. Según el Ministerio del Medio Ambiente, si sus exigencias chocan en la emisión de luz, manda la norma lumínica. Revisa las ',
                { text: 'luminarias de alumbrado público', to: { category: 'alumbrado-publico' } },
                '.',
              ],
            },
            {
              type: 'p',
              content: [
                'El alumbrado industrial, además, no puede superar en más de un 20 % los niveles de la NCh3833/2:2023, y donde no hay faena se apaga o se reduce al menos a la mitad. Para saber qué niveles corresponden a tu recinto, pide un ',
                { text: 'estudio lumínico', to: { route: '/estudio-luminico' } },
                '.',
                { ifGuide: G7, parts: [' Si es un patio o una zona de carga, lee la guía de ', { text: 'iluminación de patios de carga', to: { guide: G7 } }, '.'] },
              ],
            },
            { type: 'p', content: ['Los galpones industriales con techo y sin muros cuentan como alumbrado exterior.'] },
          ],
        },
        {
          title: 'Alumbrado ornamental',
          blocks: [
            {
              type: 'p',
              content: [
                'Temperatura de color de hasta 2.700 K, o de 2.200 K en las Áreas de Protección Especial, sin luz hacia el cielo y apagado entre las 00:00 y las 07:00, salvo eventos autorizados.',
              ],
            },
          ],
        },
        {
          title: 'Letreros publicitarios',
          blocks: [
            {
              type: 'p',
              content: [
                'Los avisos luminosos tienen una luminancia máxima de 50 cd/m². Si el letrero se ilumina desde fuera con luminarias, estas tienen los mismos límites de dirección de la luz y de luz azul que las de calles e industria, y deben iluminarlo de arriba hacia abajo. Todo el alumbrado publicitario se apaga entre las 00:00 y las 07:00, salvo los avisos que indican la ubicación de una estación de servicio y sus precios.',
              ],
            },
          ],
        },
        {
          title: 'Lo que la norma no regula',
          blocks: [
            { type: 'p', content: ['El D.S. N°1/2022 no se aplica a:'] },
            {
              type: 'list',
              items: [
                ['la iluminación no permanente de festividades oficiales, de hasta 1.500 lm por luminaria;'],
                ['las balizas de navegación aérea y marítima, y las de torres, aerogeneradores y edificios;'],
                ['las lámparas de emergencia que se usan solo para el tránsito o para evacuar ante catástrofes naturales;'],
                ['los proyectores astronómicos.'],
              ],
            },
            {
              type: 'p',
              content: [
                'Si una luminaria sirve a la vez como alumbrado exterior y de emergencia, la norma sí la rige. Según el Ministerio del Medio Ambiente, tampoco regula el alumbrado de interiores, las luces de los vehículos ni el alumbrado exterior de las casas particulares.',
              ],
            },
          ],
        },
      ],
    },
    {
      id: 'canchas',
      title: 'Canchas y recintos deportivos',
      outdoor: true,
      blocks: [
        {
          type: 'p',
          content: [
            'La norma fija una temperatura de color máxima según la clase del recinto y exige apagar el alumbrado entre las 00:00 y las 07:00, salvo eventos autorizados. Cuentan como alumbrado exterior aunque estén techados, si no tienen muros.',
          ],
        },
        {
          type: 'p',
          content: [
            'El D.S. N°1/2022 clasifica los recintos deportivos en tres clases, según la norma NCh3834:2023, y su Tabla 4 fija el tope de temperatura de color de cada clase. Identifica la clase de tu recinto antes de elegir proyectores, e instálalos con el ángulo de montaje que indica su certificado.',
          ],
        },
        {
          type: 'p',
          content: [
            {
              ifGuide: G5,
              parts: ['Para elegir los proyectores y diseñar el proyecto, lee la guía ', { text: 'cómo iluminar una cancha o multicancha', to: { guide: G5 } }, '.'],
            },
          ],
        },
      ],
    },
    {
      id: 'acreditacion',
      title: 'Cómo se acredita y quién fiscaliza',
      blocks: [],
      subsections: [
        {
          title: '¿Cómo se acredita?',
          blocks: [
            {
              type: 'p',
              content: [
                'Con el certificado de cada luminaria, que emite un organismo autorizado por la SEC. La luminaria se instala respetando el ángulo de montaje que indica ese certificado.',
              ],
            },
            {
              type: 'p',
              content: [
                'El organismo de certificación trabaja con las mediciones de un laboratorio, y la Superintendencia de Electricidad y Combustibles (SEC) autoriza a ambos. Revisa que el certificado corresponda al modelo y a la versión exacta que vas a comprar: en una misma línea, unas versiones pueden tenerlo y otras no.',
                { ifGuide: G3, parts: [' Para revisarlo paso a paso, lee ', { text: 'cómo verificar el certificado de una luminaria', to: { guide: G3 } }, '.'] },
              ],
            },
          ],
        },
        {
          title: '¿Qué protocolos se usan?',
          blocks: [
            { type: 'p', content: ['La Superintendencia del Medio Ambiente (SMA) tiene cuatro protocolos:'] },
            {
              type: 'table',
              head: ['Protocolo', 'Para qué sirve'],
              rows: [
                [['PCL N°1'], ['Ensayos de luminarias y proyectores exteriores']],
                [['PCL N°2'], ['Mediciones en terreno']],
                [['PCL N°3'], ['Medición de avisos luminosos']],
                [['PCL N°4'], ['Regularización de fuentes existentes']],
              ],
            },
          ],
        },
        {
          title: '¿Quién fiscaliza?',
          blocks: [
            {
              type: 'list',
              items: [
                [{ b: 'SEC:' }, ' fiscaliza la venta de luminarias.'],
                [{ b: 'SMA:' }, ' fiscaliza el cumplimiento de la norma.'],
              ],
            },
            {
              type: 'p',
              content: [
                'El alumbrado público peatonal y vehicular se declara en el trámite de Puesta en Servicio de Obras de Alumbrado Público, el ',
                { b: 'TE2' },
                '. Los demás titulares lo declaran una sola vez ante la SMA.',
              ],
            },
            { type: 'p', strong: true, content: [A4] },
          ],
        },
      ],
    },
    {
      id: 'lista-de-revision',
      title: 'Lista de revisión antes de cotizar',
      blocks: [
        { type: 'p', content: ['Reúne estos datos antes de pedir la cotización.'] },
        {
          type: 'table',
          head: ['Revisión', 'Qué mirar', 'Dónde se verifica'],
          rows: [
            [
              [{ b: 'Tipo de alumbrado' }],
              ['Si es peatonal, vehicular, industrial, ornamental o publicitario'],
              ['Antecedentes del proyecto y definiciones del D.S. N°1/2022 (art. 3)'],
            ],
            [
              [{ b: 'Ubicación' }],
              ['Si está en un Área de Protección Especial o en el resto del país'],
              ['luminica.mma.gob.cl o ', { text: SALES, to: { mail: { subject: APE_SUBJECT } } }],
            ],
            [
              [{ b: 'Fecha del proyecto' }],
              ['Cuándo se adjudicó o empezó la instalación o el recambio'],
              ['Antecedentes de adjudicación o inicio, y plazos del Ministerio del Medio Ambiente'],
            ],
            [
              [{ b: 'Características de la luz' }],
              ['La temperatura de color o el contenido de luz azul que corresponde según el tipo de alumbrado'],
              [
                'Secciones ',
                { text: '4', to: { anchor: 'tipo-de-alumbrado' } },
                ' y ',
                { text: '5', to: { anchor: 'canchas' } },
                ' de esta guía, y certificado de la luminaria',
              ],
            ],
            [
              [{ b: 'Documento por luminaria' }],
              ['Que el certificado sea del modelo y de la versión exacta que vas a comprar'],
              ['Certificado de un organismo autorizado por la SEC'],
            ],
            [
              [{ b: 'Ángulo de montaje' }],
              ['La inclinación con que se instalará cada luminaria'],
              ['Certificado de la luminaria y planos del proyecto'],
            ],
            [
              [{ b: 'Luz sobre la horizontal' }],
              ['Que la luminaria no emita luz sobre la horizontal ni hacia el cielo'],
              ['Certificado de la luminaria y diseño de la instalación'],
            ],
            [
              [{ b: 'Horario de apagado' }],
              ['Si el alumbrado debe apagarse o reducirse de noche'],
              [
                'Horario de cada tipo de alumbrado en el D.S. N°1/2022 (secciones ',
                { text: '4', to: { anchor: 'tipo-de-alumbrado' } },
                ' y ',
                { text: '5', to: { anchor: 'canchas' } },
                ')',
              ],
            ],
            [
              [{ b: 'Declaración del alumbrado' }],
              ['Qué trámite le corresponde al titular'],
              ['TE2 (alumbrado público) o declaración única ante la SMA'],
            ],
          ],
        },
        {
          type: 'p',
          strong: true,
          content: ['Si quieres que revisemos tu proyecto con esta lista, ', { text: 'solicita una propuesta técnica', to: { route: '/cotizador' } }, '.'],
        },
      ],
    },
    {
      id: 'lo-que-vemos',
      title: 'Lo que vemos en eLIGHTS',
      blocks: [
        {
          type: 'list',
          items: [
            [
              { b: 'Los watts no bastan.' },
              ' Vemos que muchos clientes se fijan principalmente en la potencia o el consumo (watts) y no en el flujo luminoso (lúmenes), que es más relevante porque define para qué aplicación sirve la luminaria. Dos luminarias de la misma potencia pueden entregar cantidades de luz muy distintas.',
            ],
            [
              { b: 'Ámbar o cálida.' },
              ' Con el D.S. N°1/2022 hay que distinguir con exactitud si tu proyecto requiere luz ámbar o luz cálida: depende del tipo de alumbrado y de si está en un Área de Protección Especial. Revisa ',
              { text: 'las Áreas de Protección Especial', to: { anchor: 'areas-de-proteccion-especial' } },
              ' y ',
              { text: 'qué exige cada tipo de alumbrado', to: { anchor: 'tipo-de-alumbrado' } },
              { ifGuide: G4, parts: [', y lee la guía ', { text: 'luz cálida o fría en exteriores', to: { guide: G4 } }] },
              '.',
            ],
            [
              { b: 'IP e IK.' },
              ' A veces se pide un grado IP o IK muy alto sin que la aplicación lo justifique: te recomendamos pedir el que corresponde al uso real.',
            ],
          ],
        },
        {
          type: 'p',
          strong: true,
          content: ['Si tu proyecto no tiene una especificación clara, te orientamos en ', { text: SALES, to: { mail: {} } }, '.'],
        },
      ],
    },
    {
      // Bloque del editor: las líneas de DS1_CERTIFIED_LINES con las versiones que cubre su
      // certificado (los estadios, hasta 5000K). Lo genera ../ds1-lines.ts y lo revisa guides.test.ts.
      id: 'luminarias-con-certificado',
      title: 'Luminarias con certificado en eLIGHTS',
      outdoor: true,
      blocks: [
        {
          type: 'p',
          content: ['Estas luminarias tienen certificado D.S. N°1/2022 solo en las versiones que se nombran. Las demás versiones no lo tienen.'],
        },
        {
          type: 'ds1-lines',
          items: [
            {
              line: 'bestled',
              name: 'Alumbrado público BESTLED',
              // La 60W primero: es la ficha del botón de /catalogo/alumbrado-publico
              products: [2301101, 2301098, 2301105, 2301110, 4156930, 2301114, 15021313],
              kelvin: [2200, 2700],
            },
            { line: 'flyhawk', name: 'Alumbrado público LED solar Flyhawk', products: [11521285], kelvin: [2200, 2700] },
            {
              line: 'solarIndustrial',
              name: 'Alumbrado público LED solar All in One industrial',
              products: [30534071, 26946977, 30518805, 30511210],
              kelvin: [2200, 2700],
            },
            { line: 'pagoda', name: 'Pagoda LED solar UFO', products: [27936170], kelvin: [1600, 2700] },
            { line: 'island', name: 'Luminaria ornamental Island', products: [2767982, 10796623], kelvin: [2200, 2700] },
            { line: 'slim', name: 'Proyector LED Slim SMD de 150, 300, 400 y 500W', products: [2340515, 2340383, 2340385, 2993067], kelvin: [2200, 2700] },
            { line: 'slim', name: 'Proyector LED Slim SMD de 200W', products: [2340521], kelvin: [2700] },
          ],
        },
        { type: 'p', content: ['En los proyectores de estadio, el certificado es para alumbrado deportivo:'] },
        {
          type: 'ds1-lines',
          items: [
            {
              line: 'estadioModular',
              name: 'Proyector LED de estadio modular de 100, 150, 200, 300, 400, 500, 600 y 1000W',
              // La 400W primero (plan §3.3). La de 800W no se nombra hasta corregir su ficha
              products: [24696340, 24657400, 32913142, 24663380, 24669150, 24698439, 24696451, 24697125],
              kelvin: [2700, 4000, 5000],
            },
            { line: 'estadio', name: 'Proyector LED de estadio 300W', products: [3313196], kelvin: [3000] },
            { line: 'estadio', name: 'Proyector LED de estadio 500W', products: [3283555], kelvin: [2200] },
            { line: 'estadio', name: 'Proyector LED de estadio redondo 1000W', products: [3309140], kelvin: [2200, 2700, 4000, 5000] },
          ],
        },
        { type: 'p', content: [A4] },
      ],
    },
  ],
  finalBox: {
    title: 'Cotiza las luminarias de tu proyecto exterior',
    text: 'Cuéntanos qué tipo de alumbrado necesitas y dónde está tu proyecto, y te orientamos en la elección de las luminarias y sus documentos.',
    button: { label: 'Solicitar propuesta técnica', route: '/cotizador' },
  },
  sources: [
    {
      label: 'D.S. N°1/2022, Ministerio del Medio Ambiente. Biblioteca del Congreso Nacional',
      url: 'https://www.bcn.cl/leychile/navegar?i=1197027',
      reviewed: '23-10-2026',
    },
    { label: 'Plazos de cumplimiento, Ministerio del Medio Ambiente', url: 'https://luminica.mma.gob.cl/plazos-norma-luminica/', reviewed: '23-10-2026' },
    {
      label: 'Áreas de Protección Especial, Ministerio del Medio Ambiente',
      url: 'https://luminica.mma.gob.cl/areas-de-proteccion-especial/',
      reviewed: '23-10-2026',
    },
    { label: 'Preguntas frecuentes, Ministerio del Medio Ambiente', url: 'https://luminica.mma.gob.cl/preguntas-frecuentes/', reviewed: '23-10-2026' },
    { label: 'Norma lumínica y protocolos, Ministerio del Medio Ambiente', url: 'https://luminica.mma.gob.cl/norma-luminica/', reviewed: '23-10-2026' },
  ],
  sourcesReviewed: '23-10-2026',
  history: [{ date: '23-10-2026', change: 'publicación de la guía.' }],
  related: [
    { guide: G3, title: 'Cómo verificar el certificado de una luminaria', text: 'Qué revisar en el certificado de cada versión antes de comprar.' },
    { guide: G4, title: 'Luz cálida o fría en exteriores', text: 'Qué temperatura de color conviene en cada tipo de alumbrado exterior.' },
  ],
};

export default guide;
