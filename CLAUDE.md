# CLAUDE.md — lumen-forge-platform (nuevo.elights.cl)

> Archivo de memoria del proyecto. Actualizar después de cada corrección relevante.
> Última revisión: 2026-10-05

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
npm run build && npm run check:prerender        # páginas estáticas (dist/)
npm run smoke -- https://nuevo.elights.cl --all # después de cada merge: todas las páginas y assets
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

**Ids del sitio (URLs `/producto/:id`)**
- Orden: `src/data/catalog/renamed-ids.ts` (renombrados a mano) gana sobre `site-ids.generated.ts` (productos nuevos) y `legacy-ids.ts` (catálogo legado, congelado: no editarlo; `scripts/migrate/extract-overrides.ts` lo reescribiría).
- `renamed-ids.ts` (PR 07: los 50 ids que el catálogo legado cortó en la última '/' del permalink, como `w-ip66`): se mantiene a mano y **solo crece**. Nunca borrar una fila (las URLs nuevas darían 404). Cada id anterior redirige con 301 al vigente y **nunca se reutiliza**: la sincronización y `build.ts` lo tratan como ocupado. El robot nunca escribe este archivo ni `vercel.json`.
- Renombrar otro id: agregar su fila (en un segundo renombre, el id actual pasa al final de `previous`), correr `npm run redirects:write` y revisar `git diff vercel.json`. El id nuevo se escribe literal, nunca se recalcula desde el permalink.
- Ids de productos nuevos (`newSiteId`): el permalink sin %XX, tildes, puntos ni comas (solo `[a-z0-9-]`); si está ocupado, se agrega `-<jumpseller_id>`.
- No limpiar permalinks en Jumpseller para que coincidan con estos ids antes del cambio de dominio: son las URLs vivas de elights.cl (Ads y SEO).

**URLs de elights.cl (PR 08): `scripts/redirects/legacy-urls.json`**
- Una fila por URL vieja de elights.cl: el sitemap del 2026-10-05, el borrador de la auditoría, los permalinks anteriores que Jumpseller todavía redirige, `/search` y una página oculta del blog (473 filas). Se mantiene **a mano** y **solo crece**: el robot nunca lo escribe y nunca se borra una fila (`legacy-sources.baseline.txt` congela las 473 del 2026-10-05; la prueba exige que sigan y que las que tenían regla la conserven). Ordenada por `source`, una fila por línea.
- Cada fila lleva `source`, exactamente uno de estos campos y, si hace falta, `note`:
  - `product: <jumpseller_id>`: 301 a `/producto/<id vigente>` (el mismo orden de §Ids del sitio; sin cadenas);
  - `category: <slug>`: 301 a `/catalogo/<slug>`. También los productos que ya no se venden (fijos en su categoría, p. ej. el Puzzle LED 12W);
  - `path`: 301 a una página fija de `LEGACY_PAGE_DESTINATIONS` en `build.ts`: `STATIC_ROUTES` (incluye `/`) o `/buscar`, nunca `/cotizacion` ni `/solicitar-pedido`. Ejemplos: `/home` → `/`, `/contact` y `/contactos` → `/cotizador`, `/search` → `/buscar` (conserva `?q=`);
  - `served: true`: el sitio nuevo sirve esa misma URL (`/`, `/catalogo`), sin regla;
  - `gone: "<motivo>"`: 404 definitiva y aprobada (productos de prueba, páginas de relleno de Jumpseller);
  - `pending: "<motivo>"`: 404 por ahora (blog, páginas de la PR 12, `/quieres-ser-nuestro-proveedor`, `/trabaja-con-nosotros`). **Antes de la Etapa 3 no puede quedar ninguna.**
- `source` es exactamente lo que manda el navegador (la canónica de Jumpseller): minúsculas, sin barra final, `.` `,` `_` tal cual y lo no ASCII en `%XX` mayúscula (`p%C3%BAblico`). Vercel compara la ruta sin decodificar y distingue mayúsculas: `/CAMPANA_LED`, `%c3%ba` o una `ú` sin codificar dan 404 (Jumpseller las aceptaba; navegadores y Google usan la canónica).
- Un permalink nuevo o cambiado en Jumpseller (producto o categoría) necesita su fila antes de la Etapa 3: `check:prerender` avisa de los productos publicados sin fila. Si un producto sale del catálogo, su 301 lleva a una 404: `check:prerender` avisa y su fila se cambia a mano a `category`.
- Después de editar: `npm run redirects:write` y revisar `git diff vercel.json`.

**Archivos generados: NUNCA editarlos a mano** (los escribe `npm run sync:catalog -- --write`)
- `src/data/catalog/jumpseller-snapshot.generated.ts`
- `src/data/catalog/categories.generated.ts`
- `src/data/catalog/site-ids.generated.ts`: solo crece; da ids estables del sitio a productos nuevos.
- `api/_lib/catalog/price-index.generated.ts`: precios CON IVA que usa el servidor en pedidos y cotizaciones.
- `src/data/catalog/descriptions.generated.ts`: descripción de cada producto, **limpiada** en la sincronización (`scripts/jumpseller/sanitize-description.ts`: solo párrafos, listas, negritas, tablas y enlaces https; sin atributos). El texto va en "Descripción"; la tabla se ordena en los grupos de las fichas BESTLED (`scripts/jumpseller/spec-groups.ts`: Eléctrico y fotométrico / Construcción y operación / Componentes y control) y se muestra en "Especificaciones técnicas". Solo la importa la ficha de producto. Los 7 BESTLED muestran su texto y especificaciones editoriales (decisión del dueño: mejor para SEO).
- `src/data/catalog/og-images.generated.ts`: formato real (por sus bytes), peso y medidas de la primera foto de cada producto. Decide la imagen para compartir (WhatsApp, Facebook) con la regla de `src/lib/seo/ogImage.ts`: la foto propia si es PNG o JPEG de menos de 600 KB; si no (pesada o WebP), la imagen de la marca (`/og-default.jpg`). La sincronización (`scripts/jumpseller/og-images.ts`) pide solo la primera foto, con Range de 64 KB a `images.jumpseller.com`, sin credenciales; guarda por URL (solo revisa fotos nuevas o cambiadas; `--recheck-images` las revisa todas). Una que falla solo se informa y se reintenta al día siguiente. Para que una ficha use su foto: subir en Jumpseller un PNG o JPG de menos de 600 KB como primera foto (el informe las lista). Solo la importa la ficha de producto.

**Contenido SEO por producto (formato BESTLED, decisión del dueño 2026-10-01: "para todos los productos hay que seguir el formato publicado con la bestled")**
- `src/data/catalog/content/<jumpseller_id>.json`: descripción con subtítulos, beneficios clave, casos de uso, instalación y preguntas frecuentes de cada producto (no BESTLED). Un archivo por producto: solo se descarga al abrir esa ficha (`src/data/catalog/content.ts`).
- Se escribe **solo con datos de Jumpseller**: `npm run content -- export` deja los datos de cada producto en `reports/content/facts/`; la guía de redacción está en `scripts/content/GUIDE.md`.
- `npm run content -- check [id…]` verifica formato, reglas del sitio (sin stock, sin precios, despacho solo "hasta 2 días hábiles", sin "gratis") y que **cada cifra, certificación, grado IP/IK y marca esté en Jumpseller**. Correrlo antes de cada commit de contenido.
- La sincronización diaria revisa el contenido contra los datos nuevos: si Jumpseller cambia un dato que un texto menciona, el informe de la PR del robot lo lista en "Contenido SEO → A corregir" (no bloquea precios).

**Cómo se actualiza**
- Automático: workflow "Sincronizar catálogo Jumpseller" (`.github/workflows/sync-jumpseller.yml`), de lunes a viernes a las 11:00 UTC. Si hay cambios, abre o actualiza la PR `bot/jumpseller-sync` con el informe; se revisa y se fusiona como cualquier PR. Si no hay cambios, no abre nada.
- Para fusionar la PR del bot: cerrarla y reabrirla (`gh pr close N && gh pr reopen N`). El CI que el bot lanza con `workflow_dispatch` pasa, pero GitHub no lo asocia a la PR y `main` exige "Run tsc --noEmit". Al reabrirla con la cuenta del dueño, el CI corre como evento de la PR.
- Desde la PR 05 las URLs sin página dan 404: un producto que sale del catálogo deja de tener `/producto/<id>`. Revisar en el informe de la PR del bot qué productos salen.
- A mano: `gh workflow run sync-jumpseller.yml` (o Actions → Run workflow).
- Local: `npm run sync:catalog` (solo informe, en `reports/jumpseller-sync/diff.md`); `-- --write` escribe los generados. Necesita `.env.local`.
- Guardas (abortan sin escribir): cae más del 15% de productos, ids duplicados, precio ≤ 0, categoría sin mapear, datos que no pasan la validación, campos prohibidos.
- GitHub desactiva los workflows programados tras 60 días sin actividad en el repo. Si pasa: `gh workflow enable sync-jumpseller.yml`.

**Secretos** (los valores los pone el dueño; Claude nunca los ve)
- GitHub Actions: `JUMPSELLER_LOGIN`, `JUMPSELLER_TOKEN` (Settings → Secrets and variables → Actions).
- Local: los mismos dos en `.env.local` (gitignored).

**Reglas**
- El repo es público: nunca deben llegar a archivos versionados `cost_per_item`, el stock ni la descripción **cruda** de Jumpseller (solo la limpia, en su archivo). `--save-raw` solo escribe en `reports/` (gitignored).
- Si una descripción de Jumpseller menciona stock o plazos distintos de "hasta 2 días hábiles", el informe de la sincronización la lista en `descriptionWarnings` para corregirla en Jumpseller.
- Si una etiqueta nueva de la tabla de Jumpseller no tiene regla en `spec-groups.ts`, queda en "Construcción y operación" y el informe la lista (`specLabelsWithoutGroup`): agregarle su regla.
- Agentes: el MCP de Jumpseller es solo de lectura (`get_*`/`list_*`/`search_*`). Para sincronizar se usa `gh workflow run`; el sitio nunca escribe en Jumpseller.
- Fotos: CDN de Jumpseller (`src/lib/jumpsellerImage.ts`). `npm run warm:images` precalienta los tamaños que usa el sitio.

---

## 15. Etapa 2 (SEO y confianza): reglas de despliegue

Plan completo: `~/proyectos/elights-auditoria-2026-09-28/plan-etapa2.md`.

- **vercel.json gobierna también producción.** En el mismo proyecto viven el webhook de Jumpseller, el bot de WhatsApp, el webhook de Pipedrive y los formularios. Reglas (las vigila `scripts/vercel-config.test.ts`):
  - `/api/(.*)` sigue siendo la primera reescritura, sin cambios, y la región sigue en `iad1`.
  - Ninguna redirección ni cabecera alcanza `/api`, y no hay redirecciones por dominio.
  - Sin `cleanUrls` ni `trailingSlash`: convertirían los POST de los webhooks en redirecciones.
  - **404 reales (PR 05):** no hay comodín fuera de `/api`. Una URL sin archivo ni regla recibe `dist/404.html` con estado 404.
  - Las páginas de `NOINDEX_ROUTES` (`/buscar`, `/cotizacion`, `/solicitar-pedido`) se reescriben a `spa.html`. Las de `REDIRECT_ROUTES` (`/carro`) redirigen con 307 al mismo destino que su `<Navigate>` en `src/routes.tsx`.
  - Las fuentes terminan en `{/}?`: Vercel compara en modo estricto y sin eso `/cotizacion/` daría 404.
  - Una ruta fija nueva que no se prerenderiza va en `NOINDEX_ROUTES` o `REDIRECT_ROUTES` (`src/lib/seo/routes.ts`) **y** en vercel.json: los tests exigen que coincidan.
  - Una ruta con parámetros (como `/producto/:id`) solo funciona si se generan sus páginas; si no, da 404. Una que no se pueda prerenderizar (p. ej. un panel de pedidos de la Fase 3) necesita una regla nueva en vercel.json, revisada aparte: hoy el test solo acepta fuentes literales (un segmento fijo, los 301 `/producto/<id literal>{/}?` y las URLs de elights.cl de `legacy-urls.json`), siempre con `{/}?`.
  - **Redirecciones generadas (PR 07):** `npm run redirects:write` (`scripts/redirects/build.ts`) escribe `redirects` en vercel.json y no toca nada más. Nunca editarlas a mano: el test exige que sean iguales a las generadas.
    - Ids de producto renombrados (`src/data/catalog/renamed-ids.ts`): una regla por id anterior, `/producto/<id viejo>{/}?` → `/producto/<id vigente>`, con `statusCode: 301` y sin `permanent` (`permanent: true` daría 308). Vercel conserva la consulta (`?gclid=…`).
    - No dependen de qué productos se publican (si no, la PR del robot fallaría al despublicar uno): un 301 a un producto no publicado da 404, como antes, y `check:prerender` lo informa.
    - Vercel aplica las redirecciones antes que los archivos: por eso un id retirado nunca vuelve a usarse. Máximo propio: 1.000 redirecciones (Vercel acepta 2.048).
    - Dentro de la app (enlaces viejos, Atrás, `vite dev`/`preview`) `ProductRoute` (`src/routes.tsx`) lleva al id vigente; el carrito de pedido y la cotización guardados pasan al id vigente al cargarse.
    - **URLs de elights.cl (PR 08, `scripts/redirects/legacy-urls.json`, ver §14):** una regla por fila con destino, `<url vieja>{/}?` → destino, con `statusCode: 301`, después del bloque de la PR 07, que no cambia (hoy 448; 499 en total). Salen de tablas congeladas o a mano, nunca del catálogo publicado: la PR del robot no las cambia.
    - Guardas de `vercel-config.test.ts`: fuente literal con la gramática estricta; compilada con el `path-to-regexp` de Vercel (6.1.0 y 6.3.0, fijados en devDependencies), sin parámetros; sin duplicados al normalizar mayúsculas, codificación y barra final; ningún primer segmento reservado (`RESERVED_FIRST_SEGMENTS` en `build.ts`: api, producto, catalogo, la app, `public/`, la build, las páginas de la PR 12 en `PLANNED_ROUTES` y las rutas de sistema de Jumpseller); una URL que la app sirve es `served`; destinos prerenderizados o `/buscar`; sin cadenas ni bucles.
    - PR 12: al crear cada página, sacarla de `PLANNED_ROUTES`, pasar `/medios-de-pago` a `served` y dar destino a las filas `pending` de las páginas legales.
    - `check:prerender` bloquea si una fuente tapa un archivo de `dist/` o si falta la página de un destino de categoría o página fija; avisa, sin bloquear, de los 301 a productos no publicados y de los permalinks publicados sin fila.
    - Compuerta de la Etapa 3: ninguna fila `pending`; el sitemap vivo de elights.cl no tiene URLs fuera del archivo; y `npm run smoke -- <url> --legacy` pasa después del cambio de dominio.
- **Chequeo de humo** (`npm run smoke -- <url> [--all] [--compare https://nuevo.elights.cl] [--json reports/smoke/x.json]`, o `npm run smoke -- <url> --legacy`). Solo hace GET y nunca sigue redirecciones; los webhooks responden 405 antes de procesar nada.
  - Se corre en cada preview, comparando con producción, y después de cada merge (con `--all`: todas las páginas del sitemap y sus assets).
  - Juzga cada fila según su tipo:
    - página: 200 con canonical y sin noindex;
    - spa: 200 con noindex;
    - 404: estado 404, noindex y la marca de 404.html;
    - `/carro`: 307 a `/solicitar-pedido`;
    - ids renombrados (2, con y sin barra final y con `?gclid=smoke`): 301 al id vigente, conservando la consulta. Antes del merge, producción todavía responde 200 en esas URLs: con `--compare` no cuenta (solo compara `api/` y archivos);
    - URLs de elights.cl (PR 08, destino tomado de `legacy-urls.json`): una ficha con `?gclid=smoke`, `/campana_led` con y sin barra final, fichas renombradas con `%C3%BA`, coma y puntos, `/home` y `/search?q=panel` (→ `/buscar?q=panel`): 301; `/producto-test-checkout` y `/blog`: 404. Antes del merge, producción responde 404 en las que redirigen;
    - archivo: 200 y no HTML;
    - `api/`: 405.
  - También falla si una función de `api/` o un archivo cambia de estado o de tipo frente a la base comparada.
  - Las vistas previas piden inicio de sesión en Vercel. El chequeo marca ese 302 como falla, en vez de darlo por bueno.
  - Para correrlo en una vista previa, el dueño puede crear el secreto "Protection Bypass for Automation" y dejarlo en `VERCEL_AUTOMATION_BYPASS_SECRET` (`.env.local`). Si no, Claude prueba desde el navegador integrado.
  - `--legacy`: cada fila de `legacy-urls.json` según lo que declara (301 exacto a su destino, la página servida o 404) y cada destino una vez (200), de a una URL cada 500 ms (~7 min). Se corre en nuevo.elights.cl después de cada merge que cambia la tabla: en las vistas previas el navegador integrado ve el destino final, no el código 301.
- **nuevo.elights.cl está fuera de Google** hasta el cambio de dominio: cabecera `X-Robots-Tag: noindex` solo para ese host. Así no compite con elights.cl. Deja de aplicarse sola cuando el sitio se sirva como elights.cl.
- Claude prueba cada preview y publica el resultado en la PR. El dueño aprueba la fusión.

**Páginas estáticas (prerender, PR 04)**
- `npm run build` = `vite build` + `vite build --ssr src/entry-server.tsx --outDir dist-ssr` + sitemap + `scripts/prerender.ts`. Escribe el HTML completo de cada página indexable en `dist/<ruta>/index.html` (título, descripción, canonical, Open Graph, JSON-LD y contenido), más `dist/spa.html` (app vacía, noindex: `/buscar`, `/cotizacion`, `/solicitar-pedido`) y `dist/404.html` (la página "no encontrada", que Vercel sirve con estado 404). Si una página falla al dibujarse, el build falla y Vercel mantiene el despliegue anterior.
- `src/routes.tsx` es la tabla única de rutas (la usan `App.tsx` y `entry-server.tsx`). Una página nueva va ahí y en `src/lib/seo/routes.ts` (lo vigila `scripts/site-routes.test.ts`). Si la página lee datos de forma síncrona en su primer render (como el contenido SEO de la ficha), la ruta los carga en `preload`.
- `src/main.tsx` hidrata (`hydrateRoot`) cuando `#root` trae HTML, después de precargar el trozo de la página y sus datos; si no, dibuja desde cero (`createRoot`).
- `404.html` lleva `data-not-found` en `#root` (`src/lib/notFound.ts`). Con esa marca, el navegador hidrata la página "no encontrada" en esa URL (`staticPage` y `AppRoutes` en `src/routes.tsx`), aunque coincida con una ruta de la app. Si no, en `/producto/<id que ya no existe>` dibujaría la ficha encima del HTML de la 404.
- Reglas para que la hidratación no falle (lo vigila `src/ssr-hydration.test.tsx`): el primer render no puede depender del navegador (sesión, `window`, fecha, parámetros de la URL); eso va en efectos. `<Seo>` dibuja `<Helmet>` recién después de montarse en el navegador: Helmet registra cada etiqueta durante el render y un render que React descarta al hidratar dejaba etiquetas de una página en las siguientes.
- `npm run check:prerender` (también en CI, trabajo "Build + páginas estáticas") revisa el HTML: un título, un h1 visible, canonical igual a la URL, og:image en formato de foto, JSON-LD que se lee y precio igual al catálogo; noindex en spa.html y 404.html; la marca `data-not-found` solo en 404.html (con h1 "404"); sitemap igual a las páginas. Además busca frases de stock o plazos de despacho distintos de "hasta 2 días hábiles" (en la PR del robot solo avisa). Las frases que la regla marca pero son correctas (p. ej. "Entrega en 48 horas" del informe DIALux, confirmado por el dueño), con su motivo, están en `KNOWN_PHRASES`.
- Fotos: si una falla en el CDN antes de que React hidrate, `retryBrokenImages` (`src/lib/brokenImages.ts`) le reenvía el error al terminar de hidratar, para que pase a la foto original.

---

> Actualizar este archivo después de cada corrección significativa o decisión de arquitectura.
