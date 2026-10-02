// scripts/jumpseller/spec-groups.ts
// Ordena la tabla de especificaciones de Jumpseller (filas "etiqueta | valor") en los
// mismos tres grupos de las fichas BESTLED: Eléctrico y fotométrico, Construcción y
// operación, y Componentes y control. La fila "Aplicación" pasa a la lista de
// aplicaciones. Las tablas que no son de dos columnas (comparativas de una familia)
// se conservan tal cual. Trabaja sobre el HTML ya limpio (sanitize-description.ts);
// los valores salen como texto plano (React los escapa al mostrarlos).

import { defaultTreeAdapter, html as parse5Html, parseFragment } from 'parse5';
import type { ProductDescription } from '../../src/data/catalog/jumpseller.types';

export type SpecGroup = 'electricos' | 'construccion' | 'componentes';
export type GroupedSpecs = Omit<ProductDescription, 'text'>;

interface Node { nodeName: string; tagName?: string; value?: string; childNodes?: Node[] }

/** Etiqueta normalizada: minúsculas, sin tildes ni puntuación. */
export function normalizeLabel(label: string): string {
  return label
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9%°²]+/g, ' ')
    .trim();
}

type Rule = [pattern: RegExp, group: SpecGroup | 'applications', label?: string];

// En orden: la primera regla que calza decide el grupo; el orden de las reglas es
// también el orden de las filas dentro de cada grupo (como en las fichas BESTLED).
const RULES: Rule[] = [
  // Aplicaciones (van a la lista, no a la tabla)
  [/^(aplicacion(es)?|uso|uso recomendado)$/, 'applications'],

  // Eléctrico y fotométrico
  [/^potencia( nominal| de los leds)?$/, 'electricos', 'Potencia'],
  [/^(consumo|consume|consumo de energia|costo energetico)$/, 'electricos', 'Consumo'],
  [/equivalencia/, 'electricos'],
  [/^(voltaje|tension)( nominal| de trabajo| de funcionamiento)?$/, 'electricos', 'Tensión'],
  [/^(voltaje|tension) de entrada$/, 'electricos', 'Tensión de entrada'],
  [/^(voltaje|tension) de salida$/, 'electricos', 'Tensión de salida'],
  [/^(alimentacion|tipo de corriente)$/, 'electricos'],
  [/^corriente$/, 'electricos', 'Corriente'],
  [/^frecuencia$/, 'electricos', 'Frecuencia'],
  [/^factor (de )?(potencia|poder)( pf)?$/, 'electricos', 'Factor de potencia'],
  [/thd|distorsion/, 'electricos', 'Distorsión armónica (THD)'],
  [/^(flujo lumin(ico|oso)|lumenes|total lumenes)$/, 'electricos', 'Flujo luminoso'],
  [/^(eficacia|eficacia luminosa|eficiencia lumin(ica|osa)|eficencia luminica|lumenes x wats)$/, 'electricos', 'Eficacia luminosa'],
  [/^(eficiencia energetica|ahorro energetico)$/, 'electricos'],
  [/^(color de temperatura( de luz)?|temperatura (de )?color|color temperatura|color de luz|color de t)$/, 'electricos', 'Temperatura de color'],
  [/^temperatura (de )?color °k$/, 'electricos'],
  [/^(cri( ra)?|indice de reproduccion cromatica( cri)?)$/, 'electricos', 'Índice cromático (CRI)'],
  [/^codigo fotometrico$/, 'electricos', 'Código fotométrico'],
  [/angulo|^a° de iluminacion$/, 'electricos', 'Ángulo de apertura'],
  [/^direccion de luz$/, 'electricos'],
  [/^(area de (cobertura|exposicion|iluminacion)|ambito de alcance|iluminacion)$|^cantidad de lux/, 'electricos'],
  [/^seguridad electrica$/, 'electricos'],

  // Componentes y control
  [/^(chip led|led chip)$/, 'componentes', 'Chip LED'],
  [/^tecnologia$/, 'componentes', 'Tecnología'],
  [/^cantidad de leds$/, 'componentes', 'Cantidad de LEDs'],
  [/^(tipo de led|fuente de luz|led|cinta led|lampara|lamparas|faros|tubo|base|tipo)$/, 'componentes'],
  [/^driver$/, 'componentes', 'Driver'],
  [/^(fuente de alimentacion|adaptador|alto fuente|diametro fuente)$/, 'componentes'],
  [/^(regulable|regulador de intensidad|selector flujo max y min|apoyo regulador de voltaje)$/, 'componentes'],
  [/^protector sobretensiones/, 'componentes', 'Protector de sobretensiones (SPD)'],
  [/sensor|deteccion|^modo|^modos|^tiempo de encendido|^encendido$|^boton de prueba$|^led indicativo/, 'componentes'],
  [/^vida util (de la )?bateria$/, 'componentes', 'Vida útil de la batería'],
  [/bateria|^configuracion de|^panel|tamano (del|de) panel|^tiempo de (carga|trabajo|uso|iluminacion|autonomia)$|^tiempo operacion$|^autonomia$|^carga|^capacidad|^poder de carga$|^voltaje del cargador$|descarga|^duracion$/, 'componentes'],
  [/^(accesorio|accesorios|incluye|conductor|compatible|compatible con|piezas|conexion)$/, 'componentes'],

  // Construcción y operación (también lo que no calce con nada: ver UNKNOWN_GROUP)
  [/^marca$/, 'construccion', 'Marca'],
  [/^modelo$/, 'construccion', 'Modelo'],
  [/^(estilo|formato|formato de producto|descripcion)$/, 'construccion'],
  [/^(material|materiales|material de (construccion|lampara|la lampara)|material lampara|composicion)$/, 'construccion', 'Material'],
  [/^(carcasa|cuerpo|difusor|cobertura|cabeza|brazo)$/, 'construccion'],
  [/^(color|color de marco|color de foco|marco)$/, 'construccion'],
  [/^(proteccion|proteccion ip|grado de proteccion( ip)?|nivel de proteccion)$/, 'construccion', 'Grado de protección'],
  [/^(grado de proteccion ik|proyeccion ik|clase de colision)$/, 'construccion', 'Resistencia al impacto (IK)'],
  [/^(marcado ex|ex mark)$/, 'construccion', 'Marcado Ex'],
  [/corrosion|explosion|^proteccion apex$|^zona de uso$|^normas?$|^pictogramas$/, 'construccion'],
  [/^temperatura de (trabajo|operacion|aplicacion)$/, 'construccion', 'Temperatura de operación'],
  [/^temperatura de trabajo (t°|°c)$/, 'construccion'],
  [/^(humedad de trabajo|tc)$/, 'construccion'],
  [/^(dimensiones|dimensiones (luminaria|producto)|medidas|medidas (de|del) producto|tamano de luminaria)$/, 'construccion', 'Dimensiones'],
  [/^dimensiones mm$/, 'construccion'],
  [/^diametro tota[lc]$/, 'construccion', 'Diámetro total'],
  [/^diametro$/, 'construccion', 'Diámetro'],
  [/^(altura de instalacion recomendada|altura recomendada de instalacion)$/, 'construccion', 'Altura de instalación recomendada'],
  [/^(alto|ancho|largo|profundidad|espesor|altura|horizontal|diametro|tamano)( |$)/, 'construccion'],
  [/empotrado|^tamano de (foco|lampara|trabajo)$|^dimension producto/, 'construccion'],
  [/^peso( unit)?$/, 'construccion', 'Peso'],
  [/^(montaje|instalacion|soportes|canastillo|punteras|entrada del cable|accesorios para montar|dimension estaca)$/, 'construccion'],
  [/^distancia de (instalacion|aplicacion) sugerida$/, 'construccion', 'Distancia de instalación sugerida'],
  [/^area recomendada$/, 'construccion', 'Área recomendada'],
  [/^vida util$/, 'construccion', 'Vida útil'],
  [/^vida util hrs$/, 'construccion'],
  [/^garantia$/, 'construccion', 'Garantía'],
  [/^certific/, 'construccion', 'Certificación'],
  [/^(packaging|packaking|packeging) (individual|x unidad)$/, 'construccion', 'Packaging individual'],
  [/^(packaging|packaking|packeging) (x|por) mayor$/, 'construccion', 'Packaging por mayor'],
  [/^(packaging|packaging total)$/, 'construccion', 'Packaging'],
  [/^(medidas de caja|dimension caja|peso de caja|peso x caja|unidades x caja)$/, 'construccion'],
];

const UNKNOWN_GROUP: SpecGroup = 'construccion';
/** Filas que repiten el título y el SKU de la página (el limpiador ya las saca; por si acaso). */
const SKIP = /^(sku|nombre( del| de)? producto)$/;
/** Filas de encabezado: "Característica | Valor". */
const HEADER_LABEL = /^(caracteristicas?|especificacion(es)?( tecnicas?)?|ficha tecnica|parametros?|item)$/;
const HEADER_VALUE = /^(valor(es)?|detalle|dato|especificacion|)$/;
const EMPTY_VALUE = /^[-–—.]*$/;

function classify(label: string): { group: SpecGroup | 'applications'; label: string; rank: number; known: boolean } {
  const n = normalizeLabel(label);
  const i = RULES.findIndex(([re]) => re.test(n));
  if (i < 0) return { group: UNKNOWN_GROUP, label: cleanLabel(label), rank: RULES.length, known: false };
  const [, group, canonical] = RULES[i];
  return { group, label: canonical ?? cleanLabel(label), rank: i, known: true };
}

const ACRONYMS = /^(LED|CRI|RA|IP|IK|SPD|THD|PF|AC|DC|SEC|°K|°C|T°)$/;

/**
 * Etiqueta con mayúscula solo al inicio, como en las fichas BESTLED: "VIDA ÚTIL (HRS.):"
 * y "Vida Útil (hrs.)" → "Vida útil (hrs.)". Las siglas (LED, CRI, °K…) se conservan.
 */
export function cleanLabel(label: string): string {
  const l = label.replace(/\s+/g, ' ').replace(/\s*:\s*$/, '').trim();
  const shouting = l === l.toUpperCase();
  const words = l.split(' ').map((w, i) => {
    const bare = w.replace(/^[(¿]+|[)?.:,>]+$/g, '');
    const keep = ACRONYMS.test(bare.toUpperCase()) || /\d/.test(w) || (!shouting && /^[A-ZÁÉÍÓÚÑ]{2,4}$/.test(bare));
    if (keep) return ACRONYMS.test(bare.toUpperCase()) ? w.replace(bare, bare.toUpperCase()) : w;
    const lower = w.toLowerCase();
    return i === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
  });
  return words.join(' ');
}

// td/th: una tabla anidada en una celda no pega sus celdas entre sí
const BLOCK = new Set(['p', 'ul', 'ol', 'li', 'h3', 'h4', 'blockquote', 'div', 'table', 'tr', 'td', 'th']);

/** Texto de una celda: <br>, párrafos y viñetas pasan a saltos de línea. */
function cellText(node: Node): string {
  let out = '';
  for (const c of node.childNodes ?? []) {
    if (c.nodeName === '#text') out += c.value ?? '';
    else if (c.tagName === 'br') out += '\n';
    else if (c.tagName) {
      const inner = cellText(c);
      out += BLOCK.has(c.tagName) ? `\n${c.tagName === 'li' ? '• ' : ''}${inner}\n` : inner;
    }
  }
  return out;
}

const tidy = (s: string) =>
  s
    .split('\n')
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(line => line && line !== '•')
    .join('\n');

const elements = (n: Node | undefined, tag: string): Node[] => (n?.childNodes ?? []).filter(c => c.tagName === tag);

function rowsOf(table: Node): Node[][] {
  const sections = (table.childNodes ?? []).filter(c => c.tagName === 'thead' || c.tagName === 'tbody');
  return sections.flatMap(s => elements(s, 'tr')).map(tr => (tr.childNodes ?? []).filter(c => c.tagName === 'td' || c.tagName === 'th'));
}

/**
 * "Bodegas, industrias y patios" / "Gimnasio\nPlazas" → ["Bodegas", "Industrias", "Patios"] / ["Gimnasio", "Plazas"].
 * null si el valor no es una lista de usos sino una frase (p. ej. una nota de compatibilidad).
 */
export function splitApplications(value: string): string[] | null {
  const list = value
    .split('\n')
    .flatMap(line => {
      const parts = line
        .replace(/^•\s*/, '')
        .split(/\s*[,;/]\s*|\s+-\s*|\s*-\s+|(?<=[a-záéíóúñ])-(?=[A-ZÁÉÍÓÚÑ])/);
      // "a, b y c": la "y" final también separa (solo si la línea ya era una lista)
      if (parts.length > 1) parts.push(...parts.pop()!.split(/\s+y\s+/));
      return parts;
    })
    .map(a => a.replace(/\.$/, '').trim())
    .filter(Boolean)
    .map(a => a.charAt(0).toUpperCase() + a.slice(1));
  const isList = list.length > 0 && list.length <= 10 && list.every(a => a.length <= 32 && !/^[-•]/.test(a));
  return isList ? list : null;
}

export interface GroupSpecsResult {
  specs: GroupedSpecs;
  /** Etiquetas sin regla (quedan en Construcción y operación): para completar RULES. */
  unknownLabels: string[];
}

/**
 * Agrupa las tablas de especificaciones (HTML limpio: solo <table>…</table>).
 * Una tabla que no es enteramente de dos columnas se conserva en `tables`.
 */
export function groupSpecs(tablesHtml: string): GroupSpecsResult {
  const context = defaultTreeAdapter.createElement('div', parse5Html.NS.HTML, []);
  const fragment = parseFragment(context, tablesHtml, {}) as unknown as Node;
  const rows: { group: SpecGroup; label: string; value: string; rank: number; order: number }[] = [];
  const applications: string[] = [];
  const unknownLabels: string[] = [];
  const keptTables: string[] = [];
  const topTables = splitTopLevelTables(tablesHtml);

  elements(fragment, 'table').forEach((table, t) => {
    const tableRows = rowsOf(table).filter(cells => cells.some(c => tidy(cellText(c))));
    if (tableRows.some(cells => cells.length !== 2)) {
      if (topTables[t]) keptTables.push(topTables[t]);
      return;
    }
    // Fila de encabezado: la primera, entera en <th> ("Característica | Valor", "Modelo | Ficha")
    const first = tableRows[0];
    const body = first && first.every(c => c.tagName === 'th') ? tableRows.slice(1) : tableRows;
    let previous: (typeof rows)[number] | undefined;
    for (const [labelCell, valueCell] of body) {
      const rawLabel = tidy(cellText(labelCell)).replace(/\n/g, ' ');
      const value = tidy(cellText(valueCell));
      const n = normalizeLabel(rawLabel);
      // Sin etiqueta: continúa el valor de la fila anterior (p. ej. una segunda línea de packaging)
      if (!n && value && previous) {
        previous.value = `${previous.value}\n${value}`;
        continue;
      }
      previous = undefined;
      if (!n || SKIP.test(n) || EMPTY_VALUE.test(value)) continue;
      if (HEADER_LABEL.test(n) && HEADER_VALUE.test(normalizeLabel(value))) continue;
      const c = classify(rawLabel);
      if (!c.known) unknownLabels.push(rawLabel);
      const apps = c.group === 'applications' ? splitApplications(value) : null;
      if (apps) applications.push(...apps);
      else {
        const group = c.group === 'applications' ? 'construccion' : c.group;
        previous = { group, label: c.label, value, rank: c.group === 'applications' ? RULES.length : c.rank, order: rows.length };
        rows.push(previous);
      }
    }
  });

  const specs: GroupedSpecs = {};
  for (const group of ['electricos', 'construccion', 'componentes'] as const) {
    const list = rows
      .filter(r => r.group === group)
      .sort((a, b) => a.rank - b.rank || a.order - b.order)
      .map(({ label, value }) => ({ label, value }));
    if (list.length) specs[group] = list;
  }
  const seen = new Set<string>();
  const apps = applications.filter(a => !seen.has(a.toLowerCase()) && seen.add(a.toLowerCase()));
  if (apps.length) specs.applications = apps;
  if (keptTables.length) specs.tables = keptTables.join('');
  return { specs, unknownLabels };
}

/** Las tablas de primer nivel del HTML, en orden (las anidadas quedan dentro de la suya). */
function splitTopLevelTables(htmlString: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (const m of htmlString.matchAll(/<\/?table>/g)) {
    if (m[0] === '<table>') {
      if (depth++ === 0) start = m.index!;
    } else if (depth > 0 && --depth === 0) {
      out.push(htmlString.slice(start, m.index! + m[0].length));
    }
  }
  return out;
}
