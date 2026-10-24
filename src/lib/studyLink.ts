// src/lib/studyLink.ts
// Caja «Estudio DIALux (servicio cotizado)» de la ficha (auditoría UX, E-02): qué fichas la
// llevan y a dónde lleva (sus textos, en src/config/navigation.ts). Sin imports del catálogo: el
// formulario de /estudio-luminico también usa este archivo y no debe cargar los productos.
//
// La caja lleva a /estudio-luminico?tipo=<tipo>&producto=<id>#solicitar. El formulario lee la
// dirección después de hidratar (el HTML estático es el mismo para todas): preselecciona el tipo
// de proyecto y anota la ficha en la descripción, solo si esos campos siguen vacíos. El cliente
// puede cambiar los dos. La página tiene canonical fijo (/estudio-luminico): la consulta no
// crea páginas nuevas para Google.

/** Ruta del estudio y el ancla de su formulario (EstudioLuminicoPage). */
export const STUDY_PATH = '/estudio-luminico';
export const STUDY_FORM_ANCHOR = 'solicitar';

/**
 * Categorías cuyas fichas llevan la caja (las de la auditoría, E-02) y el tipo de proyecto que
 * preselecciona el formulario (los valores de TIPOS_PROYECTO de EstudioLuminicoLeadForm). null:
 * un proyector sirve igual para una cancha, una fachada o un estacionamiento; lo elige el cliente.
 */
export const STUDY_BOX_CATEGORIES: Readonly<Record<string, string | null>> = {
  'proyectores-led': null,
  'campanas-led': 'industria_bodega',
  'iluminacion-antiexplosiva': 'industria_bodega',
  'alumbrado-publico': 'vialidad_exterior',
  'solar': 'vialidad_exterior',
};

/**
 * Productos de esas categorías que no son una luminaria para calcular (jumpseller_id → por qué):
 * la caja pregunta «¿Cuántas necesitas para tu proyecto?» y ofrece la propuesta de luminarias.
 */
export const STUDY_BOX_EXCLUDED: Readonly<Record<number, string>> = {
  3770404: 'trípode para proyector (accesorio)',
  19841604: 'señalética de emergencia «Salida» (letrero, no ilumina un área)',
};

/** Id de una ficha: el de la URL /producto/<id> (minúsculas, números y guiones). */
const PRODUCT_ID = /^[a-z0-9][a-z0-9-]{0,159}$/;

/**
 * Destino de la caja para un producto, o null si su ficha no la lleva. El tipo sale de la
 * categoría principal y, si no da uno, de las otras en su orden.
 */
export function studyBoxHref(product: { id: string; category: string; categories: readonly string[]; jumpseller_id?: number }): string | null {
  if (product.jumpseller_id !== undefined && Object.prototype.hasOwnProperty.call(STUDY_BOX_EXCLUDED, product.jumpseller_id)) return null;
  const cats = [product.category, ...product.categories].filter(c => Object.prototype.hasOwnProperty.call(STUDY_BOX_CATEGORIES, c));
  if (!cats.length || !PRODUCT_ID.test(product.id)) return null;
  const tipo = cats.map(c => STUDY_BOX_CATEGORIES[c]).find((t): t is string => !!t);
  const query = new URLSearchParams({ ...(tipo ? { tipo } : {}), producto: product.id });
  return `${STUDY_PATH}?${query.toString()}#${STUDY_FORM_ANCHOR}`;
}

/** Texto que anota la ficha de origen en la descripción del proyecto. */
export const studyProductNote = (productUrl: string) => `Producto de referencia: ${productUrl}`;

/**
 * Lo que la dirección del estudio preselecciona en el formulario: el tipo, solo si es uno de los
 * del formulario, y la ficha, solo si el id tiene la forma de uno (nada más de la URL llega al
 * formulario). productUrl arma la dirección absoluta de la ficha.
 */
export function studyPrefill(
  search: string,
  validTipos: readonly string[],
  productUrl: (path: string) => string,
): { tipoProyecto?: string; descripcionProyecto?: string } {
  const params = new URLSearchParams(search);
  const tipo = params.get('tipo') ?? '';
  const producto = params.get('producto') ?? '';
  return {
    ...(validTipos.includes(tipo) ? { tipoProyecto: tipo } : {}),
    ...(PRODUCT_ID.test(producto) ? { descripcionProyecto: studyProductNote(productUrl(`/producto/${producto}`)) } : {}),
  };
}
