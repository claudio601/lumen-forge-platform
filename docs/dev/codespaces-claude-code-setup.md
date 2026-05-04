# Setup y limitaciones de Claude Code ↔ GitHub Codespaces

## Resumen ejecutivo

Claude Code, al invocarse desde un GitHub Codespace, no comparte filesystem ni
secrets con el Codespace del usuario: corre en un sandbox Docker independiente,
de vida corta y sin acceso a las variables de entorno configuradas en el repo.
Esto implica que cualquier commit hecho dentro de Claude Code es efímero hasta
que se pushea a remoto, y que las tareas que dependen de credenciales de
producción no son ejecutables en este entorno. La regla operacional derivada es:
**push inmediato a una branch feature después de cada commit** y **bloquear las
tareas que requieran tokens reales** hasta que exista un mecanismo de inyección
seguro.

---

## Arquitectura observada

Hechos verificados en sesión técnica del 2026-05-04:

- El **Codespace personal del usuario** corre en `/workspaces/lumen-forge-platform`
  con usuario `claudio601` (`uid != 0`).
- Cada sesión de **Claude Code en Codespace** abre un sandbox Docker separado
  en `/home/user/lumen-forge-platform` con usuario `root` (`uid=0`).
- Los dos filesystems **NO comparten** volúmenes ni mounts. Archivos creados en
  uno no son visibles desde el otro.
- Los **secrets de GitHub Codespaces** (configurados en repo Settings →
  Codespaces → Secrets) **solo se inyectan en el Codespace del usuario**, no en
  los sandboxes de Claude Code.
- Cada nueva invocación de Claude Code abre un **sandbox nuevo** con git store
  fresco basado en remoto (`HEAD = origin/main` típicamente).
- Commits hechos dentro del sandbox **no sobreviven** al cierre del sandbox a
  menos que se hayan pusheado a remoto antes.

Evidencia mínima reproducible desde dentro de cada entorno:

```bash
whoami        # claudio601 → Codespace usuario | root → Claude Code sandbox
pwd           # /workspaces/... → Codespace    | /home/user/... → Claude Code
ls -la ~      # estructura de home distinta
env | grep -i token    # presente solo en Codespace usuario
```

---

## Limitaciones derivadas

### Secrets de GitHub Codespaces no llegan a Claude Code

Variables como `PIPEDRIVE_API_TOKEN`, `JUMPSELLER_LOGIN`, `JUMPSELLER_TOKEN`
configuradas en repo Settings → Codespaces se inyectan automáticamente en el
Codespace del usuario, pero **no** en los sandboxes Docker que abre cada sesión
de Claude Code. Resultado: cualquier script que lea `process.env.X_TOKEN` falla
silenciosamente o con `401 Unauthorized` cuando se ejecuta dentro de Claude
Code.

### Commits locales en Claude Code son efímeros

Cada invocación de Claude Code abre un sandbox nuevo. Si un commit no se pushea
a remoto antes de que el sandbox se destruya (cierre de sesión, timeout,
recreación), el commit se pierde irrecuperablemente.

**Caso real registrado el 2026-05-04:**

- Sesión 1: commit `945d3a6` (documento de incidente) creado sin push. Sandbox
  destruido. Commit perdido.
- Sesión 2: commit `0039580` (script Ticket J) creado sin push. Sandbox
  destruido. Commit perdido.
- Recuperación: trabajo reconstruido como `3311f3b` y `3e78aa1`, esta vez con
  push inmediato. Persistió.

### Tareas con credenciales reales están bloqueadas (por ahora)

Mientras no exista un mecanismo soportado de inyección de secrets en el sandbox
de Claude Code, las tareas que requieran tokens productivos no pueden
ejecutarse en este entorno. Opciones posibles a futuro:

- Resolución por parte de Anthropic (inyección oficial de secrets de Codespaces
  al sandbox).
- Setup local de Claude Code en la máquina del usuario, con `.env.local` real.
- Secret manager intermedio (Vault, AWS Secrets Manager, GCP Secret Manager)
  con credenciales scoped.
- Staging de Pipedrive / Vercel con tokens propios para pruebas no destructivas.

---

## Patrón correcto de operación

### Regla 1 — Push inmediato después de cada commit

```bash
# En sesión Claude Code, después de cualquier commit:
git push -u origin feat/<feature-branch>
```

Las branches feature en GitHub son seguras: no contaminan `main`, no disparan
deploys automáticos en Vercel a producción y permiten review antes de mergear.
**Nunca confiar en "commit local" como persistencia.**

### Regla 2 — Una tarea por sesión Claude Code

Refuerza el guardrail #5: duplicar sesiones en paralelo causa colisiones de
branches y estado git inconsistente entre sandboxes.

### Regla 3 — Verificar persistencia antes de cerrar

```bash
# Confirmar push exitoso:
git status                              # debe decir "up to date with origin/..."
git log origin/<branch> --oneline -3    # debe listar tus commits
```

Si `git status` muestra "ahead of origin" al cerrar la sesión, el trabajo se
perderá.

---

## Identificar contexto de ejecución desde dentro

| Indicador                 | Claude Code sandbox            | Codespace del usuario                |
|---------------------------|--------------------------------|--------------------------------------|
| `whoami`                  | `root`                         | `claudio601`                         |
| `id -u`                   | `0`                            | distinto de `0`                      |
| `pwd` (repo)              | `/home/user/lumen-forge-platform` | `/workspaces/lumen-forge-platform` |
| `$HOME`                   | `/root` o `/home/user`         | `/home/codespace`                    |
| Secrets en `env`          | ausentes                       | presentes                            |
| Persistencia entre sesiones | ninguna                      | sí (filesystem del Codespace)        |

---

## Tareas que SÍ funcionan en Claude Code sin credenciales

- Refactor de código sin tocar producción.
- Tests con mocks (vitest, jest, etc.).
- Dry-run scripts (con flag obligatorio `--confirm-readonly` que sale sin
  tocar la API real).
- Documentación.
- Lectura de código del repo.
- Verificación de estado git (read-only: `status`, `log`, `diff`, `fetch`).

---

## Tareas que NO funcionan en Claude Code (hasta resolución)

- Ejecución de scripts contra Pipedrive, Vercel o cualquier API que requiera
  token productivo.
- Acceso a archivos del filesystem del Codespace del usuario (`.env.local`,
  archivos subidos por el usuario, exports temporales, etc.).
- Verificación funcional contra producción.
- Tareas que requieran observar side-effects en sistemas externos reales.

---

## Workarounds para tareas bloqueadas

### Opción A — Claude en Chrome para acciones de UI

Útil para acciones que requieren navegador autenticado: rotación de tokens en
modo co-piloto, navegación read-only de admin panels (Pipedrive, Jumpseller,
Vercel), verificación de logs de deploy y dashboards.

### Opción B — Setup local de Claude Code (futuro)

Pendiente de evaluación. Requeriría instalar Claude Code en la máquina del
usuario con acceso directo a `.env.local` real. Implica revisar implicancias
de seguridad de tener credenciales productivas en disco local.

### Opción C — Staging environment con secrets propios

Pendiente de evaluación. Crear stack staging (Pipedrive sandbox, deploy preview
de Vercel con tokens scoped) que pueda recibir tokens no productivos seguros
de exponer al sandbox de Claude Code.

---

## Referencias

- `docs/incidents/2026-05-04-deal-duplication-legacy-bridge.md` — caso que
  originó este descubrimiento.
- Memoria interna: regla operacional "commits efímeros en Claude Code"
  (registrada el 2026-05-04).
- Guardrail #5 — una tarea por sesión Claude Code.
- Guardrail #6 — strict agent role separation.
