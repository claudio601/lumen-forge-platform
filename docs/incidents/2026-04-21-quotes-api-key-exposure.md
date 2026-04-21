# Incidente: Exposición de QUOTES_API_KEY vía VITE_QUOTES_API_KEY

**Fecha de detección:** 21 de abril de 2026
**Severidad:** Media (exposición arquitectural, no brecha activa detectada)
**Estado:** En resolución — refactor en curso

## Resumen

Durante la tarea de rotar `QUOTES_API_KEY` (originalmente detectada como expuesta en un screenshot), la auditoría del repo reveló que la variable tiene un espejo frontend `VITE_QUOTES_API_KEY` que por diseño de Vite queda embebida en el bundle JavaScript público del sitio `nuevo.elights.cl`. Cualquier visitante del sitio con DevTools puede extraer el valor en segundos.

La rotación simple no resolvía el problema: la nueva key quedaría igual de expuesta en el siguiente build.

## Hallazgos

1. **`VITE_QUOTES_API_KEY` no es un secreto.** Por convención de Vite, el prefijo `VITE_` expone la variable en el bundle cliente. El valor es visible en `view-source` y en los chunks JS servidos públicamente.

2. **`QUOTES_API_KEY` y `VITE_QUOTES_API_KEY` deben tener el mismo valor** para que el checkout de cotizaciones funcione. Si difieren, el endpoint `/api/quotes/create` responde 401 silencioso y los deals no entran a Pipedrive (aunque el email al cliente sí se envía).

3. **Bypass cruzado.** La misma `QUOTES_API_KEY` está aceptada como autorización alternativa en `/api/installation-leads/create` y `/api/estudio-luminico/create`, saltándose los checks de Origin. Un atacante con el valor extraído del bundle puede spamear esos dos endpoints desde cualquier origen.

4. **El endpoint `/api/quotes/create` no tiene defensas adicionales:** no rate limit, no honeypot, no Origin check. Solo el header `x-api-key` con valor público.

## Uso en el código

- `api/quotes/create.ts` (L21-29): función `isAuthorized()` compara header `x-api-key` o `Authorization: Bearer` contra `process.env.QUOTES_API_KEY`.
- `api/installation-leads/create.ts` (L65-80): acepta `QUOTES_API_KEY` como bypass.
- `api/estudio-luminico/create.ts` (L86-96): acepta `QUOTES_API_KEY` como bypass.
- `src/pages/QuoteCartPage.tsx` (L73-78): envía `import.meta.env.VITE_QUOTES_API_KEY` como header `x-api-key` al llamar a `/api/quotes/create`.
- `.env.example`: solo documenta `QUOTES_API_KEY`; `VITE_QUOTES_API_KEY` no estaba documentada.

## Decisión

Se descartó la rotación simple. En su lugar se ejecuta refactor arquitectural:

1. Alinear `/api/quotes/create.ts` al patrón de los otros dos endpoints: `isAllowedOrigin()` + rate limit in-memory + honeypot.
2. Eliminar `VITE_QUOTES_API_KEY` completamente (del código y de Vercel).
3. Quitar el header `x-api-key` del frontend (`QuoteCartPage.tsx`).
4. Desacoplar bypass cruzado: `installation-leads` y `estudio-luminico` solo aceptarán su propia `INSTALLATION_API_SECRET`, no `QUOTES_API_KEY`.
5. Rotar `QUOTES_API_KEY` a un valor nuevo, estrictamente server-only, reservado para integraciones programáticas futuras (cron, server-to-server).
6. Actualizar `.env.example` acorde.

## Lecciones

- **Cualquier variable con prefijo `VITE_` debe asumirse pública.** No usar `VITE_` para valores que requieren secrecía.
- **El patrón de autenticación de endpoints debe ser consistente.** Mantener 3 endpoints con 3 estrategias de autorización distintas (y con bypass cruzado) es difícil de auditar y propenso a agujeros.
- **La rotación de credenciales requiere auditar primero el uso en código.** Rotar sin entender el flujo puede romper producción silenciosamente o ser teatro de seguridad.
- **Los Guardrails AI Agents funcionaron.** El agente de navegador (Claude en Chrome) detectó ambigüedad (dos variables similares) y se detuvo a reportar antes de actuar. El agente de código (Claude Code) produjo análisis estructurado que permitió tomar una decisión informada. Sin esos puntos de control, la rotación simple habría producido un falso sentido de seguridad o una caída silenciosa del checkout.

## Referencias

- Guardrails AI Agents eLIGHTS.cl — principios 1, 2, 5, 9
- Incidente relacionado por patrón de endpoint hardening: `docs/incident-jumpseller-duplicates-2026-04-10.md`
