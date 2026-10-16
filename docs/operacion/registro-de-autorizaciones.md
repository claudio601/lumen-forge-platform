# Registro de autorizaciones: novedades, bajas y oposiciones

Procedimiento de ventas desde la PR 13 (versión 1.2 de los textos legales). Lo que dice este documento tiene que coincidir con la Política de privacidad (§7 plazos, §8 derechos y §10 cookies) y con los Términos (§15 cambios). Si la política cambia, este documento cambia en la misma PR. La redacción legal la revisa el abogado (pregunta Q6 del plan).

## 1. Qué queda registrado y dónde

Cada envío de los 5 formularios del sitio (`/solicitar-pedido`, `/cotizacion`, `/cotizador`, `/instalacion` y `/estudio-luminico`) deja el mismo bloque en **la nota del negocio en Pipedrive** y en **el correo a ventas@elights.cl**. No hay campo nuevo en Pipedrive.

```
--- PRIVACIDAD Y AUTORIZACIONES ---
Privacidad: leída; autoriza usar sus datos para responder esta solicitud (casilla obligatoria)
Términos y condiciones: aceptados (casilla obligatoria)
Novedades y ofertas por correo: NO
Versión de los textos legales: 1.2
Registrado: 2026-11-20 11:03:12, hora de Chile (reloj del servidor)
consent_json: {"v":"1.2","at":"2026-11-20T14:03:12Z","form":"solicitar-pedido","privacy":true,"terms":true,"marketing":false,"src":"web"}
```

Variantes:

- **Sin términos** (todos los formularios menos `/solicitar-pedido`): falta la línea de términos y el JSON lleva `"terms":null`.
- **Con novedades**: `Novedades y ofertas por correo: SÍ (casilla opcional; puede retirarlo cuando quiera)` y `"marketing":true`.
- **Versión distinta**: si el navegador tenía otra versión de los textos, la línea dice `1.2 (vigente en el servidor: 1.3)` y el JSON trae `"v"` y `"sv"`.
- **Formulario anterior a la versión 1.2** (pestaña abierta antes del deploy, solo durante los 7 días siguientes a la fecha de la versión 1.2; las versiones siguientes no vuelven a abrir ese margen): `Privacidad: SIN CASILLA (…)`, `"src":"web-legacy"` y `"marketing":false`. En `/instalacion` nombra además la casilla que tenía el formulario anterior.

La hora sale del reloj del servidor, nunca del navegador. La línea legible está en hora de Chile; el instante exacto va en `at`, en UTC.

Dónde queda primero:

- `/cotizacion`, `/cotizador`, `/instalacion` y `/estudio-luminico`: el correo sale **antes** de Pipedrive. Si Pipedrive falla, la constancia queda en Gmail.
- `/solicitar-pedido`: primero se crea el negocio y después, sin bloquear al cliente, la nota y el correo. Si fallan las dos cosas, el negocio queda sin constancia y en los registros de Vercel aparece `Nota con la constancia no creada | ref: RC-… | dealId: …` (sin datos personales). En ese caso, anota en el negocio que falta la constancia y **no** sumes a esa persona a novedades.

## 2. Cómo leer la decisión vigente

- Vale **la última línea que empieza con `consent_json:`** de la nota o del correo. No te guíes por la línea legible: un cliente puede escribir un texto parecido en sus comentarios, pero lo que escribe el cliente queda siempre **antes** del bloque.
- Campos del JSON: `v` (versión que vio el cliente; `null` si es un formulario anterior), `sv` (versión del servidor, solo si es distinta), `at` (instante UTC), `form`, `privacy`, `terms`, `marketing`, `src` (`web` o `web-legacy`).
- Si una persona tiene varias solicitudes, manda la más reciente (`at` mayor). Una solicitud posterior **sin** la casilla de novedades cuenta como retiro (Política §7).
- Para saber qué texto aceptó, abre el archivo de su versión: `https://nuevo.elights.cl/legal/politica-de-privacidad-v1.1.html` (lo mismo para `terminos-y-condiciones` y `cambios-devoluciones-y-garantia`). Desde la Etapa 3, en elights.cl.

## 3. Novedades y ofertas por correo

- Solo por correo y solo a quien tenga `"marketing":true` vigente. Nada promocional por WhatsApp.
- **No se envía ninguna campaña** hasta tener una herramienta con enlace de baja, asunto y remitente identificables (Ley 19.496, art. 28 B) y hasta revisar el registro No Molestar del SERNAC. Un campo o una etiqueta en Pipedrive sería otra PR (`api/_lib/pipedrive` está protegido).
- **Registro de novedades** (hoja de Google de ventas, pestaña «Altas»): correo, referencia de la solicitud (`RC-`, `NE-`, `PY-`, `INST-` o `ESTL-`) y la línea `consent_json` copiada tal cual. Antes de borrar o anonimizar solicitudes (24 meses sin compra), copia ahí a quienes tengan `"marketing":true` vigente: el consentimiento sigue mientras no lo retiren.
- **Bajas** (pestaña «Bajas»): correo, fecha y cómo la pidió (respuesta a un correo, mensaje con el asunto «Datos personales» o una solicitud posterior sin la casilla). Se guardan **4 años** desde la baja (Ley 21.719, art. 40), solo el correo y la constancia, para respetar la baja y poder demostrar el consentimiento que hubo. Antes de cada envío, cruza la lista con las bajas.

## 4. Oposición al origen de la visita

El origen de la visita (página de entrada, sitio anterior y parámetros de campaña) va en el bloque `--- ORIGEN DE LA VISITA ---` de cada nota y correo.

- **Desde el sitio**: el interruptor «Origen de la visita» de «Configurar cookies», al pie de cada página. Lo borra de ese navegador y no lo vuelve a anotar ahí. Ventas no hace nada.
- **Por correo** (asunto «Datos personales»): el bloque está en dos lugares, y hay que sacarlo de los dos.
  1. **Pipedrive**: busca los negocios de esa persona, edita cada nota en la interfaz y borra el bloque `--- ORIGEN DE LA VISITA ---` completo. En los pedidos, no borres la línea final `requested_items_json`.
  2. **Gmail** (ventas@elights.cl): busca los correos de esas solicitudes por su referencia (`RC-`, `NE-`, `PY-`, `INST-` o `ESTL-`), incluidos los de «ATENCIÓN» cuando Pipedrive falló. Gmail no deja editar un correo recibido:
     - si la nota del negocio tiene el bloque `--- PRIVACIDAD Y AUTORIZACIONES ---`, elimina el correo (Gmail lo borra del todo a los 30 días de la papelera);
     - si la nota no lo tiene (el correo es la única constancia), deja el correo, ponle la etiqueta «Origen: oposición» y no lo uses para analizar canales: queda solo como registro de la solicitud.
  3. Responde confirmando qué borraste y, si quedó un correo como constancia, que solo se guarda como registro de la solicitud.

## 5. Plazos para responder (Política §8)

| Fecha de la solicitud | Plazo |
| --- | --- |
| Hasta el 30-11-2026 | 2 días hábiles |
| Desde el 1-12-2026 | 30 días corridos, prorrogables una vez por otros 30 (avisando al cliente). Bloqueo: 2 días hábiles |

Aplica a la oposición y a los demás derechos (acceso, rectificación, supresión, portabilidad, bloqueo y retiro del consentimiento). Si piden la supresión y tenían novedades, anota la baja (punto 3) antes de borrar.

## 6. Plazos de conservación (Política §7)

- Solicitudes que no terminan en compra: 24 meses desde el último contacto. La constancia sigue a su solicitud.
- Novedades: mientras no se retiren. Si se borra la solicitud, la constancia pasa al registro de novedades.
- Bajas de novedades: 4 años, solo el correo y la constancia.

## 7. Lo que no se registra en el servidor

- **Las decisiones de cookies** (aviso y «Configurar cookies») no se guardan en nuestros sistemas, por minimización: quedan en el navegador del visitante. Si acepta Google Analytics, cada medición lleva a Google las señales de Consent Mode con lo que permitió (Política §10). La prueba es el código versionado, sus pruebas automáticas y esas señales.
- **El asistente de WhatsApp** agrega un aviso breve de privacidad (responsable, uso, asistente con IA, registro en el sistema de seguimiento, enlace a la política y canal «Datos personales») al final de su primera respuesta a cada número (PR 13w, `api/_lib/whatsapp/privacyNotice.ts`).
  - **El perfil de WhatsApp Business mantiene el texto y el enlace a la política.** Es lo único que la persona ve antes de su primer mensaje, y el asistente procesa ese mensaje antes de enviar el aviso: lo manda a Anthropic, queda en los registros técnicos y, si trae correo y contexto, crea la persona, el negocio y la nota en Pipedrive. No lo quites del perfil.
  - El aviso puede repetirse: tras un reinicio o un deploy, si atiende otra instancia o cuando el registro llega a 5.000 números. Si la respuesta tarda más de 10 segundos (Twilio espera 15 y después no envía nada), la lleva igual, pero el número no se marca y la siguiente respuesta lo vuelve a llevar. Si Twilio o WhatsApp no entregan una respuesta enviada a tiempo, ese número no lo recibe de nuevo hasta un reinicio.
  - No deja constancia en Pipedrive. La prueba es el código versionado y sus pruebas automáticas, igual que con las cookies. El registro de mensajes de Twilio sirve como evidencia adicional solo mientras Twilio lo guarde: el plazo real lo confirma el dueño en la consola de Twilio. Si es largo, se corrige en la versión 1.3 de la política lo que el §7 dice de los «plazos breves».

## 8. Antes de cotizar: versión de los Términos (Términos §15)

Los Términos §15 prometen: «Tu compra se rige por la versión vigente cuando pagaste; si cambió desde tu solicitud, la cotización te lo indica». Las cotizaciones se arman a mano, así que este paso lo hace ventas:

- **Antes de mandar la cotización**, compara la línea `Versión de los textos legales` del bloque (o `"v"` en `consent_json`) con la versión vigente, que aparece bajo el título de `/terminos-y-condiciones` («Versión X.Y. Vigente desde el …») y en `LEGAL_VERSION` (`api/_lib/forms/consent.ts`).
- **Si es distinta**, o si la constancia es `web-legacy` (`"v":null`), agrega en la cotización: «Los Términos y condiciones cambiaron desde tu solicitud. Tu compra se rige por la versión X.Y, vigente desde el <fecha>: <dominio>/legal/terminos-y-condiciones-vX.Y.html» (el dominio es el del punto 2).
- **Solicitudes por correo o WhatsApp** (sin bloque): compara la fecha de la solicitud con la fecha «Vigente desde» de los Términos. Si la solicitud es anterior, agrega el mismo aviso.
- **Si sale una versión nueva entre la cotización y el pago**, manda el mismo aviso antes de enviar o renovar el link de pago.
