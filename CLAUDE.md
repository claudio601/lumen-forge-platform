# CLAUDE.md — lumen-forge-platform (nuevo.elights.cl)

> Archivo de memoria del proyecto. Actualizar después de cada corrección relevante.
> Última revisión: 2026-10-01

---

## 1. Stack y entorno

- **Framework**: Vite + React + TypeScript
- **Deploy**: Vercel (auto-deploy en push a main)
- **Dominio**: nuevo.elights.cl (CNAME verificado)
- **Codespace**: probable-couscous-6vwx754945xf494g.github.dev
- **Email relay**: Google Apps Script
- **Plataforma eCommerce base**: Jumpseller (sitio legacy en elights.cl)

---

## 2. Autenticación Jumpseller

- **Método**: Basic Auth (NO Bearer, NO OAuth)
- **Credenciales**: JUMPSELLER_LOGIN + JUMPSELLER_TOKEN (secretos de GitHub Actions y `.env.local`; ver §14). En Vercel solo se usa `JUMPSELLER_HOOKS_TOKEN` (webhook): no tocar.
- **Formato header**: Authorization: Basic base64(login:token)
- **Endpoint base**: https://api.jumpseller.com/v1/
- ⚠️ **Error histórico**: Usar Bearer en vez de Basic Auth rompe todas las llamadas a la API. Verificar siempre el header antes de debuggear otras causas.

---

## 3. Modelo comercial: cotización → link de pago (decisión del dueño, 2026-09-29)

- El sitio **no tiene checkout propio**. Todo flujo termina en una solicitud (pedido o cotización) que llega a Pipedrive + email; el vendedor responde con un **link de pago de Jumpseller**.
- **Nunca mostrar stock** ("En stock" / "Sin stock"): no hay control de bodega y algunos productos se compran en plaza. Texto estándar: **"Consultar disponibilidad"**.
- **Jumpseller es la única fuente de verdad** de precios, nombres, imágenes, categorías y productos activos. El contenido editorial (fichas BESTLED, FAQ, SEO) se mantiene aparte, asociado por `jumpseller_id`.
- **Despacho**: "Despacho en hasta 2 días hábiles" (versión larga: "y a veces el mismo día"). Nunca "24–48 h" ni "muchas veces".
- Ya eliminados en la Etapa 1: `api/create-order.ts`, `src/pages/CartPage.tsx`, `src/services/jumpsellerCart.ts` y el paso a `elights.cl/checkout` (`/carro` redirige a `/solicitar-pedido`).
- **Montos en Pipedrive**: siempre CON IVA, calculados en el servidor desde el catálogo (`api/_lib/catalog/pricing.ts`); nunca se confía en el precio que manda el navegador.

---

## 4. Fase 3 — Pendiente

- Login de usuarios
- Panel de órdenes
- ⚠️ Definir specs antes de escribir código (seguir modo plan)

---

## 5. Convenciones del proyecto

- **Archivos con caracteres especiales** (tildes, ñ): escribir con Python en Codespaces para evitar encoding issues
- **Push a main** = deploy automático en Vercel — revisar preview antes de mergear
- **Naming**: camelCase para funciones/variables, PascalCase para componentes React
- **Variables de entorno**: NUNCA hardcodear credenciales. Siempre usar .env.local en dev y Vercel env vars en producción
- **Forma de trabajo con Claude** (regla del dueño, 2026-10-01): lo que Claude puede hacer, lo hace él: pruebas en el preview de Vercel, configuración del repo con `gh`, ejecutar workflows, verificar en Pipedrive/Gmail. El dueño solo ingresa credenciales (Claude nunca ve ni escribe tokens, contraseñas ni RUT) y aprueba las fusiones a main.

---

## 6. Reglas aprendidas (errores históricos)

| # | Situación | Regla |
|---|-----------|-------|
| 1 | Basic Auth mal implementado | Siempre verificar el header Authorization antes de debuggear la lógica de negocio |
| 2 | Push directo a main sin revisar | Usar preview de Vercel antes de confirmar deploy |
| 3 | Caracteres especiales corruptos | Usar Python para escribir archivos con tildes/ñ en Codespaces |

---

## 7. Contexto de negocio

- **Empresa**: eLights.cl — iluminación LED industrial y solar, B2B/B2C en Chile
- **Segmentos**: constructoras, ingenieros, arquitectos, instaladores eléctricos, licitaciones públicas
- **Operador**: Claudio (sole operator — web, marketing, ventas, facturación)
- **Agencia externa**: maneja Google Ads, fichas técnicas, diseño web

---

## 8. Comandos útiles del proyecto

```bash
# Dev local
npm run dev

# Build
npm run build

# Preview del build
npm run preview

# Cambios: siempre rama + PR + preview de Vercel (main publica en nuevo.elights.cl)
git switch -c tipo/descripcion
git add <rutas explícitas>        # nunca "git add ." (puede subir archivos ajenos)
git commit -m "mensaje"
git push -u origin HEAD
gh pr create --fill               # revisar la preview de Vercel antes de mergear

# Pruebas
npm test                                        # frontend (src/)
npx vitest run --config vitest.api.config.ts    # funciones api/ y scripts/
```

---

## 9. Prompts de alto impacto (Boris Cherny / equipo Claude Code)

**Corrección autónoma de bugs**
- Pegar el error de Vercel/CI y simplemente escribir "fix" — no explicar el contexto
- "Ve a arreglar los tests de CI que fallan" — sin micromanagear cómo
- Apuntar a logs directamente si hay problemas de integración

**Subir el nivel del prompting**
- Como revisor: "Critica mis cambios y no crees el PR hasta que apruebe tu prueba"
- Comparar ramas: "Demuéstrame que esto funciona" → Claude compara main vs feature branch
- Forzar elegancia: "Teniendo en cuenta todo lo que sabes ahora, deshazte de esto e implementa la solución elegante"
- Reducir ambigüedad: escribir specs detalladas antes de entregar el trabajo

---

## 10. Configuración de entorno (Terminal)

- Terminal recomendado: Ghostty (renderizado sincronizado, 24-bit color, unicode correcto)
- /statusline: configurar para mostrar uso de contexto y rama git actual
- tmux: una pestaña por tarea/worktree para mantener contexto separado
- Dictado por voz (macOS: fn x2): prompts más detallados y naturales

---

## 11. Subagentes

- Agregar "usa subagentes" a cualquier solicitud donde quieras más cómputo paralelo
- Delegar tareas individuales a subagentes para mantener el contexto principal limpio
- Ejemplo para lumen-forge-platform:

```
usa 5 subagentes para explorar la base de código:
- puntos de entrada y arranque
- estructura de componentes React
- implementación de herramientas
- gestión de estado
- infraestructura de pruebas
```

- ctrl+b para ejecutar en segundo plano

---

## 12. Claude Code para datos y analítica

- Funciona con cualquier base de datos que tenga CLI, MCP o API
- Para Jumpseller: pedirle a Claude Code que consulte la API directamente para extraer métricas de ventas, productos más vistos, órdenes pendientes
- Patrón: "Extrae las órdenes de los últimos 30 días desde la API de Jumpseller y dime cuáles productos tienen mayor rotación"

---

## 13. Checklist de inicio de sesión

- [ ] Revisar este CLAUDE.md
- [ ] Leer `~/proyectos/elights-auditoria-2026-09-28/ESTADO-ACTUAL.md` (traspaso entre sesiones)
- [ ] Revisar si hay una PR abierta del bot de catálogo (`bot/jumpseller-sync`)
- [ ] Verificar estado de Vercel (último deploy exitoso)
- [ ] Confirmar env vars activas si se agregaron nuevas

---

## 14. Pipeline del catálogo (Jumpseller → sitio)

**Fuentes de verdad**
- **Jumpseller**: precios, nombres, fotos, categorías, productos activos y SKU de variantes.
- `src/data/catalog/overlay/editorial.ts`: contenido editorial (fichas BESTLED, FAQ, SEO), asociado por `jumpseller_id`.
- `src/data/catalog/overlay/overrides.ts`: correcciones puntuales (SKU, marca, lúmenes) por `jumpseller_id`.
- `src/data/catalog/categories.config.ts`: las 15 categorías del sitio y el mapa desde Jumpseller (`JUMPSELLER_TOP_CATEGORY_TO_SLUG`).
- `scripts/jumpseller/denylist.json`: productos de Jumpseller que nunca se publican. Tampoco se publican los no disponibles ni los sin categoría.

**Archivos generados: NUNCA editarlos a mano** (los escribe `npm run sync:catalog -- --write`)
- `src/data/catalog/jumpseller-snapshot.generated.ts`
- `src/data/catalog/categories.generated.ts`
- `src/data/catalog/site-ids.generated.ts`: solo crece; da ids estables del sitio a productos nuevos.
- `api/_lib/catalog/price-index.generated.ts`: precios CON IVA que usa el servidor en pedidos y cotizaciones.

**Cómo se actualiza**
- Automático: workflow "Sincronizar catálogo Jumpseller" (`.github/workflows/sync-jumpseller.yml`), de lunes a viernes a las 11:00 UTC. Si hay cambios, abre o actualiza la PR `bot/jumpseller-sync` con el informe; se revisa y se fusiona como cualquier PR. Si no hay cambios, no abre nada.
- A mano: `gh workflow run sync-jumpseller.yml` (o Actions → Run workflow).
- Local: `npm run sync:catalog` (solo informe, en `reports/jumpseller-sync/diff.md`); `-- --write` escribe los generados. Necesita `.env.local`.
- Guardas (abortan sin escribir): cae más del 15% de productos, ids duplicados, precio ≤ 0, categoría sin mapear, datos que no pasan la validación, campos prohibidos.
- GitHub desactiva los workflows programados tras 60 días sin actividad en el repo. Si pasa: `gh workflow enable sync-jumpseller.yml`.

**Secretos** (los valores los pone el dueño; Claude nunca los ve)
- GitHub Actions: `JUMPSELLER_LOGIN`, `JUMPSELLER_TOKEN` (Settings → Secrets and variables → Actions).
- Local: los mismos dos en `.env.local` (gitignored).

**Reglas**
- El repo es público: nunca deben llegar a archivos versionados `cost_per_item`, el stock ni la descripción cruda de Jumpseller. `--save-raw` solo escribe en `reports/` (gitignored).
- Agentes: el MCP de Jumpseller es solo de lectura (`get_*`/`list_*`/`search_*`). Para sincronizar se usa `gh workflow run`; el sitio nunca escribe en Jumpseller.
- Fotos: CDN de Jumpseller (`src/lib/jumpsellerImage.ts`). `npm run warm:images` precalienta los tamaños que usa el sitio.

---

> Actualizar este archivo después de cada corrección significativa o decisión de arquitectura.
