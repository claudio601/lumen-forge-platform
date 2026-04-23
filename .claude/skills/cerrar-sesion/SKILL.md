---
name: cerrar-sesion
description: Generar resumen de cierre de sesión de trabajo en proyectos de Claudio (lumen-forge-platform, eLights, agentes Pipedrive/WhatsApp, kLONRadio, gestión Punto C). Activa esta skill SIEMPRE que el usuario diga "cerramos sesión", "cerrar sesión", "cierre de sesión", "terminamos", "cerremos", "fin de sesión", o cualquier variante que indique que quiere terminar la sesión de trabajo y dejar registro de lo hecho. Genera un bloque estructurado con fecha, duración estimada, tareas completadas, estado del proyecto, pendientes priorizados, y un prompt copiable listo para pegar en Claude Code o en una nueva conversación de Claude para retomar exactamente donde se dejó. También úsala cuando el usuario pida un "resumen de sesión", "log de sesión", "qué hicimos hoy", o "prepárame el handoff".
---

# Cerrar Sesión

Skill para generar el cierre de sesión de trabajo de Claudio en sus proyectos (principalmente lumen-forge-platform / eLights, pero aplica a cualquier sesión sustantiva: agentes, música, gestión Punto C, etc.).

El objetivo es producir **un solo bloque markdown copiable** que sirva tanto como registro histórico como prompt de re-entrada para la próxima sesión (sea en Claude Code o en una nueva conversación de Claude).

## Cuándo activar

Frases gatillo (no exhaustivas):
- "cerramos sesión" / "cerrar sesión" / "cerremos"
- "terminamos por hoy" / "fin de sesión"
- "resumen de sesión" / "log de sesión"
- "qué hicimos hoy" / "prepárame el handoff"
- "déjame el resumen para retomar"

Si la conversación fue muy corta (< 3 intercambios sustantivos) o puramente conversacional sin trabajo concreto, pregunta antes de generar el bloque: "¿Quieres que igual genere el cierre formal o solo te dejo notas sueltas?"

## Estructura del bloque de cierre

Genera SIEMPRE este formato exacto, en español, dentro de un bloque markdown copiable:

```markdown
# 📋 Cierre de sesión — [PROYECTO] — [FECHA dd/mm/aaaa]

**Duración estimada:** ~Xh
**Sesión #:** [si Claudio lleva conteo, indicarlo; si no, omitir]

## ✅ Completado en esta sesión
- [Tarea 1 — concreta, con archivo/commit/decisión específica]
- [Tarea 2]
- [Tarea N]

## 📊 Estado actual del proyecto
[2-4 líneas describiendo dónde quedó el proyecto: qué fase está activa, qué funciona, qué está bloqueado. Referenciar fases del roadmap si aplica — F1, F2, F3, etc.]

## 🚧 Pendientes priorizados (próxima sesión)
1. **[Alta]** [Tarea más urgente — qué hay que hacer y por qué]
2. **[Media]** [Siguiente]
3. **[Baja]** [Después]

## 🐛 Bugs conocidos / deuda técnica
- [Bug 1 si existe]
- [Si no hay, omitir esta sección completa]

## 🔑 Decisiones técnicas tomadas
- [Decisión 1 — útil para no re-discutir en próxima sesión]
- [Si no hubo decisiones nuevas, omitir esta sección]

---

## 🔄 Prompt de re-entrada (copiar a Claude Code o nueva conversación)

```
Estoy retomando la sesión de [PROYECTO] del [FECHA].

**Contexto:**
[1-2 líneas con el estado actual del proyecto]

**Lo último que hicimos:**
[Resumen de 2-3 líneas de lo más reciente]

**Próxima tarea concreta:**
[Tarea #1 de pendientes priorizados, con suficiente detalle para arrancar de inmediato]

**Archivos relevantes:**
- [archivo1.ext]
- [archivo2.ext]

Empecemos por [acción concreta].
```

---

📝 **Para tu log histórico:** `[FECHA] Xh — [resumen de una línea]`
```

## Reglas de generación

### Sobre la fecha
Usa la fecha real de hoy. Si tienes acceso a herramientas de tiempo del sistema, úsalas. Si no, usa la fecha del prompt.

### Sobre la duración
Estima en base a la cantidad y profundidad de intercambios. Heurística rápida:
- 5-10 mensajes sustantivos → ~1h
- 10-25 mensajes → ~2-3h
- 25+ mensajes con código y archivos → 4h+

Si Claudio menciona en la conversación cuánto tiempo lleva trabajando, úsalo en vez de la heurística.

### Sobre el proyecto
Identifica el proyecto principal de la sesión por contexto. Los más comunes en orden de probabilidad:
1. **lumen-forge-platform / nuevo.elights.cl** — desarrollo del nuevo sitio
2. **eLights operación** — cotizaciones, clientes, leads, fichas técnicas
3. **WhatsApp Bot (Fase 3c)** — Twilio + webhook
4. **Pipedrive integration (Fase 5)**
5. **kLONRadio / GT-1000** — música, presets, pedalboard
6. **Punto C** — bar
7. **Casa La Florida** — renovación

Si la sesión tocó varios proyectos, usa el principal en el título y menciona los otros en "Estado actual".

### Sobre las tareas completadas
Sé concreto. Mal: "Avanzamos en el bot". Bien: "Implementé `wantsHuman` forzando `shouldCreateDeal` en webhook (commit `bcda1f6`)". Si hubo commits, archivos editados, decisiones, menciónalos por nombre.

### Sobre los pendientes priorizados
Máximo 5 ítems. Si hay más, agrupa o deja los demás para "deuda técnica". La prioridad **Alta** se reserva para bloqueadores o cosas con deadline (ej: DS1 octubre 2026, lanzamiento F4, redeploy pendiente).

### Sobre el prompt de re-entrada
Es la parte más importante. Debe permitir que Claudio (o una nueva sesión de Claude/Claude Code) retome **sin tener que leer toda la conversación anterior**. Incluye lo mínimo viable para arrancar: contexto + última acción + próxima tarea + archivos. Nada más.

### Sobre el log histórico (línea final)
Formato exacto que Claudio ya usa: `[FECHA] Xh — descripción de una línea`. Ejemplo: `22/04/2026 2h — Configuración WhatsApp env vars y test E2E sandbox`.

## Casos especiales

**Sesión sin trabajo técnico (solo discusión/estrategia):** Igual genera el cierre, pero la sección "Completado" lista decisiones tomadas y "Archivos relevantes" puede omitirse o reemplazarse por "Notas relevantes".

**Sesión con bloqueo no resuelto:** En el prompt de re-entrada, sé explícito sobre qué está bloqueado y qué se intentó. Ejemplo: "Twilio sigue rechazando el webhook con error 11200, ya probamos X e Y, falta probar Z".

**Sesión multi-proyecto:** Genera UN solo bloque pero usa subsecciones por proyecto en "Completado" y "Pendientes". El prompt de re-entrada se enfoca en el proyecto donde Claudio explícitamente quiera continuar (pregúntale si no es obvio).

**Si Claudio menciona "Sesión #X":** Respétalo y úsalo. Si no, no inventes numeración.

## Ejemplo de salida bien hecha

```markdown
# 📋 Cierre de sesión — lumen-forge-platform — 22/04/2026

**Duración estimada:** ~2h

## ✅ Completado en esta sesión
- Creación de skill `cerrar-sesion` para automatizar este ritual
- Revisión de tips de Claude Code del equipo Anthropic (post @axel_jutoran)
- Identificadas 3 skills de proyecto a crear: `deploy-vercel`, `nuevo-producto-jumpseller`, `cerrar-sesion`

## 📊 Estado actual del proyecto
Fase 4 (Launch) en progreso. Bugs pendientes: página de producto en blanco y `Header.tsx` sin actualizar a logo nuevo. WhatsApp Bot (F3c) con lógica completa, falta solo infraestructura Twilio.

## 🚧 Pendientes priorizados (próxima sesión)
1. **[Alta]** Arreglar bug página de producto en blanco — escribir spec detallado antes de codear (aplicar tip #6c)
2. **[Alta]** Actualizar `Header.tsx` para referenciar `public/logo.svg`
3. **[Media]** Configurar 5 env vars Twilio en Vercel y redeploy
4. **[Media]** Crear skill `deploy-vercel` con checklist de env vars + smoke test
5. **[Baja]** Crear skill `nuevo-producto-jumpseller`

## 🔑 Decisiones técnicas tomadas
- Adoptar el patrón de skills de proyecto (en `lumen-forge-platform/.claude/skills/`) además de skills personales

---

## 🔄 Prompt de re-entrada

```
Estoy retomando la sesión de lumen-forge-platform del 22/04/2026.

**Contexto:**
Fase 4 (Launch) en progreso. Tengo 2 bugs visuales pendientes antes de poder anunciar.

**Lo último que hicimos:**
Creamos la skill `cerrar-sesion` y planificamos el approach para los bugs aplicando tip #6c (specs detalladas antes de codear).

**Próxima tarea concreta:**
Escribir el spec del bug "página de producto en blanco": comportamiento esperado, archivos involucrados (probablemente `src/pages/ProductDetail.tsx` y `src/data/products.ts`), criterio de éxito, y casos a probar. Recién entonces pedirle a Claude Code que lo arregle.

**Archivos relevantes:**
- src/pages/ProductDetail.tsx
- src/components/Header.tsx
- public/logo.svg

Empecemos por revisar el componente ProductDetail.tsx y entender por qué renderiza en blanco.
```

---

📝 **Para tu log histórico:** `22/04/2026 2h — Skill cerrar-sesion creada + planificación bugs F4`
```

## Notas finales

- El emoji 📋 al inicio del título es intencional — facilita encontrar visualmente los cierres en historial de chats.
- NO uses bullets fuera del bloque generado. La conversación previa puede ser larga, pero el output de esta skill es UN solo bloque markdown limpio.
- Si Claudio pide ajustes al cierre generado (agregar algo, quitar algo), edítalo y vuelve a entregar el bloque completo, no parches.
