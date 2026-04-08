# Bot WhatsApp eLIGHTS — Mapa general

**Ultima actualizacion:** 2026-04-08  
**Archivo fuente principal:** `api/_lib/whatsapp/flowEngine.ts`  
**Orquestador:** `api/whatsapp/webhook.ts`

---

## Resumen

El bot de WhatsApp de eLIGHTS atiende consultas de iluminacion LED y solicitudes de
instalacion a traves de Twilio. Su funcion principal es capturar los datos minimos
de cada lead antes de crear un deal en Pipedrive y derivar al equipo de ventas.

Regla central: **sin correo no podemos cotizar ni derivar.**

---

## Alcance del bot

El bot cubre dos tipos de solicitud diferenciados:

| Tipo | Activacion | Flujo | Doc de referencia |
|---|---|---|---|
| Instalacion de iluminacion | Palabras clave: *instalacion, instalar, servicio de instalacion...* | `install_capture` | [whatsapp-install-flow.md](./whatsapp-install-flow.md) |
| Cotizacion / compra de productos LED | Menciona productos, cantidades, precios, o pide ejecutivo | `stage1 → stage2 → stage3` | [whatsapp-commercial-gate.md](./whatsapp-commercial-gate.md) |

Ambos flujos conviven en el mismo archivo (`flowEngine.ts`) y son mutuamente excluyentes:
si se detecta intencion de instalacion, el flujo LED normal no se ejecuta.

---

## Flujos principales

### Flujo de instalacion (`install_capture`)

Activa cuando el mensaje contiene intencion de contratar el servicio de instalacion.
El bot pide los 4 campos minimos antes de derivar:

```
Usuario menciona "instalacion"
  └── mergeInstallFields() — extrae lo que ya dio
        ├── 4 campos presentes → deal creado, bot confirma derivacion
        └── campos faltantes  → stage: install_capture
              └── hasta 3 turnos de captura
                    ├── completo → deal creado
                    └── timeout con correo → deal creado
                    └── timeout sin correo → no deal
```

Campos obligatorios: `install_nombre` · `install_correo` · `install_comuna` · `install_tipo_proyecto`

Ver detalle completo: [whatsapp-install-flow.md](./whatsapp-install-flow.md)

### Flujo comercial de productos (`stage1 → stage2 → stage3`)

Activa para consultas de compra o cotizacion de productos LED.  
El bot avanza por 3 etapas de captura progresiva:

```
stage1 — producto, tipo de luz, cantidad
stage2 — espacio o proyecto, comuna o ciudad
stage3 — nombre y correo (B2C) o RUT y correo (B2B)
  └── deal creado solo cuando: correo presente + (producto O proyecto_o_uso)
```

Si el usuario pide ejecutivo antes de completar el flujo, el bot pide el correo
antes de derivar (no crea deal sin correo).

Ver detalle completo: [whatsapp-commercial-gate.md](./whatsapp-commercial-gate.md)

---

## Reglas de creacion de deals

Estas reglas aplican a **ambos flujos** sin excepcion:

| Condicion | shouldCreateDeal |
|---|---|
| Falta correo | `false` — nunca |
| Correo presente pero falta todo contexto (producto y proyecto_o_uso) | `false` |
| Correo + al menos producto O proyecto_o_uso | `true` |
| install_capture: 4 campos obligatorios completos | `true` |
| install_capture: timeout con correo | `true` |
| install_capture: timeout sin correo | `false` |

`flowEngine.ts` decide `shouldCreateDeal`. `webhook.ts` lo ejecuta.
`pipedriveLead.ts` nunca recibe llamadas con correo vacio desde el bot.

---

## Documentos relacionados

| Documento | Que cubre |
|---|---|
| [whatsapp-install-flow.md](./whatsapp-install-flow.md) | Subflujo `install_capture`: campos, mensajes, estados, ejemplos de conversacion |
| [whatsapp-commercial-gate.md](./whatsapp-commercial-gate.md) | Gate de correo en flujo comercial: regla `hasMinCommercial()`, paths corregidos, casos de prueba |

---

## Archivos fuente clave

| Archivo | Rol |
|---|---|
| [`api/_lib/whatsapp/flowEngine.ts`](../api/_lib/whatsapp/flowEngine.ts) | Motor de flujo: toda la logica de estados, captura de campos, `shouldCreateDeal` |
| [`api/whatsapp/webhook.ts`](../api/whatsapp/webhook.ts) | Orquestador: recibe Twilio, llama Claude, llama flowEngine, crea deal si aplica |
| [`api/_lib/whatsapp/pipedriveLead.ts`](../api/_lib/whatsapp/pipedriveLead.ts) | Creacion de deals y personas en Pipedrive |
| [`api/_lib/whatsapp/leadCapture.ts`](../api/_lib/whatsapp/leadCapture.ts) | Heuristicas de deteccion de intencion comercial |
| [`api/_lib/whatsapp/claudeAgent.ts`](../api/_lib/whatsapp/claudeAgent.ts) | Parsing de mensajes con Claude (extrae campos estructurados) |

---

## Commits de referencia

| Commit | Descripcion |
|---|---|
| [`1210af2`](https://github.com/claudio601/lumen-forge-platform/commit/1210af21a095d4e6cb6105386028ddea8de23391) | Flujo `install_capture` inicial |
| [`20928b3`](https://github.com/claudio601/lumen-forge-platform/commit/20928b3) | Hotfix regex escaping en `install_capture` |
| [`13ff693`](https://github.com/claudio601/lumen-forge-platform/commit/13ff693) | Email gate en flujo comercial — funcion `hasMinCommercial()` |
| [`23c804e`](https://github.com/claudio601/lumen-forge-platform/commit/23c804e) | Doc: `whatsapp-install-flow.md` |
