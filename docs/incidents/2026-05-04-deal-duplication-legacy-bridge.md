# Incidente 2026-05-04: Duplicación de deal por gap legacy del bridge

## Resumen ejecutivo

El 30-abr-2026 el bridge Jumpseller→Pipedrive creó un deal duplicado (ID 26928) sobre la cotización JS-12915 de Agrupación Pro Adelanto Sector El Manzano, pese a existir ya el deal canónico (ID 26717). La causa raíz es un gap legacy: el deal canónico fue creado por el bridge antes del PR #14 (que introdujo el poblado automático del custom field `quoteReference`), luego renombrado por Claudio al folio comercial "1301 - 2026", quedando con `quoteReference` vacío. Cuando llegó un nuevo evento sobre JS-12915, `findDealByQuoteReference` consultó `/deals/search` con `exact_match=true` sobre `custom_fields`; Pipedrive no indexa custom fields vacíos, el canónico no fue retornado, y el bridge cayó al path de creación. Se resolvió con cleanup táctico no destructivo: poblado manual de `quoteReference` en el canónico y marcado del duplicado como Perdido con razón explícita. Queda pendiente decidir si el backfill de deals legacy se aborda vía script poblacional (PR #15 / Ticket Z), fix de código en el bridge, o disciplina operacional.

## Caso de referencia

- **Cliente**: Agrupación Pro Adelanto Sector El Manzano
- **Deal canónico**: ID 26717, título "1301 - 2026". Originalmente creado por el bridge como "Cotizacion JS-12915", renombrado por Claudio el 24-abr-2026 10:26 al folio comercial 1301-2026.
- **Deal duplicado**: ID 26928, título "Cotizacion JS-12915 - Agrupación Pro Adelanto Sector El Manzano El Manzano", creado por el bridge vía API el 30-abr-2026 16:01.
- **Diferencia de valores**: CLP 8.278.830 (canónico, precios B2B comerciales) vs CLP 6.424.215 (duplicado, precios web Jumpseller). No son cotizaciones distintas; es la misma cotización con dos snapshots de precio según el flujo que la generó.

## Línea de tiempo

- **(fecha previa al 24-abr-2026)**: cliente arma carrito en Jumpseller. Bridge crea deal con título "Cotizacion JS-12915". Al ser pre-PR-#14, el campo `quoteReference` queda vacío.
- **2026-04-24 10:26 -04**: Claudio renombra el deal a "1301 - 2026" y ajusta el valor a precios B2B comerciales. `quoteReference` sigue vacío.
- **2026-04-29 16:16:34 -04**: PR #14 (commit `e412c69`) mergeado a `main`. `createDealInPipedrive` ahora puebla `quoteReference` en deals nuevos.
- **2026-04-30 16:01 -04**: Jumpseller dispara nuevo evento sobre JS-12915. Bridge ejecuta `findDealByQuoteReference("JS-12915", ...)`, no encuentra match (canónico invisible al search por campo vacío), cae a `createDealInPipedrive` y crea el duplicado 26928.
- **2026-05-04**: detección durante revisión rutinaria de pipeline. Diagnóstico, validación del modelo mental correcto, cleanup táctico aplicado.

## Causa raíz

`findDealByQuoteReference` (en `api/_lib/pipedrive/deals.ts`, líneas 131-154) consulta `/deals/search` con `fields=custom_fields` y `exact_match=true`:

```ts
async function findDealByQuoteReference(
    quoteReference: string,
    pipelineId: number
  ): Promise<PipedriveDeal | null> {
    const fieldKey = process.env.PIPEDRIVE_DEAL_FIELD_QUOTE_REFERENCE;
    if (!fieldKey) return null;
    const res = await pipedriveGet<{ items: Array<{ item: PipedriveDeal }> }>(
          '/deals/search',
      { term: quoteReference, fields: 'custom_fields', exact_match: 'true', limit: '5' }
        );
    if (!res.success || !res.data?.items) return null;
    for (const { item } of res.data.items) {
          if (item.pipeline_id !== pipelineId) continue;
          const full = await pipedriveGet<PipedriveDeal>(`/deals/${item.id}`);
          if (
                  full.success &&
                  full.data &&
                  String(full.data[fieldKey]) === quoteReference
                ) {
                  return full.data;
          }
    }
    return null;
}
```

Pipedrive solo indexa custom fields para `/deals/search` cuando el deal tiene valor poblado en ese campo. Un deal con `quoteReference` vacío es invisible a esta búsqueda, independientemente de que su título contenga "JS-12915". Sin match → la función retorna `null` → el caller cae al path de creación. El deal canónico 26717, al haber sido renombrado y nunca repoblado, era exactamente uno de esos deals invisibles.

## Por qué PR #14 no lo previno

PR #14 cubre el camino forward: deals nuevos creados por el bridge ahora tienen `quoteReference` poblado desde el momento de creación, lo cual los hace visibles a `findDealByQuoteReference` en eventos posteriores. No incluye backfill de deals históricos. Esta es deuda técnica explícita, no un oversight: la decisión consciente fue priorizar el fix forward (cubrir el flujo de creación) y diferir el backfill a Ticket Z / PR #15. Mientras ese backfill no se ejecute, los deals legacy renombrados a folio comercial son bombas de tiempo: cualquier nuevo evento de Jumpseller sobre el mismo JS-XXXXX disparará una duplicación.

## Resolución aplicada

Cleanup táctico no destructivo, sin merge:

- **Paso 1**: poblado manual de `quoteReference="JS-12915"` en el deal 26717 vía Pipedrive UI. Esto blinda al canónico contra futuras duplicaciones (ahora SÍ es visible al bridge).
- **Paso 2**: deal 26928 marcado como Perdido con razón "Otro" + texto custom "Duplicado tecnico" + nota anclada con el texto completo del incidente.
- **Audit trail preservado**: el registro de cambios de Pipedrive sobre el deal 26928 muestra 4 eventos atómicos (Estado, Negocio cerrado el, Fecha de perdido, Razón de la pérdida).

## Por qué no merge

El merge nativo de Pipedrive es destructivo e irreversible: pierde uno de los dos deals y no garantiza preservación granular de campos custom, notas, actividades y participantes. La estrategia "poblar canónico + Lost duplicado con razón explícita" preserva toda la información, mantiene auditoría completa, y blinda el caso contra futuras duplicaciones. Además, evita la pregunta espinosa de cuál de los dos valores monetarios sobrevive: ambos quedan documentados, y el comercial (canónico) permanece intacto.

## Findings adicionales

- **Asimetría de paths**: el path Jumpseller usa `findDealsByTitle` como fallback (líneas 103-128 de `deals.ts`), el path nuevo_elights no tiene fallback equivalente. Documentado como Ticket I, baja prioridad: no resuelve este caso porque el título del canónico renombrado ("1301 - 2026") y el del duplicado nuevo ("Cotizacion JS-12915 - ...") no coinciden por diseño.
- **Matización del hallazgo del 3-may-2026**: la afirmación "empty `quoteReference` is by design" es válida solo para el subgrupo legítimo (deals creados manualmente vía Messaging Inbox o B2B directo, sin paso por Jumpseller). NO aplica al subgrupo gap legacy (deals creados por el bridge pre-PR-#14 y posteriormente renombrados). Distinguir estos dos subgrupos es crítico para cualquier script de detección o backfill.

## Lecciones aprendidas

- **Pipedrive UI**: el botón "Perdido" marca el deal como Lost inmediatamente al click; el modal subsecuente solo asigna razón. Cancelar el modal NO revierte el estado Lost. Verificar siempre el estado tras cualquier acción.
- **Conocimiento operacional**: el flujo real de trabajo (renombrar deal existente vs crear deal nuevo) es información crítica para el diagnóstico que no está capturada en código ni en logs. La memoria del sistema no captura el flujo vivo del operador.
- **Validación pre-acción destructiva**: antes de proponer merge o delete en producción, validar equivalencia entre los objetos involucrados (mismo cliente, misma cotización subyacente, no solo títulos similares).

## Próximas acciones

- **Ticket J** (script `analyze-cross-channel-duplicates.ts`): refinar para detectar Subgrupo A (regex de título "JS-XXXXX" sobre deals con `quoteReference` vacío, marcador del gap legacy) y Subgrupo B (correlación con Jumpseller para deals renombrados a folio comercial sin marca textual residual).
- **PR #15 / Ticket Z**: pendiente de validar que el script de backfill cubre Subgrupo A correctamente antes de merge. Output del script poblacional refinado es prerrequisito.
- **Decisión estratégica Camino 1/2/3**:
  - Camino 1 — proceso/disciplina operacional (no renombrar deals legacy hasta backfill).
  - Camino 2 — fix de código en `findDealByQuoteReference` (fallback por título cuando custom field falla, similar al path Jumpseller).
  - Camino 3 — aceptar duplicación como costo y normalizar cleanup periódico.
  - Decisión diferida hasta tener output del script poblacional refinado.

## Referencias

- PR #14, commit `e412c69` (mergeado 2026-04-29 16:16:34 -04).
- PR #15 (Ticket Z), branch `feat/backfill-quote-reference-script`.
- Tickets activos: H, I, J.
- Pipedrive deal IDs: 26717 (canónico), 26928 (duplicado).
- Código relevante: `api/_lib/pipedrive/deals.ts`, función `findDealByQuoteReference` (líneas 131-154), función `findDealsByTitle` (líneas 103-128).
