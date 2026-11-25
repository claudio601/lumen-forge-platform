# CLAUDE.md — lumen-forge-platform (nuevo.elights.cl)

> Archivo de memoria del proyecto. Actualizar después de cada corrección relevante.
> Última revisión: 2026-10-11

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

- El sitio **no tiene checkout propio**. Todo flujo termina en una solicitud (pedido o cotización) que llega a Pipedrive + email; el vendedor responde con un **link de pago de Flow** (flow.cl; el pedido queda solo en Flow, no en Jumpseller). Mercado Pago ya no se usa.
- **Nunca mostrar stock** ("En stock" / "Sin stock"): no hay control de bodega y algunos productos se compran en plaza. Texto estándar: **"Consultar disponibilidad"**.
- **Jumpseller es la única fuente de verdad** de precios, nombres, imágenes, categorías y productos activos. El contenido editorial (fichas BESTLED, FAQ, SEO) se mantiene aparte, asociado por `jumpseller_id`.
- **Despacho**: "Despacho en hasta 2 días hábiles" (versión larga: "y a veces el mismo día"). Nunca "24–48 h" ni "muchas veces". En regiones, los 2 días hábiles son hasta entregar el pedido al transportista y el tiempo de viaje se informa en la cotización; no prometer flota propia (sin confirmar, PR 11b).
- **Despacho sin costo y retiro** (dueño, 2026-10-14; constantes en `src/config/business.ts`, PR 12b): sin costo si el TOTAL CON IVA es mayor a $250.000 y la entrega es en la Provincia de Santiago; excluidas San Bernardo, Puente Alto, Colina y el resto de la Provincia de Chacabuco; Talagante, Peñaflor y Padre Hurtado; Melipilla y Alhué; Buin, Paine y Pirque. Regiones: por pagar, vía Starken, Cruz del Sur, ECOEx, Varmontt, Samex, PDQ, Pullman Cargo, Chilexpress, Transportes Mena u otro operador (lista del dueño, 2026-10-25; `REGION_CARRIERS`, también en la Política §5). Retiro en la bodega de Quinta Normal: la dirección exacta se da solo con el pago acreditado y **nunca se publica** (ni en el sitio ni en el repo).
- **Decisiones del dueño del 2026-11-13** (constantes en `src/config/business.ts`): fuera del despacho sin costo, por pagar (con el transportista) o retiro en bodega; el flete va en la cotización solo si lo exigen las bases de una licitación o el proyecto. Paneles de formato grande (`PANEL_MASTER_BOX`, 10 productos): a regiones, por regla general, desde su caja master (el slim 60x60, desde 4 unidades); con menos, retiro o la caja completa; los paneles chicos, en cualquier cantidad. Desde el 2026-11-21 el sitio no publica esa regla, porque a veces se hacen excepciones: la ficha no lleva aviso y /despacho solo dice que viajan más protegidos en su caja completa y que la cotización indica cómo se despachan. La tabla queda para el feed (voluminoso) y el informe del robot. Flow (aclaración del dueño, 2026-11-20): en los pedidos de la web el precio es el mismo por transferencia o con link de Flow (la comisión se absorbe); en las cotizaciones de proyecto se ofrecen dos montos, transferencia y link de Flow, este con la comisión. El sitio no publica el monto con Flow ni el porcentaje: dice que, al precio publicado, se paga lo mismo y que en un proyecto cada monto va en la cotización (Términos 1.13). Empresas e instituciones pueden comprar con orden de compra. Comprobantes de pago a `pagos@elights.cl` con el número de cotización (`paymentsEmail`); ventas@ para todo lo demás. Estudio DIALux: 48 horas desde los antecedentes completos y el pago acreditado, con una revisión (cotización → pago → simulación).
- Ya eliminados en la Etapa 1: `api/create-order.ts`, `src/pages/CartPage.tsx`, `src/services/jumpsellerCart.ts` y el paso a `elights.cl/checkout` (`/carro` redirige a `/solicitar-pedido`).
- **Montos en Pipedrive**: siempre CON IVA, calculados en el servidor desde el catálogo (`api/_lib/catalog/pricing.ts`); nunca se confía en el precio que manda el navegador.
- **Feed de Google Merchant y compra en línea** (decisiones del dueño del 2026-11-19, §18): **en pausa** por decisión del dueño del 2026-11-23. La compra en línea (el botón «Comprar» con Flow y transferencia, D1) y la subida del feed a Merchant no se hacen, porque no hay control de stock en bodega. Idea futura: venta directa por cajas por mayor, con su especificación aparte antes de programar. Mientras tanto rige «Consultar disponibilidad» y el feed no se sube a Merchant. Si se retoma la compra en línea, la comisión de Flow se absorbe (D2, como en todo el precio de la web desde el 19-11) y las fichas del feed dirán «Disponible» (D3) solo desde el día en que exista.

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
| 4 | El extractor del bot pasó a Haiku 5.5 (PR #190, 17-11-2026) y en producción respondió texto sin JSON en saludos, mensajes posteriores al cierre y algún dato real: 18 turnos en un día con «Claude sin datos utilizables … motivo=sin_json». La comparación previa usó solo mensajes con datos | Antes de cambiar el modelo o los parámetros del bot, probar también saludos, «gracias», mensajes posteriores al cierre y varios mensajes seguidos, y revisar los registros de Vercel el mismo día. Arreglo (18-11-2026): salidas estructuradas (`output_config.format` con `EXTRACTION_SCHEMA`, `api/_lib/whatsapp/claudeAgent.ts`); con 52 casos ×3, entre ellos esos, 0 sin_json. Vuelta atrás sin código: `ANTHROPIC_MODEL=claude-haiku-4-5` en Vercel (Production) y un despliegue nuevo |

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
- `src/data/catalog/categories.config.ts`: las 16 categorías del sitio y el mapa desde Jumpseller (`JUMPSELLER_TOP_CATEGORY_TO_SLUG`). Un producto disponible en una categoría raíz de Jumpseller sin mapear hace abortar la sincronización hasta que esa categoría se agrega aquí (arreglo `categories` y mapa, en la misma PR que los generados; p. ej. SENSORES, 10-11-2026).
- `scripts/jumpseller/denylist.json`: productos de Jumpseller que nunca se publican. Tampoco se publican los no disponibles ni los sin categoría.

**Ids del sitio (URLs `/producto/:id`)**
- Orden: `src/data/catalog/renamed-ids.ts` (renombrados a mano) gana sobre `site-ids.generated.ts` (productos nuevos) y `legacy-ids.ts` (catálogo legado, congelado: no editarlo; `scripts/migrate/extract-overrides.ts` lo reescribiría).
- `renamed-ids.ts` (PR 07: los 50 ids que el catálogo legado cortó en la última '/' del permalink, como `w-ip66`): se mantiene a mano y **solo crece**. Nunca borrar una fila (las URLs nuevas darían 404). Cada id anterior redirige con 301 al vigente y **nunca se reutiliza**: la sincronización y `build.ts` lo tratan como ocupado. El robot nunca escribe este archivo ni `vercel.json`.
- Renombrar otro id: agregar su fila (en un segundo renombre, el id actual pasa al final de `previous`), correr `npm run redirects:write` y revisar `git diff vercel.json`. El id nuevo se escribe literal, nunca se recalcula desde el permalink.
- Producto fusionado con otro (decisión del dueño): fila en `MERGED_SITE_IDS` (`renamed-ids.ts`, a mano y solo crece) con `into` (el `jumpseller_id` que lo reemplaza), `id` (el id vigente de ese producto, copiado literal) y `previous` (los ids del retirado). Cada id del retirado va con 301 a la ficha del que lo reemplaza y nunca se reutiliza (entra en `RENAMED_FROM` y `RETIRED_SITE_IDS`); sus filas de `legacy-urls.json` pasan a `product` del que lo reemplaza. Después, `npm run redirects:write` y `npm run product-links:write`, y borrar `content/<id>.json` y sus menciones en `business.ts`. Primer caso: 21766686 (120x15 36W luz cálida) → 2347849, 2026-11-20.
- Ids de productos nuevos (`newSiteId`): el permalink sin %XX, tildes, puntos ni comas (solo `[a-z0-9-]`); si está ocupado, se agrega `-<jumpseller_id>`.
- No limpiar permalinks en Jumpseller para que coincidan con estos ids antes del cambio de dominio: son las URLs vivas de elights.cl (Ads y SEO).
- Si un producto cambia de nombre en Jumpseller, su permalink **no se cambia**, aunque quede desfasado (el 2026-10-08 "PANEL LED CUADRADO EMBUTIDO 3W IP20" pasó a "…IP44" y su permalink sigue en `-ip20`). El permalink es la URL viva de elights.cl (Ads y SEO) y un cambio obliga a agregar su fila en `scripts/redirects/legacy-urls.json`. Claude nunca lo cambia ni lo propone.

**URLs de elights.cl (PR 08): `scripts/redirects/legacy-urls.json`**
- Una fila por URL vieja de elights.cl: el sitemap del 2026-10-05, el borrador de la auditoría, los permalinks anteriores que Jumpseller todavía redirige, `/search` y una página oculta del blog (473 filas); el 23-10-2026 se sumaron 837 URLs antiguas del historial de permalinks del panel de Jumpseller y, con las decisiones del dueño de ese día, las 8 del historial que llevan al blog o a proveedores y el permalink actual de la luminaria de cultivo; el 26-10-2026, las 22 URL finales de Google Ads que daban 404 (lista de la agencia: fichas que ya no se venden, subcategorías viejas y tres `/search/<término>`, todas a su categoría), y las 46 URL viejas que la página 404 de elights.cl redirige con un script del tema y no tenían fila (las fichas y cuatro subcategorías viejas a su categoría, no a la ficha que elige el script; `/servicio-al-cliente`, `/catalogos` y `/mas-elights` a su página); el 30-10-2026, el permalink nuevo de la Vito 400W, que Jumpseller cambió al renombrarla; el 01-11-2026, las 3 subcategorías nuevas de alumbrado solar que trae el sitemap vivo, a `solar`; el 05-11-2026, el permalink del foco codo 40W nuevo; el 06-11-2026, las URL que Search Console muestra con clics en 16 meses y que no tenían fila: 10 fichas que ya no se venden o se borraron (a su categoría) y la categoría raíz `/elights-cl_root` (a `/catalogo`); el 10-11-2026, el permalink del sensor PIR 180° nuevo y la categoría raíz nueva `/sensores`; el 11-11-2026, el permalink de la campana UFO PRO HL 200W nueva (CUFOPROHL200) (1.412 filas en total). Se mantiene **a mano** y **solo crece**: el robot nunca lo escribe y nunca se borra una fila (`legacy-sources.baseline.txt` congela las 473 del 2026-10-05; la prueba exige que sigan y que las que tenían regla la conserven). Ordenada por `source`, una fila por línea.
- Cada fila lleva `source`, exactamente uno de estos campos y, si hace falta, `note`:
  - `product: <jumpseller_id>`: 301 a `/producto/<id vigente>` (el mismo orden de §Ids del sitio; sin cadenas);
  - `category: <slug>`: 301 a `/catalogo/<slug>`. También los productos que ya no se venden (fijos en su categoría, p. ej. el Puzzle LED 12W);
  - `path`: 301 a una página fija de `LEGACY_PAGE_DESTINATIONS` en `build.ts`: `STATIC_ROUTES` (incluye `/`) o `/buscar`, nunca `/cotizacion` ni `/solicitar-pedido`. Ejemplos: `/home` → `/`, `/contact` y `/contactos` → `/cotizador`, `/search` → `/buscar` (conserva `?q=`), `/blog` → `/guias`;
  - `served: true`: el sitio nuevo sirve esa misma URL (`/`, `/catalogo`), sin regla;
  - `gone: "<motivo>"`: 404 definitiva y aprobada (productos de prueba, páginas de relleno de Jumpseller, la entrada oculta del blog sobre la luz fría y las dos URL de la luminaria de cultivo 2557187);
  - `pending: "<motivo>"`: 404 por ahora. Desde el 23-10-2026 no queda ninguna: el dueño dio destino al blog y a proveedores (plan del blog §2.5) y la prueba exige 0 (compuerta de la Etapa 3).
- Ficha que Jumpseller reutilizó para otro producto (su historial lleva a algo distinto): a su categoría, no a ese producto (decisión del dueño, 2026-10-23).
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
- `src/data/catalog/datasheets.generated.ts`: fichas técnicas en PDF de cada producto, los mismos adjuntos que muestra elights.cl (el dueño manda a los clientes el enlace a la ficha del producto para que descarguen la ficha técnica, 2026-11-06). La sincronización (`scripts/jumpseller/datasheets.ts`) consulta `products/<id>/attachments.json` de cada producto publicado, de a uno y con 5 minutos de límite (ni los reintentos lo pasan): primero los productos sin ficha guardada y los demás desde un punto que cambia cada día. Solo publica PDF del CDN de la tienda (`images.jumpseller.com/store/elights-cl/…`) y lo demás lo informa. Un producto que no se pudo consultar conserva sus fichas anteriores; con `--from-dir` no se consulta. La ficha muestra, justo bajo Solicitar pedido / Cotizar y con el mismo peso que Cotizar (`OUTLINE_CTA` en `ProductDetail.tsx`), un botón «Ficha técnica (PDF)» por PDF (con varios, uno por potencia: «Ficha técnica 40W (PDF)»), más un acceso corto en la línea del código, sobre el título (PR 170). Sin PDF, en el mismo lugar va «Pedir ficha técnica» (el correo a ventas) y el bloque «Documentos técnicos» solo aparece en las fichas con PDF. El PDF editorial de los 7 BESTLED gana. Para mostrar la ficha de un producto: adjuntar el PDF al producto en Jumpseller (el informe lista los que no tienen). Solo la importa la ficha de producto.

- `api/_lib/catalog/product-links.generated.ts`: por `jumpseller_id`, el id vigente del sitio (`/producto/<id>`), el nombre de la ficha y la etiqueta de cada variante con su SKU, sin precios. Lo usa solo el aviso de despacho (§17) para la lista «Qué va en tu envío» y el enlace a cada ficha: api/ no puede importar src/. Lo escribe la sincronización con el snapshot nuevo (va en `OUTPUT_PATHS` y en `add-paths` del workflow) y también `npm run product-links:write` (`scripts/jumpseller/product-links.ts`), sin credenciales: correrlo después de editar a mano `renamed-ids.ts` u `overrides.ts` (`scripts/product-links.test.ts` falla si quedó desfasado). Solo productos publicados, como `priceIndex`.

**Contenido SEO por producto (formato BESTLED, decisión del dueño 2026-10-01: "para todos los productos hay que seguir el formato publicado con la bestled")**
- `src/data/catalog/content/<jumpseller_id>.json`: descripción con subtítulos, beneficios clave, casos de uso, instalación y preguntas frecuentes de cada producto (no BESTLED). Un archivo por producto: solo se descarga al abrir esa ficha (`src/data/catalog/content.ts`).
- Se escribe **solo con datos de Jumpseller**: `npm run content -- export` deja los datos de cada producto en `reports/content/facts/`; la guía de redacción está en `scripts/content/GUIDE.md`.
- `npm run content -- check [id…]` verifica formato, reglas del sitio (sin stock, sin precios, despacho solo "hasta 2 días hábiles", sin "gratis") y que **cada cifra, certificación, grado IP/IK y marca esté en Jumpseller**. Correrlo antes de cada commit de contenido.
- La sincronización diaria revisa el contenido contra los datos nuevos: si Jumpseller cambia un dato que un texto menciona, el informe de la PR del robot lo lista en "Contenido SEO → A corregir" (no bloquea precios).
- Las pruebas que dependen de los datos del día (`content.test.ts`: productos publicados y cifras; `descriptions.test.ts`; `og-images.test.ts`) **se saltan solo en el robot**: con `CATALOG_SYNC_JOB=1` (la tarea de sincronización, que corre desde `main`) o en la rama `bot/jumpseller-sync` (en la PR llega en `GITHUB_HEAD_REF`; `GITHUB_REF_NAME` es `N/merge`). La condición vive en un solo lugar, `src/test/syncBot.ts` (`isSyncBot`): toda prueba nueva que dependa de los datos de Jumpseller la importa, nunca la copia. (El 2026-10-08 y el 2026-10-09 una copia vieja de la condición en `content.test.ts` hizo fallar la sincronización y no se abrió PR.)
- **Ninguna prueba escribe un precio de Jumpseller:** lo toma de `products` (`@/data/products`) o de `priceIndex` (`api/_lib/catalog/price-index.generated.ts`). El 08-11-2026 la sincronización falló dos veces por precios escritos (AR111, BESTLED, FlyHawk; PR 153 y 155). Para comprobarlo: regenerar en local (`npm run sync:catalog -- --write`), sumar $10 a cada `"price"` de esos dos generados, correr `npm test` y las pruebas de `api/`, y descartar los cambios (`git restore`).
- En `main` y en las PR de personas esas pruebas **sí corren**. Si el informe del robot trae "Contenido SEO → A corregir", fusionar solo la PR del robot deja `main` en rojo. Por eso Claude:
  1. crea una rama desde `bot/jumpseller-sync` (o, si el robot no abrió PR, regenera localmente con `npm run sync:catalog -- --write` sobre `main` actualizado);
  2. corrige el contenido de cada id de la lista con los datos nuevos (`npm run content -- export <id>`, `scripts/content/GUIDE.md`, `npm run content -- check`), sin editar a mano los generados;
  3. abre **una sola PR a `main`** con los datos nuevos y el contenido corregido, que pasa todas las pruebas sin saltos (typecheck, `npm test`, pruebas de `api/`, build y `check:prerender`), y publica en ella el resultado de la preview;
  4. cuando el dueño la fusiona, cierra la PR del robot sin fusionar (sus datos ya van incluidos).

**Cómo se actualiza**
- Automático: workflow "Sincronizar catálogo Jumpseller" (`.github/workflows/sync-jumpseller.yml`), de lunes a viernes a las 11:00 UTC. Si hay cambios, abre o actualiza la PR `bot/jumpseller-sync` con el informe; se revisa y se fusiona como cualquier PR. Si no hay cambios, no abre nada.
- Si la tarea falla, el resumen de la ejecución dice "La sincronización falló: no se abrió PR" (antes decía "Sin cambios" también al fallar): revisar el paso con error en Actions.
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
- El repo es público: nunca deben llegar a archivos versionados `cost_per_item`, el stock ni la descripción **cruda** de Jumpseller (solo la limpia, en su archivo). `--save-raw` solo escribe en `reports/` (gitignored). Tampoco la lista de precios por mayor (P.MAYOR, lista del dueño del 2026-10-13): es interna; si el sitio la muestra, solo a clientes B2B con sesión (Fase 3), nunca en la ficha pública.
- Si una descripción de Jumpseller menciona stock o plazos distintos de "hasta 2 días hábiles", el informe de la sincronización la lista en `descriptionWarnings` para corregirla en Jumpseller.
- Si una etiqueta nueva de la tabla de Jumpseller no tiene regla en `spec-groups.ts`, queda en "Construcción y operación" y el informe la lista (`specLabelsWithoutGroup`): agregarle su regla.
- Agentes: el MCP de Jumpseller es solo de lectura (`get_*`/`list_*`/`search_*`). Para sincronizar se usa `gh workflow run`; el sitio nunca escribe en Jumpseller.
- Fotos: CDN de Jumpseller (`src/lib/jumpsellerImage.ts`). `npm run warm:images` precalienta los tamaños que usa el sitio.

---

## 15. Etapa 2 (SEO y confianza): reglas de despliegue

Plan completo: `~/proyectos/elights-auditoria-2026-09-28/plan-etapa2.md`.

- **Dominio público (Etapa 3):** `SITE_URL = https://elights.cl` en `api/_lib/site.ts`; `src/config/site.ts` lo reexporta. Canonical, Open Graph, JSON-LD, sitemap, robots, enlaces del cotizador y política del asistente cambian juntos. **Fusionar y desplegar esta PR solo el día en que elights.cl y www pasen de Jumpseller a Vercel, nunca antes.** Reconstruir y verificar `dist/` y el sitio servido.
- **Transición:** los formularios aceptan `elights.cl`, `www.elights.cl` y `nuevo.elights.cl`; la lista predeterminada de analítica (`DEFAULT_HOSTS`, `src/lib/analytics.ts`) solo `elights.cl` y `www.elights.cl`: en `nuevo` no se mide, salvo en el modo de prueba de GTM. La medición requiere consentimiento e ID de GTM válido; revisar overrides `VITE_ANALYTICS_HOSTS` y filtros del contenedor publicado. El consentimiento usa `localStorage`, sin cookie ni dominio fijo: cada origen guarda su propia decisión y debe solicitarla de nuevo al cambiar de host. La atribución ya considera internos los tres hosts; tampoco se traslada su `sessionStorage` entre orígenes.
- **Integraciones:** `nuevo.elights.cl` sigue operativo con `X-Robots-Tag: noindex` solo por host; mantener `vercel.json`. Los callbacks de Twilio, Jumpseller y Pipedrive siguen en `nuevo`; `APP_BASE_URL` conserva la URL exacta usada en la firma de Twilio, independiente de `SITE_URL`. Las fichas del overlay editorial se corrigen por separado en la PR #125.

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
    - Ids de producto renombrados (`src/data/catalog/renamed-ids.ts`): una regla por id anterior, `/producto/<id viejo>{/}?` → `/producto/<id vigente>`, con `statusCode: 301` y sin `permanent` (`permanent: true` daría 308). Vercel conserva la consulta (`?gclid=…`). En el mismo bloque, ordenadas con ellas, van las de los productos fusionados (`MERGED_SITE_IDS`), a la ficha del que los reemplaza.
    - No dependen de qué productos se publican (si no, la PR del robot fallaría al despublicar uno): un 301 a un producto no publicado da 404, y `check:prerender` lo informa. Salvo los de `UNPUBLISHED_RENAMED` (`src/data/catalog/renamed-ids.ts`, a mano), que van a su categoría o a `/catalogo`; `check:prerender` avisa cuándo agregar o quitar uno.
    - Vercel aplica las redirecciones antes que los archivos: por eso un id retirado nunca vuelve a usarse. Máximo propio: 1.500 redirecciones (`MAX_REDIRECTS`; Vercel acepta 2.048).
    - Dentro de la app (enlaces viejos, Atrás, `vite dev`/`preview`) `ProductRoute` (`src/routes.tsx`) lleva al mismo destino que el 301 (el id vigente, o la categoría si está en `UNPUBLISHED_RENAMED`); el carrito de pedido y la cotización guardados pasan al id vigente al cargarse.
    - **URLs de elights.cl (PR 08, `scripts/redirects/legacy-urls.json`, ver §14):** una regla por fila con destino, `<url vieja>{/}?` → destino, con `statusCode: 301`, después del bloque de la PR 07, que no cambia (hoy 1.401; 1.453 en total). Salen de tablas congeladas o a mano, nunca del catálogo publicado: la PR del robot no las cambia.
    - Guardas de `vercel-config.test.ts`: fuente literal con la gramática estricta; compilada con el `path-to-regexp` de Vercel (6.1.0 y 6.3.0, fijados en devDependencies), sin parámetros; sin duplicados al normalizar mayúsculas, codificación y barra final; ningún primer segmento reservado (`RESERVED_FIRST_SEGMENTS` en `build.ts`: api, producto, catalogo, la app (también las páginas legales de la PR 12), `public/`, la build y las rutas de sistema de Jumpseller); una URL que la app sirve es `served`; destinos prerenderizados o `/buscar`; sin cadenas ni bucles.
    - `check:prerender` bloquea si una fuente tapa un archivo de `dist/` o si falta la página de un destino de categoría o página fija; avisa, sin bloquear, de los 301 a productos no publicados y de los permalinks publicados sin fila.
    - Compuerta de la Etapa 3: ninguna fila `pending`; el sitemap vivo de elights.cl no tiene URLs fuera del archivo; y `npm run smoke -- <url> --legacy` pasa después del cambio de dominio.
- **Chequeo de humo** (`npm run smoke -- <url> [--all] [--compare https://nuevo.elights.cl] [--expected-origin <origen>] [--json reports/smoke/x.json]`, o `npm run smoke -- <url> --legacy [--expected-origin <origen>]`). Solo hace GET y nunca sigue redirecciones; los webhooks responden 405 antes de procesar nada.
  - Se corre en cada preview, comparando con producción, y después de cada merge (con `--all`: todas las páginas del sitemap y sus assets).
  - Juzga cada fila según su tipo:
    - página: 200 con canonical y `og:url` iguales al origen público esperado más su ruta, sin noindex en el HTML. El origen por defecto es `SITE_URL`; `--expected-origin https://elights.cl` permite comprobar previews y el día del cambio sin aceptar el host de preview como canonical;
    - spa: 200 con noindex;
    - 404: estado 404, noindex y la marca de 404.html;
    - `/carro`, `/carro/` y `/carro?origen=prueba`: 307 a `/solicitar-pedido`, conservando la consulta. En toda redirección, `Location` debe permanecer en el origen consultado (también si es absoluto), con ruta y consulta exactas y sin fragmento;
    - rutas de sistema de Jumpseller: `/cart`, `/checkout`, `/customer`, `/orders`, `/admin`, `/attachments` y `/quote`: 404 real. Es la respuesta de hoy: si el dueño decide otro destino, se cambia la fila a propósito;
    - página actual con barra final (`/catalogo/`): 200 con canonical y `og:url` de `/catalogo`; con mayúscula (`/Catalogo`): 404 real;
    - ids renombrados (2, con y sin barra final y con `?gclid=smoke`): 301 al id vigente, conservando la consulta. Antes del merge, producción todavía responde 200 en esas URLs: con `--compare` no cuenta (solo compara `api/` y archivos);
    - URLs de elights.cl (PR 08, destino tomado de `legacy-urls.json`): una ficha con `?gclid=smoke`, `/campana_led` con y sin barra final, fichas renombradas con `%C3%BA`, coma y puntos, `/home` y `/search?q=panel` (→ `/buscar?q=panel`): 301; `/producto-test-checkout` y `/blog`: 404. Antes del merge, producción responde 404 en las que redirigen;
    - archivo: 200 y no HTML. `sitemap.xml`: tipo XML, `urlset` válido y todas las URLs indexables del repo, sin faltantes, extras ni duplicados, en el origen público esperado; `--all` valida el contenido antes de extraer rutas. `robots.txt`: texto con `User-agent: *`, `Allow: /`, `Disallow: /api/` y un solo `Sitemap: <origen esperado>/sitemap.xml`;
    - `api/`: 405.
  - Cabecera HTTP: `X-Robots-Tag: noindex` obligatoria en `nuevo.elights.cl` fuera de `/api` y `/api/…`; prohibida en páginas indexables de `elights.cl` y `www.elights.cl`. Las previews conservan la política anterior: no se exige ni se prohíbe esa cabecera.
  - Día del cambio: `npm run smoke -- https://elights.cl --all --expected-origin https://elights.cl` y, por separado, `npm run smoke -- https://elights.cl --legacy --expected-origin https://elights.cl`; comprobar también `nuevo` con el mismo origen SEO esperado.
  - También falla si una función de `api/` o un archivo cambia de estado o de tipo frente a la base comparada.
  - Las vistas previas piden inicio de sesión en Vercel. El chequeo marca ese 302 como falla, en vez de darlo por bueno.
  - Para correrlo en una vista previa, el dueño puede crear el secreto "Protection Bypass for Automation" y dejarlo en `VERCEL_AUTOMATION_BYPASS_SECRET` (`.env.local`). Si no, Claude prueba desde el navegador integrado.
  - `--legacy`: cada fila de `legacy-urls.json` según lo que declara (301 exacto a su destino, la página servida o 404) y cada destino una vez (200), de a una URL cada 500 ms (~14 min). Se corre en nuevo.elights.cl después de cada merge que cambia la tabla: en las vistas previas el navegador integrado ve el destino final, no el código 301.
- **nuevo.elights.cl está fuera de Google** hasta el cambio de dominio: cabecera `X-Robots-Tag: noindex` solo para ese host. Así no compite con elights.cl. Deja de aplicarse sola cuando el sitio se sirva como elights.cl.
- Claude prueba cada preview y publica el resultado en la PR. El dueño aprueba la fusión.

**Páginas estáticas (prerender, PR 04)**
- `npm run build` = `vite build` + `vite build --ssr src/entry-server.tsx --outDir dist-ssr` + sitemap + `scripts/prerender.ts`. Escribe el HTML completo de cada página indexable en `dist/<ruta>/index.html` (título, descripción, canonical, Open Graph, JSON-LD y contenido), más `dist/spa.html` (app vacía, noindex: `/buscar`, `/cotizacion`, `/solicitar-pedido`) y `dist/404.html` (la página "no encontrada", que Vercel sirve con estado 404). Si una página falla al dibujarse, el build falla y Vercel mantiene el despliegue anterior.
- `src/routes.tsx` es la tabla única de rutas (la usan `App.tsx` y `entry-server.tsx`). Una página nueva va ahí y en `src/lib/seo/routes.ts` (lo vigila `scripts/site-routes.test.ts`). Si la página lee datos de forma síncrona en su primer render (como el contenido SEO de la ficha), la ruta los carga en `preload`.
- `src/main.tsx` hidrata (`hydrateRoot`) cuando `#root` trae HTML, después de precargar el trozo de la página y sus datos; si no, dibuja desde cero (`createRoot`).
- `404.html` lleva `data-not-found` en `#root` (`src/lib/notFound.ts`). Con esa marca, el navegador hidrata la página "no encontrada" en esa URL (`staticPage` y `AppRoutes` en `src/routes.tsx`), aunque coincida con una ruta de la app. Si no, en `/producto/<id que ya no existe>` dibujaría la ficha encima del HTML de la 404. La página (`src/pages/NotFound.tsx`, auditoría UX B-10) trae el buscador precargado con las palabras de la URL que sí encuentran productos (`notFoundSearch`, cargado aparte con `import()`; se ponen al montar, porque el HTML es uno solo; ese texto sin cambios no se mide como `search` en `/buscar`), las 6 categorías principales del pie (`mainCategories`) y «¿Buscabas un producto que ya no está?» con el correo a ventas; sin WhatsApp en la página y con el h1 «404».
- Reglas para que la hidratación no falle (lo vigila `src/ssr-hydration.test.tsx`): el primer render no puede depender del navegador (sesión, `window`, fecha, parámetros de la URL); eso va en efectos. `<Seo>` dibuja `<Helmet>` recién después de montarse en el navegador: Helmet registra cada etiqueta durante el render y un render que React descarta al hidratar dejaba etiquetas de una página en las siguientes.
- `npm run check:prerender` (también en CI, trabajo "Build + páginas estáticas") revisa el HTML: un título, un h1 visible, canonical igual a la URL, og:image en formato de foto, JSON-LD que se lee y precio igual al catálogo (un `Offer` o, si las variantes no cuestan lo mismo, un `AggregateOffer` con su rango, auditoría UX I-03; nunca `availability`); noindex en spa.html y 404.html; la marca `data-not-found` solo en 404.html (con h1 "404"); sitemap igual a las páginas. Además busca frases de stock o plazos de despacho distintos de "hasta 2 días hábiles" (en la PR del robot solo avisa). Las frases que la regla marca pero son correctas (p. ej. "Entrega en 48 horas" del informe DIALux, confirmado por el dueño), con su motivo, están en `KNOWN_PHRASES`.
- Fotos: si una falla en el CDN antes de que React hidrate, `retryBrokenImages` (`src/lib/brokenImages.ts`) le reenvía el error al terminar de hidratar, para que pase a la foto original.

---

## 16. Guías (/guias)

Plan completo: `~/proyectos/elights-blog-2026-10/plan-blog.md` (uso interno, no va al repo).

- **Contenido**: `src/data/guides/index.ts` (ficha liviana de cada guía publicada: H1, metaTitle sin la marca, fechas ISO fijas, autor, `index`) y `src/data/guides/content/<slug>.ts` (cuerpo, un trozo de JS por guía). En el repo solo hay guías **aprobadas por el dueño**: el borrador vive en `~/proyectos/elights-blog-2026-10/borradores/` (el repo es público). Para despublicar, se sacan la ficha y el archivo de `content/`.
- **Texto aprobado = texto publicado**: al pasar una guía al sitio solo cambia el formato. Los enlaces son destinos tipados (categoría, guía, ruta, fichas por `jumpseller_id`, correo, ancla, fuente oficial). Una oración que lleva a una guía aún no publicada va en `{ ifGuide }` y se muestra sola cuando esa guía se publique.
- **Publicada sin indexar** (`index: false`): se prerenderiza y se ve en `/guias`, pero lleva noindex (sin canonical) y queda fuera del sitemap (`noindexGuideRoutes()` en `src/lib/seo/routes.ts`; lo vigila check-prerender). Las guías de la norma (G1, G3, G4) salen así hasta el OK del dueño, guía por guía.
- **D.S. N°1/2022**: el bloque «Luminarias con certificado» sale de `DS1_CERTIFIED_LINES` y de las variantes de Jumpseller (`src/data/guides/ds1-lines.ts`); sus oraciones, y toda oración que junte el certificado con la norma, las aprueba el dueño (listas en `src/data/guides/guides.test.ts`; su OK se anota en `DS1_BLOCK_OWNER_OK`, y con «pendiente» no se fusiona). 2200K = «ámbar», 2700K = «cálida»; estadios, solo hasta 5000K, y la ficha de un estadio que también vende una versión de más de 5000K se nombra sin enlace (`noLink`).
- **Fechas**: «Publicada el» es el día de la fusión a main y no cambia nunca. Si la fusión es otro día que el anotado, ese día se cambian `datePublished`, `dateModified`, `publishedLabel` y la primera línea del historial, y se vuelven a revisar las fuentes.
- **Medición**: `guia_cta_click` (link_type `guia_texto` o `guia_recuadro`) al hacer clic hacia `/cotizador` o `/estudio-luminico`. Para que llegue a GA4, la agencia debe sumarlo al activador T09 del contenedor. Mientras su especificación no lo tenga, `npm run check:gtm-export` lo anota como nota (`PENDING_SITE_EVENTS`) y no bloquea; cuando lo sume, se saca de esa lista.
- **Pruebas**: `src/data/guides/guides.test.ts` (formato, reglas del sitio, D.S. N°1, enlaces y la página), `src/config/contentTruth.test.ts` (frases retiradas, `src/test/retired.ts`), `src/ssr-hydration.test.tsx`, check-prerender y el chequeo de humo (fila `unindexed`).


---

## 17. Aviso de despacho

Paso a paso del dueño: `docs/operacion/aviso-despacho.md`. Spec: `~/proyectos/elights-auditoria-2026-09-28/aviso-despacho-2026-11-06/spec-nivel2.md`.

- **Disparador:** el campo «Despacho · Aviso» del negocio («Vista previa» o «Enviar al cliente»). El webhook de Pipedrive (`api/pipedrive/webhook.ts`) responde 200 apenas valida Basic Auth y procesa en `waitUntil` (`maxDuration` 60 en vercel.json): solo si en ese evento el disparador cambió a una opción, antes del filtro de embudo. `api/_lib/shipping/notice.ts` relee el negocio (la fuente de verdad), arma el correo con la plantilla y los archivos del negocio, lo envía por el relay y deja la nota; al terminar vacía el disparador (si sigue con la opción procesada). Mover la etapa a mano no envía nada.
- **Quién envía:** solo el dueño, al elegir «Enviar al cliente». Claude nunca lo elige en un negocio real; en pruebas, solo en «PRUEBA Claude - borrar», con su OK. La vista previa va solo a `OWNER_EMAIL` del relay.
- **Contra el envío doble**, por la clave SHA-256 de `{negocio}:{operador}:{orden}`: (1) Redis, `aviso-despacho:v1:<clave>` con `sending` (10 min), `sent:<iso>` o `uncertain` (400 días); (2) el campo «Despacho · Aviso enviado» (`formatSentLog`); (3) la deduplicación del relay (PropertiesService). Además, un candado por negocio de 90 s (se suelta al terminar). Redis caído: no se envía al cliente (la vista previa sí). `uncertain` nunca se reintenta solo.
- **Reentregas de Pipedrive (auditoría Codex, 19-11-2026):** bajo el candado y antes de cualquier nota o envío, se reserva la identidad del evento, `aviso-despacho:v1:evento:<sha256 de negocio|opción|update_time>` (SET NX, 2 días). El `update_time` es el del negocio en el cuerpo (v2 `data.update_time`, v1 `current.update_time`). Si ya existe, es una reentrega: solo queda el registro `resultado=reentrega`, aunque los campos hayan cambiado. Una elección nueva del dueño trae otro `update_time`. No lleva `meta.id`: la guía de v2 no dice que se mantenga entre reintentos. Tampoco se descarta por `attempt > 1`. Sin `update_time` no se envía al cliente (nota y disparador vacío); la vista previa sí.
- **Plazo:** 60 s de función menos 10 de margen (`NOTICE_MAX_DURATION_S`, con su prueba contra vercel.json). El relay (hasta 30 s) empieza solo si quedan 40 s, revisado otra vez después de guardar `sending`; si ya no alcanzan, se retira esa reserva (compare-and-delete con el valor propio de la ejecución). Con menos de medio segundo no empieza una escritura en Pipedrive. El ATENCIÓN y la tarea reciben lo que queda de la función menos 2 s (`notifySales(…, { timeoutMs })`).
- **Registro después de enviar:** si no quedan la nota, el PUT, la consulta de etapas (`/stages` falla) o la relectura que vacía el disparador, sale el correo ATENCIÓN a ventas@, con `reply_to` ventas@ (`salesInbox()`, nunca el correo del cliente), y una tarea al dueño (`PIPEDRIVE_OWNER_USER_ID`). Un embudo sin «Despachado» o un disparador que el dueño ya cambió son casos normales.
- **Archivos (dueño, 19-11-2026):** la foto del comprobante del operador es obligatoria (puede ir con la factura en la misma foto); el PDF de la factura o la guía es opcional, porque la factura se envía antes del despacho, y se adjunta solo si lleva el número en el nombre (un PDF sin el número puede ser del cliente de /cotizador). Si `listDealFiles` no trae la lista completa (más de 500), el aviso se detiene con nota: no elige sobre una lista cortada.
- **Campos opcionales:** Orden de flete, entrega, agencia o comuna, flete y kilos son opcionales (dueño, 24-11-2026): sin ellos, el correo omite esas líneas. «Por pagar» también va sin monto (dueño, 25-11-2026: el comprobante de PDQ no lo trae): el correo dice que el flete va por pagar, sin cifra, y la nota, «Por pagar, sin monto». Sin orden, el aviso se identifica por el documento: la clave es la de `{negocio}:{operador}:-factura8459` (o `-guia123`; el «-» nunca va en una orden normalizada) y «Aviso enviado» dice «· sin orden · factura 8459». Dos despachos parciales de la misma factura, sin orden y con el mismo operador, no se pueden avisar por separado: el segundo se escribe desde Gmail. Si después se completa la orden, es otra clave (otro envío). Nada se descarta sin avisar: «Agencia o comuna» sin «Entrega» y «Flete por pagar» con monto sin «Flete» detienen el aviso.
- **«Enviar al cliente» exige `SITE_URL = https://elights.cl`** (enlaces a las fichas); si no, solo la vista previa.
- **Secretos (los pone el dueño; Claude nunca los ve):** `SHIPPING_RELAY_SECRET` en Vercel (Production) y `SHARED_SECRET` en las propiedades del script, el mismo valor. `SHIPPING_RELAY_URL` (la URL /exec) no es secreta pero no va en el repo.
- **El relay:** `apps-script/aviso-despacho/Code.gs` y su `README.md` (implementación, propiedades, `testDoPost`). Implementado el 19-11-2026 en la cuenta de Workspace del dueño (proyecto «eLIGHTS · aviso de despacho», versión 1, acceso «Cualquier persona»); `SHIPPING_RELAY_URL` está en Vercel (Production). Para comprobarlo sin enviar nada: un GET a la URL `/exec` devuelve `{"servicio":"aviso-despacho","version":1}` y un POST sin firma, `rejected firma` (con `config`, falta el secreto en el script). Al cambiar `Code.gs`, nueva versión de la misma implementación (README §8), así la URL no cambia. Para revisar el correo a ojo sin Pipedrive: `npm run aviso:render -- --fixture` (escribe en `reports/aviso-despacho/`).
- **Pruebas:** `api/_tests/shipping-notice*.test.ts` con Upstash, Pipedrive y relay simulados (`fakeUpstash.ts`, `fakePipedrive.ts`, `shippingFixture.ts`); nunca el relay ni el Pipedrive reales. Los registros llevan solo el negocio, la acción, 8 caracteres de la clave y códigos.

---

## 18. Feed de Merchant

Especificación: `~/proyectos/elights-merchant-2026-11/spec-feed-merchant.md` (uso interno, no va al repo).

- **Qué es:** `dist/feeds/google-merchant.xml` (`SITE_URL/feeds/google-merchant.xml`), RSS 2.0 con el espacio `g:`, un ítem por variante de Jumpseller (las de un producto comparten `item_group_id`). Lo escribe `scripts/merchant-feed.ts` en cada `npm run build`, entre `generate-sitemap` y `prerender` (`npm run merchant-feed` lo arma solo). Si falla, falla el build. No es un archivo del repo ni lo escribe la sincronización: se actualiza con cada merge, también el de la PR del robot.
- **No se sube a Merchant** hasta que exista la compra en línea (D1, §3): Google no acepta sitios donde solo se cotiza. Mientras tanto nadie lo descarga.
- **Sale de los mismos datos que la ficha:**
  - el precio CON IVA de la variante (`<entero> CLP`, igual al de `priceIndex`);
  - el nombre de Jumpseller en tipo oración, más « – » y la etiqueta de la variante;
  - las fotos, codificadas como en el JSON-LD;
  - las especificaciones en `product_detail`: los tres grupos de la ficha más «Variante», sin garantía, marca ni ninguna fila que nombre el D.S. N°1 (`DS1_MENTION`: en la ficha la fila es del producto completo, y en el feed cada ítem es una sola variante). En una variante, sus filas «Variante» reemplazan a las del producto con la misma etiqueta y a su temperatura de color (`CCT_LABEL`);
  - los beneficios en `product_highlight` (de 2 a 10).
- **La descripción** es la editorial o la del contenido SEO, en texto plano. Se quitan la voz de la tienda, lo comercial (`COMMERCIAL_TEXT`: eLIGHTS, cotización, despacho, precios, pago, Flow, stock, WhatsApp, DIALux, «con nosotros»…) y las frases retiradas (`src/test/retired.ts`).
- **Títulos repetidos:** si dos ítems quedan con el mismo título (dos variantes con la misma etiqueta o dos productos con el mismo nombre en Jumpseller), se agrega su SKU y, si sigue repetido o no lo tiene, el id del ítem (`distinctTitles`). Así la unicidad no depende de los nombres de Jumpseller.
- **Ids:** `<jumpseller_id>-<id de la variante>`, o `<jumpseller_id>` si el producto no tiene variante. Nunca cambian: un renombre en `renamed-ids.ts` cambia solo el `link`.
- **link:** `SITE_URL/producto/<id vigente>`. En los productos con selector se agrega `?variante=<id>`, y la ficha deja elegida esa variante en un efecto después de hidratar (`selectionForVariant`, `src/lib/variants.ts`). Ni el HTML estático ni el canonical cambian, y un id ajeno se ignora.
- **Atributos:**
  - `availability: in_stock` (D3) y `condition: new`;
  - `brand`, si Jumpseller la trae;
  - `google_product_category`, desde `src/data/merchant/google-categories.ts`: un ID revisado por categoría del sitio; en focos a riel y postes se decide por el nombre, y las correcciones por `jumpseller_id` van en `PRODUCT_GOOGLE_CATEGORY`;
  - `product_type`;
  - `color`, solo Blanco o Negro;
  - `shipping_label: voluminoso`, en los postes y en `PANEL_MASTER_BOX`;
  - `custom_label_0..3`: categoría, tramo de precio, destacado y voluminoso. Nunca margen, costo ni P.MAYOR.
  - Sin GTIN (D6). D7 (dueño, 19-11-2026): «JIE» es la marca propia y el fabricante, como «eLIGHTS» (`OWN_BRANDS`). En ellas el SKU de la variante, o del producto sin selector, va como `mpn`, y sin SKU va `identifier_exists: no`. Las marcas de otros fabricantes (CHUHAN, WAROM…) no llevan ninguno de los dos.
- **Qué entra:** los productos publicados menos los de `src/data/merchant/exclusions.ts`. Esa lista se lleva a mano (D5), con el `jumpseller_id` y un motivo genérico (el repo es público). Los servicios nunca entran.
- **Guardas:**
  - El build se detiene si un precio no es el de `priceIndex`, si un link no lleva a la ficha vigente o si el XML no pasa `inspectFeed`.
  - El build avisa, sin bloquear, de las primeras fotos de menos de 500 px, de las que no tienen medidas, de los productos sin marca, de los ítems de marca propia sin SKU, de un SKU repetido como `mpn` y de los títulos sin minúsculas. Se corrigen en Jumpseller.
  - `scripts/merchant-feed.test.ts` bloquea las fotos de menos de 500 px desde el 01-01-2027 (Google las rechaza desde el 31-01-2027), salvo en el robot (`isSyncBot`).
  - `check:prerender` compara cada precio con el JSON-LD de su ficha prerenderizada.
  - El humo revisa el archivo servido. Es una fila nueva: con `--compare`, el 404 de producción antes del primer merge no cuenta como regresión.
- **vercel.json:** `X-Robots-Tag: noindex` en `/feeds/google-merchant.xml` para todos los dominios, después de la regla de `nuevo`. `feeds` está en `RESERVED_FIRST_SEGMENTS`. robots.txt y el sitemap no cambian.
- **Si Merchant rechaza un producto:** corregir el dato en Jumpseller (foto, nombre o marca) o, si no se puede, agregarlo a `exclusions.ts` con su motivo. Una categoría mal asignada se corrige en `PRODUCT_GOOGLE_CATEGORY`. Un rechazo por la página (precio o disponibilidad distintos) se revisa en la ficha, no en el feed.
- **Pendientes del dueño:**
  - los montos de la tarifa de despacho (D4: una nacional fija y otra mayor para «voluminoso», nunca «gratis»);
  - la lista de exclusión (D5);
  - el tránsito máximo (D8; la preparación es de 0 a 2 días hábiles).
- **Antes de subirlo** (Shopping estándar, D9): revisar que el firewall de Vercel no pida desafío en `/feeds/`.

---

> Actualizar este archivo después de cada corrección significativa o decisión de arquitectura.
