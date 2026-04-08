# Gate comercial WhatsApp — Flujo de cotizacion de productos LED

**Archivo fuente:** `api/_lib/whatsapp/flowEngine.ts`
**Ultima actualizacion:** 2026-04-08
**Commit relevante:** `13ff693`

---

## Resumen

El flujo comercial del bot (cotizacion de productos LED, `stage1 → stage2 → stage3`) tenia un bug
donde `shouldCreateDeal` se fijaba en `true` de forma incondicional al hacer cierre parcial.
Esto creaba deals en Pipedrive con correo en blanco (`-`) y estado de captura `incomplete`.

El commit `13ff693` corrigio esto centralizando la decision en una funcion de gate:
`hasMinCommercial(captured)`. Ahora ningun path del flujo comercial crea un deal sin correo.

---

## Archivo fuente

```
api/_lib/whatsapp/flowEngine.ts
```

---

## Problema original

Antes del commit `13ff693`, los cierres parciales en `stage1` y `stage2` tenian
`shouldCreateDeal: true` hardcodeado sin verificar si habia correo:

```typescript
// ANTES — bug
return {
  reply: MSG4,
  shouldCreateDeal: true,   // <-- siempre true, aunque no hubiera correo
  captureStatus: finalStatus,
  ...
};
```

Resultado: Pipedrive recibia deals con:
- **Correo:** `-` (campo vacio mapeado como guion)
- **Estado captura:** `incomplete`
- **Pidio ejecutivo:** `Si`
- Sin producto ni contexto de proyecto

---

## Regla de negocio

> **Sin correo no se cotiza ni se crea deal en Pipedrive.**

El correo es el identificador minimo de contacto. Sin el, eLIGHTS no puede enviar la cotizacion
ni el ejecutivo tiene forma de hacer seguimiento.

Ademas del correo, se requiere al menos un campo de contexto comercial para que el deal tenga
sentido en el pipeline: si un usuario solo dice "hola" y pide ejecutivo, no hay nada que cotizar.

---

## Gate comercial minimo — `hasMinCommercial()`

```typescript
// [FIX-EMAIL-GATE] Verifica si hay contexto comercial minimo para crear deal
// Regla: correo obligatorio + al menos producto O proyecto_o_uso
function hasMinCommercial(captured: CapturedFields): boolean {
  if (!captured.correo) return false;
  const hasContext = Boolean(captured.producto) || Boolean(captured.proyecto_o_uso);
  return hasContext;
}
```

| Condicion | `hasMinCommercial` | Deal creado |
|---|---|---|
| Sin correo, sin contexto | `false` | No |
| Sin correo, con producto | `false` | No |
| Con correo, sin producto ni proyecto | `false` | No |
| Con correo, con producto | `true` | Si |
| Con correo, con proyecto_o_uso | `true` | Si |
| Con correo, con ambos | `true` | Si |

Esta funcion es **privada** (no exportada). Solo la usa `processFlowStep()` internamente.

---

## Paths corregidos en `processFlowStep()`

El gate se aplica en **3 lugares** dentro del flujo comercial de productos:

### Path 1 — Cierre parcial desde `stage1`

Ocurre cuando el usuario no responde a la primera repregunta (repreg1 >= 1 y faltan
2 o mas campos criticos). Antes cerraba con `shouldCreateDeal: true` siempre.

```typescript
// [FIX-EMAIL-GATE] Solo crear deal si hay correo
const canCreateDeal = hasMinCommercial(merged);
console.log('[flowEngine] closePartial stage1, canCreateDeal=' + canCreateDeal + ', correo=' + (merged.correo ?? 'none'));
return { ..., shouldCreateDeal: canCreateDeal, ... };
```

### Path 2 — Cierre parcial desde `stage2`

Ocurre cuando el usuario no responde a la repregunta de stage2 (repreg2 >= 1).

```typescript
// [FIX-EMAIL-GATE] Solo crear deal si hay correo
const canCreateDeal = hasMinCommercial(merged);
console.log('[flowEngine] closePartial stage2, canCreateDeal=' + canCreateDeal + ', correo=' + (merged.correo ?? 'none'));
return { ..., shouldCreateDeal: canCreateDeal, ... };
```

### Path 3 — Usuario pide ejecutivo sin correo (`wantsHuman`)

Nuevo path agregado en este commit. Si el usuario pide ejecutivo antes de dar correo,
el bot le pide el correo explicitamente antes de derivar.

```typescript
// [FIX-EMAIL-GATE] Si el usuario quiere ejecutivo pero no tiene correo, pedirlo primero
if (wantsHuman && !hasCommercialIntent) {
  if (!merged.correo) {
    const hasAnyContext = Boolean(merged.producto) || Boolean(merged.proyecto_o_uso);
    const reply = hasAnyContext ? MSG_NEED_EMAIL : MSG_NEED_EMAIL_AND_CONTEXT;
    saveFlowState(phone, { ...state, stage: 'stage3', captured: merged, wantsHuman: true, leadType: currentLeadType });
    console.log('[flowEngine] wantsHuman sin correo — pidiendo correo antes de derivar');
    return { reply, shouldCreateDeal: false, ..., wantsHuman: true, closedFlow: false };
  }
  // Con correo: puede derivar
  ...
  return { reply: MSG_HUMAN, shouldCreateDeal: true, ... };
}
```

**Nota:** `stage3` no fue modificado porque ya tenia el correo como campo requerido.
El cierre exitoso de `stage3` solo ocurre cuando el usuario efectivamente proporciono su correo.

---

## Mensajes nuevos agregados

```typescript
// Se usa cuando el usuario quiere ejecutivo pero falta correo y ya dio algun contexto
export const MSG_NEED_EMAIL =
  'Perfecto! Para derivar tu solicitud a un ejecutivo necesito tu correo de contacto. Me lo puedes indicar?';

// Se usa cuando el usuario quiere ejecutivo pero no hay correo NI contexto comercial
export const MSG_NEED_EMAIL_AND_CONTEXT =
  'Con gusto te ayudo. Para registrar tu solicitud necesito dos cosas: que producto o proyecto necesitas iluminar, y cual es tu correo de contacto?';
```

---

## Ejemplos de comportamiento

### Caso 1 — Usuario saluda y pide ejecutivo sin dar nada (no crea deal)

```
Usuario: "Hola quiero hablar con un ejecutivo"
Bot:     "Con gusto te ayudo. Para registrar tu solicitud necesito dos cosas:
          que producto o proyecto necesitas iluminar, y cual es tu correo de contacto?"
shouldCreateDeal: false
wantsHuman:       true (guardado en estado)
stage:            stage3
```

### Caso 2 — Usuario da producto y pide ejecutivo, sin correo (no crea deal)

```
Usuario: "Necesito 20 focos LED para mi oficina, quiero hablar con alguien"
Bot:     "Perfecto! Para derivar tu solicitud a un ejecutivo necesito tu correo
          de contacto. Me lo puedes indicar?"
shouldCreateDeal: false
wantsHuman:       true
stage:            stage3
producto:         "focos LED" (capturado)
```

### Caso 3 — Usuario da correo en siguiente turno (ahora si crea deal)

```
Usuario: "juan@empresa.cl"
Bot:     "Perfecto, voy a derivar tu solicitud a un ejecutivo de eLIGHTS..."
shouldCreateDeal: true
correo:           "juan@empresa.cl"
stage:            closed
```

### Caso 4 — Cierre parcial en stage1 sin correo (no crea deal)

```
[Usuario no respondio la repregunta de stage1 — timeout]
shouldCreateDeal: false   <- antes era true (bug)
correo:           (vacio)
captureStatus:    incomplete
Deal en Pipedrive: NO creado
```

### Caso 5 — Cierre parcial en stage2 con correo (si crea deal)

```
[Usuario dio correo en stage2 pero no respondio la repregunta]
shouldCreateDeal: true
correo:           "maria@gmail.com"
producto:         "panel LED"
captureStatus:    partial
Deal en Pipedrive: SI creado
```

---

## Integracion con Pipedrive

`flowEngine.ts` solo decide si `shouldCreateDeal` es `true` o `false`.

El orquestador `api/whatsapp/webhook.ts` es el que llama a `pipedriveLead.ts` cuando
`shouldCreateDeal === true`. El gate garantiza que `pipedriveLead.ts` **nunca recibe
una llamada sin correo desde el flujo del bot**.

Los deals creados por el flujo comercial tienen siempre:
- Email del contacto: presente (garantizado por `hasMinCommercial`)
- Al menos uno de: `producto` o `proyecto_o_uso`
- `sourceSystem: 'whatsapp'`
- `leadType: 'B2C'` o `'B2B'` segun seniales detectadas

---

## Notas de mantenimiento

- `hasMinCommercial()` es privada. Si necesitas cambiar los requisitos minimos, editala
  en `flowEngine.ts` — no hay que tocar `webhook.ts` ni `pipedriveLead.ts`.
- El cierre exitoso de `stage3` (usuario da correo voluntariamente) **no usa**
  `hasMinCommercial` — siempre crea deal porque stage3 ya requirio correo como campo.
- Si en el futuro el correo deja de ser obligatorio (ej: captura solo por telefono),
  el cambio va en `hasMinCommercial()` y en la verificacion de `wantsHuman`.
- Los console.log de cierre parcial incluyen `correo=` para facilitar debug en Vercel logs:
  `[flowEngine] closePartial stage1, canCreateDeal=false, correo=none`
- Este gate es independiente del flujo `install_capture`, que tiene su propia logica
  de cierre en `getMissingInstallFields()` y el timeout de 3 repreguntasInstall.

---

## Commit relevante

| Commit | Descripcion |
|---|---|
| [`13ff693`](https://github.com/claudio601/lumen-forge-platform/commit/13ff693) | `fix(bot): email gate — no crear deal comercial sin correo ni contexto minimo` |

---

## Ver tambien

- [`CLAUDE.md`](../CLAUDE.md) — Contexto general del proyecto y reglas del bot
- [`api/_lib/whatsapp/flowEngine.ts`](../api/_lib/whatsapp/flowEngine.ts) — Codigo fuente completo
- [`api/whatsapp/webhook.ts`](../api/whatsapp/webhook.ts) — Orquestador del webhook
- [`api/_lib/whatsapp/pipedriveLead.ts`](../api/_lib/whatsapp/pipedriveLead.ts) — Creacion de deals
- [whatsapp-bot-overview.md](./whatsapp-bot-overview.md) — Mapa general del bot
- [whatsapp-install-flow.md](./whatsapp-install-flow.md) — Subflujo install_capture (reglas propias)
