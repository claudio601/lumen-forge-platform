// src/config/legal.ts
// Las páginas de información legal y de compra (PR 12). Una sola lista: la usan el pie de
// página, el marco de las páginas (LegalLayout) y el aviso antes de enviar un formulario
// (PreSubmitNotice). Todas están en STATIC_ROUTES (src/lib/seo/routes.ts).

export const LEGAL_PAGES = [
  { path: '/empresa', label: 'Quiénes somos' },
  { path: '/despacho', label: 'Despacho' },
  { path: '/medios-de-pago', label: 'Medios de pago' },
  { path: '/cambios-devoluciones-y-garantia', label: 'Cambios, devoluciones y garantía' },
  { path: '/terminos-y-condiciones', label: 'Términos y condiciones' },
  { path: '/politica-de-privacidad', label: 'Política de privacidad' },
] as const;

export type LegalPage = (typeof LEGAL_PAGES)[number];
export type LegalPath = LegalPage['path'];

/** La entrada de una página legal (su nombre para enlaces, migas y títulos). */
export function legalPage(path: LegalPath): LegalPage {
  return LEGAL_PAGES.find(p => p.path === path)!;
}
