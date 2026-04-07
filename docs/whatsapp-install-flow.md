# Flujo WhatsApp: Captura de Lead de Instalacion

**Archivo fuente:** `api/_lib/whatsapp/flowEngine.ts`  
**Ultima actualizacion:** 2026-04-07  
**Commits relevantes:** `1210af2` (flujo inicial) · `20928b3` (hotfix regex escaping)

---

## Resumen

Cuando un usuario del bot de WhatsApp expresa intencion de contratar el servicio de
instalacion de iluminacion LED, el bot NO deriva de inmediato. En cambio, activa el
subflujo `install_capture` para capturar los datos minimos requeridos antes de crear
el deal en Pipedrive y confirmar la derivacion al usuario.

Regla de negocio central: **sin correo no podemos cotizar**.

---

## Archivo fuente

```
api/_lib/whatsapp/flowEngine.ts
```

El subflujo esta delimitado por los comentarios:

```typescript
// [INSTALL-FLOW] Deteccion de intencion de instalacion/servicio
// ...
// FIN INSTALL-FLOW — flujo normal de productos LED
```

---

## Regla de negocio

| Condicion | Resultado |
|---|---|
| Usuario menciona instalacion, faltan datos | Bot pide los campos faltantes |
| Datos minimos completos | Bot confirma derivacion, `shouldCreateDeal = true` |
| Mas de 3 turnos sin completar datos, tiene correo | `shouldCreateDeal = true`, cierre parcial |
| Mas de 3 turnos sin completar datos, sin correo | `shouldCreateDeal = false`, cierre sin deal |

**"instalacion" NO es senial B2B.** La palabra fue removida del regex `B2B_SIGNAL_RE`
para no contaminar el flujo de productos LED con seniales B2B incorrectas.

---

## Campos minimos requeridos

Estos 4 campos deben estar presentes para que `shouldCreateDeal = true`:

| Campo interno | Descripcion | Ejemplo |
|---|---|---|
| `install_nombre` | Nombre completo del contacto | Juan Perez |
| `install_correo` | Correo electronico | juan@gmail.com |
| `install_comuna` | Comuna o ciudad | Santiago, Maipu |
| `install_tipo_proyecto` | Tipo de espacio o proyecto | casa, oficina, local comercial |

### Campos opcionales recomendados

| Campo interno | Descripcion |
|---|---|
| `install_telefono` | Telefono de contacto (autodetectado) |
| `install_descripcion` | Descripcion breve del proyecto |

---

## Comportamiento del flujo

### Deteccion de intencion

El regex `INSTALL_INTENT_RE` activa el flujo si el mensaje contiene alguna de estas
palabras o frases (con variantes de tilde y plural):

```
instalacion · instalar · servicio de instal· · quiero instalar · necesito instalar
cotizar instalacion · proyecto de instalacion · instalador · instaladores
```

### Estados del subflujo

```
stage1 / stage2 / stage3
  └── INSTALL_INTENT_RE detectado
        └── mergeInstallFields() — extrae campos del mensaje
              ├── 4 campos presentes → stage: closed, shouldCreateDeal: true
              └── campos faltantes  → stage: install_capture
                    └── turnos de captura (max 3 repreguntasInstall)
                          ├── campos completos → closed, shouldCreateDeal: true
                          └── timeout con correo → closed, shouldCreateDeal: true
                          └── timeout sin correo → closed, shouldCreateDeal: false
```

### Logica de merge

`mergeInstallFields()` extrae informacion del mensaje en este orden de prioridad:

1. Datos parseados por Claude (`claudeParsed.nombre`, `correo`, `comuna_o_ciudad`, `proyecto_o_uso`)
2. Extraccion regex del texto crudo (`extractEmail`, `extractCiudad`, `extractInstallTipoProyecto`)
3. Solo sobreescribe campos que aun no han sido capturados (no borra datos ya guardados)

### Mensajes del bot

| Situacion | Constante | Texto aproximado |
|---|---|---|
| Primer mensaje, faltan todos los datos | `buildInstallCaptureMsg` | "Perfecto. Para derivar tu solicitud de instalacion y poder cotizarte, necesito estos datos: nombre completo, correo, comuna y tipo de proyecto." |
| Faltan algunos campos | `buildInstallCaptureMsg` | "Gracias. Para completar tu solicitud de instalacion, necesito que me indiques: ..." |
| Solo falta un campo | `buildInstallCaptureMsg` | "Casi listo. Solo me falta tu [campo]..." |
| Cierre exitoso | `MSG4_INSTALL` | "Perfecto, tu solicitud de instalacion quedo registrada. Un ejecutivo de eLIGHTS te contactara..." |

---

## Ejemplos de conversacion

### Caso 1 — Intencion sin datos (no crea deal)

```
Usuario: "Hola, me interesa el servicio de instalacion"
Bot:     "Perfecto. Para derivar tu solicitud de instalacion y poder cotizarte,
          necesito estos datos: nombre completo, correo, comuna y tipo de proyecto."

shouldCreateDeal: false
stage: install_capture
```

### Caso 2 — Intencion con correo parcial (no crea deal)

```
Usuario: "Quiero instalacion, mi correo es juan@gmail.com"
Bot:     "Gracias. Para completar tu solicitud de instalacion, necesito que me indiques:
          1) Nombre completo
          2) Comuna
          3) Tipo de proyecto (casa, departamento, oficina, etc.)"

shouldCreateDeal: false
install_correo: juan@gmail.com  (capturado)
stage: install_capture
```

### Caso 3 — Intencion con datos completos (crea deal)

```
Usuario: "Hola, soy Juan Perez, juan@gmail.com, Santiago, quiero instalacion en mi casa"
Bot:     "Perfecto, tu solicitud de instalacion quedo registrada.
          Un ejecutivo de eLIGHTS te contactara a la brevedad..."

shouldCreateDeal: true
install_nombre: Juan Perez
install_correo: juan@gmail.com
install_comuna: Santiago
install_tipo_proyecto: casa
stage: closed
```

### Caso 4 — Consulta LED normal (flujo intacto)

```
Usuario: "Hola, necesito 10 focos LED para mi oficina en Providencia"
Bot:     [Flujo stage1/stage2/stage3 normal de productos LED]

install_capture: NO activado
flujo LED: intacto
```

---

## Integracion con Pipedrive

El archivo `api/_lib/whatsapp/pipedriveLead.ts` es el encargado de crear el deal.
`flowEngine.ts` solo determina si `shouldCreateDeal` es `true` o `false`.
`webhook.ts` es el orquestador: llama a `processFlowStep()` y, si `shouldCreateDeal === true`,
invoca la creacion del deal en Pipedrive.

Los campos de instalacion se mapean en Pipedrive asi:

| Campo install_capture | Campo Pipedrive |
|---|---|
| `install_nombre` | Nombre del contacto |
| `install_correo` | Email del contacto |
| `install_comuna` | Campo personalizado: comuna/ciudad |
| `install_tipo_proyecto` | Campo personalizado: proyecto/uso |
| `install_telefono` | Telefono del contacto (si fue capturado) |

El deal se etiqueta con `leadType: B2C` por defecto para flujos de instalacion residencial.

---

## Notas de mantenimiento

- El subflujo `install_capture` es **independiente** del flujo de productos LED (`stage1/stage2/stage3`).  
  No los modifiques en el mismo bloque.
- El regex `INSTALL_INTENT_RE` usa doble escape en el archivo TypeScript (`\b`, `\s`) porque
  fue construido con `Array.push() + join()` para evitar que el editor web de GitHub
  corrompa los backslashes (ver commit `20928b3`).
- Para agregar nuevas palabras de activacion, editar `INSTALL_INTENT_RE` en `flowEngine.ts`.
- Para cambiar los campos obligatorios, editar `getMissingInstallFields()` en `flowEngine.ts`.
- Para cambiar el copy del bot, editar `buildInstallCaptureMsg()` y la constante `MSG4_INSTALL`.
- El estado de la sesion se guarda en memoria (`flowStates: Map<string, FlowState>`).  
  Si el servidor se reinicia, el contexto de conversaciones en curso se pierde (comportamiento esperado).

---

## Commits relevantes

| Commit | Descripcion |
|---|---|
| [`1210af2`](https://github.com/claudio601/lumen-forge-platform/commit/1210af21a095d4e6cb6105386028ddea8de23391) | `fix(bot): add install_capture flow — no handoff without required lead data` |
| [`20928b3`](https://github.com/claudio601/lumen-forge-platform/commit/20928b3) | `fix(bot): hotfix regex escaping — restore backslashes lost in commit 1210af2` |

---

## Ver tambien

- [`CLAUDE.md`](../CLAUDE.md) — Contexto general del proyecto y arquitectura
- [`api/_lib/whatsapp/flowEngine.ts`](../api/_lib/whatsapp/flowEngine.ts) — Codigo fuente completo del motor de flujo
- [`api/_lib/whatsapp/webhook.ts`](../api/_lib/whatsapp/webhook.ts) — Orquestador del webhook de WhatsApp
- [`api/_lib/whatsapp/pipedriveLead.ts`](../api/_lib/whatsapp/pipedriveLead.ts) — Creacion de deals en Pipedrive
