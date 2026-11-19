// src/data/merchant/exclusions.ts
// Productos publicados que NO van al feed de Google Merchant Center (CLAUDE.md §18).
// Lista a mano: la marca el dueño (decisión D5 del 19-11-2026, pendiente). Candidatos: lo que se
// compra en plaza con plazo incierto (D3: el feed los declara in_stock) y lo que en la práctica
// se vende con precio por proyecto. También las fichas que Merchant rechace y no se puedan
// corregir en Jumpseller.
// Una fila por producto: su jumpseller_id y un motivo corto y genérico (el repo es público:
// nunca proveedores, costos, P.MAYOR ni stock). Para volver a publicarlo en el feed, se borra la
// fila. scripts/merchant-feed.test.ts exige ids únicos y motivos con texto.
// Sin imports: lo usan scripts/merchant-feed.ts y sus pruebas.

export interface MerchantExclusion {
  jumpseller_id: number;
  /** Por qué no va al feed («se compra en plaza», «precio por proyecto»). */
  motivo: string;
}

export const MERCHANT_EXCLUSIONS: readonly MerchantExclusion[] = [];
