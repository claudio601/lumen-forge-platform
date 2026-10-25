// src/config/regions.ts
// Regiones de Chile del selector de /solicitar-pedido (RequestOrderPage). La misma lista
// decide qué región guardada se acepta al leer «Recordar mis datos» (src/lib/savedContact.ts).
// Los valores viajan tal cual a api/request-orders/create.ts: no cambiar su escritura.

export const REGIONS: readonly string[] = [
  'Arica y Parinacota', 'Tarapaca', 'Antofagasta', 'Atacama', 'Coquimbo',
  'Valparaiso', 'Región Metropolitana', "O'Higgins", 'Maule', 'Nuble',
  'Biobio', 'La Araucania', 'Los Rios', 'Los Lagos', 'Aysen', 'Magallanes',
];
