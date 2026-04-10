# Bitácora de Incidente — Jumpseller Deals Duplicados

**Fecha:** 2026-04-10
**Repo:** claudio601/lumen-forge-platform
**Estado:** CERRADO

## Problema
La integración Jumpseller → Pipedrive creaba deals duplicados en Pipedrive cuando
llegaban eventos paralelos (order_created + order_paid) o reenvíos del mismo webhook.

## Causa raíz
Ausencia de idempotencia distribuida. El handler procesaba cada evento de forma
independiente sin verificar si el deal ya existía, y sin lock que previniera
ejecuciones concurrentes entre invocaciones serverless paralelas.

## Solución implementada
- Redis distribuido (Upstash REST) con lock SET NX PX 30s y mapping persistente
  `idempotency:jumpseller:{orderId} → dealId` con TTL 30 días
- Política de eventos: `order_paid` / `order_updated` nunca crean deals nuevos
- Fallback legacy por título con backfill automático del campo custom
- Fail-closed: si Redis no está disponible en evento creador → HTTP 503 (Jumpseller reintenta)
- 13 archivos modificados en `api/` (incluyendo `api/jumpseller/webhook.ts`)

## Validación real (2026-04-10, nuevo.elights.cl)
| Prueba | HTTP | dealStatus |
|---|---|---|
| order_created primera vez | 201 | created (deal 26328) |
| order_created reenvío | 200 | skipped_duplicate |
| order_paid | 200 | updated (sin deal nuevo) |
| order_shipped | 200 | ignored |
- Campo custom `jumpsellerOrderId` = `"99991"` (raw, sin prefijo JS-)
- Key Redis `idempotency:jumpseller:99991` = `"26328"`, TTL ~30 días

## Estado final
WEBHOOK OPERATIVO EN PRODUCCIÓN

## Pendientes menores (no bloqueantes)
- `bun.lockb` y `package-lock.json` desactualizados (lockfile de texto `bun.lock` sí está sync)
- 50+ deals legacy con campo custom vacío (backfill automático al próximo webhook de Jumpseller para cada pedido)
