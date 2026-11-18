// api/_lib/html/escape.ts
// Escape de texto para HTML (contenido y valores de atributos entre comillas simples o dobles).
// Lo usan el aviso de despacho y su nota en Pipedrive: todo valor que viene de Pipedrive (un
// campo, el nombre de la persona, el nombre de un archivo) pasa por aquí antes de entrar al HTML.
// Escapa & < > " ' (el escapeHtml de api/quotes/create.ts y api/project-quotes/create.ts no
// escapa las comillas; su migración va en una PR aparte).
// Sin imports; la carpeta _lib hace que Vercel no lo despliegue como función.

const ENTITIES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Texto → HTML seguro. Un número se escribe tal cual; null y undefined, vacío. */
export function escapeHtml(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (c) => ENTITIES[c]);
}
