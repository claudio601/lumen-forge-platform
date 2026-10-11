// Ejecuciones del robot de catálogo: las pruebas que dependen de los datos que trae
// Jumpseller ese día solo informan (un texto o un dato desactualizado nunca debe bloquear
// los precios). Lo usan descriptions.test.ts, og-images.test.ts y content.test.ts.
// CATALOG_SYNC_JOB: la tarea de sincronización (corre desde main, antes de abrir la PR).
// En la PR, GITHUB_REF_NAME es 'N/merge' y la rama viene en GITHUB_HEAD_REF.
export const isSyncBot =
  process.env.CATALOG_SYNC_JOB === '1' ||
  [process.env.GITHUB_HEAD_REF, process.env.GITHUB_REF_NAME].includes('bot/jumpseller-sync');
