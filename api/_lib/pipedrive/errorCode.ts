// api/_lib/pipedrive/errorCode.ts
// Para registrar un error que devolvió el cliente de Pipedrive: solo su código, nunca el texto.
// El texto de Pipedrive puede traer el nombre de una persona, y `redact` no reconoce nombres
// (auditoría de Codex de la #196, ronda 3). El cliente ya registra su propia línea con el método,
// la ruta y la categoría. Va aparte de client.ts porque muchas pruebas simulan ese módulo entero.

/** `HTTP 404`, `TIMEOUT` u `otro`. */
export function pipedriveErrorCode(error: unknown): string {
  if (typeof error !== 'string') return 'otro';
  const http = /^HTTP ([1-5]\d{2})\b/.exec(error);
  if (http) return `HTTP ${http[1]}`;
  if (error === 'Request timeout') return 'TIMEOUT';
  return 'otro';
}
