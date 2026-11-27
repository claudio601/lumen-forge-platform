# Registro de autorizaciones: novedades, bajas y oposiciones

Procedimiento de ventas desde la PR 13 (versión 1.2 de los textos legales; 1.3, PR 13x, que corrige lo que la política dice del asistente de WhatsApp y pide por correo el retracto, la garantía y los reclamos; 1.4, PR 13z, que agrega la revisión de las conversaciones con el asistente para mejorarlo; desde entonces la versión vigente es la de `LEGAL_VERSION`, 1.15 desde la PR del paso de Mailchimp a EmailOctopus). Lo que dice este documento tiene que coincidir con la Política de privacidad (§4 asistente de WhatsApp, §7 plazos, §8 derechos y §10 cookies) y con los Términos (§15 cambios). Si la política cambia, este documento cambia en la misma PR. La redacción legal la revisa el abogado (pregunta Q6 del plan), salvo la base de las novedades a la base heredada de Mailchimp, que decidió el dueño sin abogado el 27-11-2026 (punto 3).

## 1. Qué queda registrado y dónde

Cada envío de los 5 formularios del sitio (`/solicitar-pedido`, `/cotizacion`, `/cotizador`, `/instalacion` y `/estudio-luminico`) deja el mismo bloque en **la nota del negocio en Pipedrive** y en **el correo a ventas@elights.cl**. No hay campo nuevo en Pipedrive.

```
--- PRIVACIDAD Y AUTORIZACIONES ---
Privacidad: leída; autoriza usar sus datos para responder esta solicitud (casilla obligatoria)
Términos y condiciones: aceptados (casilla obligatoria)
Novedades y ofertas por correo: NO
Versión de los textos legales: 1.4
Registrado: 2026-11-20 11:03:12, hora de Chile (reloj del servidor)
consent_json: {"v":"1.4","at":"2026-11-20T14:03:12Z","form":"solicitar-pedido","privacy":true,"terms":true,"marketing":false,"src":"web"}
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
- Si una persona tiene varias solicitudes, manda la más reciente (`at` mayor). Una solicitud posterior **sin** la casilla de novedades cuenta como baja (Política §7).
- Para saber qué texto aceptó, abre el archivo de su versión (`v`): `https://elights.cl/legal/politica-de-privacidad-v1.15.html` (lo mismo para `terminos-y-condiciones` y `cambios-devoluciones-y-garantia`).

## 3. Novedades y ofertas por correo

Desde la 1.15 (Política §2, §3, §5 y §7; D3 del dueño, 26-11-2026) las novedades se envían con **EmailOctopus**, lista «Novedades de eLIGHTS.cl». Las altas del sitio llevan doble confirmación. Nada promocional por WhatsApp.

- **Base** (decisión del dueño del 27-11-2026, Q6, sin abogado):
  - altas del sitio: la casilla opcional de novedades (consentimiento), más la confirmación del correo de EmailOctopus;
  - base heredada: la Ley del consumidor. Texto de la Política §3: «si ya las recibías porque nos pediste una cotización o información, o compraste; puedes darte de baja en cada correo (Ley 19.496, art. 28 B)». Casi toda la base heredada entró desde Pipedrive (cotizaciones y consultas) o desde Jivochat; casi nadie por un formulario.
- **De quién son los contactos de Mailchimp** (decisión del dueño del 27-11-2026): de eLIGHTS.CL SpA. El pie de otra sociedad que llevaban esos públicos era histórico, y la política no menciona otra sociedad.
- **Quién las recibe:**
  - quien tenga `"marketing":true` en su última `consent_json`: entra como pendiente y recibe el correo de confirmación de EmailOctopus;
  - la base heredada: quien estaba suscrito en Mailchimp en los públicos Pipedrive, «Suscriptores eLIGHTS.cl» o Jivochat. El público de instaladores y los contactos archivados no se importan.
- **Reconfirmación (solo en el cambio de plataforma, paso 22 del plan):** de la base heredada, quien no abrió ni hizo clic en ninguna campaña de Mailchimp en los 12 meses anteriores al cambio (campañas enviadas desde el 27-11-2025) entra con la etiqueta `reconfirmar` y recibe primero un pedido de reconfirmación; no recibe campañas mientras no confirme. **A los 14 días de cada tanda, quien no confirmó pasa a baja** («Unsubscribed»). La fecha de esa baja se anota en el calendario al programar la tanda. No es una ronda periódica: después del cambio, nadie recibe un pedido de reconfirmación por inactividad.
- **Historial de Mailchimp:** las aperturas y los clics del export de Mailchimp ordenan las tandas (primero los más activos) y definen quién reconfirma (Política §2 y §3).
- **No las reciben** (supresión, se carga antes que la base y queda como baja), salvo que después marquen la casilla y confirmen el correo de EmailOctopus:
  - toda baja o rebote de cualquiera de los 4 públicos de Mailchimp, también del de instaladores y de los archivados;
  - las filas de la pestaña «Bajas» de la hoja de ventas;
  - quien tenga `"marketing":false` en su última `consent_json`;
  - quien esté en el registro No Molestar del SERNAC (etiqueta `supr-no-molestar`).

  Un rebote que vuelve a marcar la casilla lo revisa una persona antes de sumarlo.
- **Requisitos antes de cada tanda** (Política §3, «sin avisarte antes», y §12; Términos de EmailOctopus §7.4):
  - la Política 1.15 está publicada en elights.cl;
  - el correo del doble opt-in de las altas del sitio enlaza la Política 1.15 y nombra la medición de aperturas y clics;
  - la primera campaña a cada tanda de la base heredada lleva un aviso breve del cambio (nueva plataforma y medición de aperturas y clics), con el enlace de baja y el enlace a la Política 1.15;
  - el registro No Molestar del SERNAC está revisado y cargado (`supr-no-molestar`), y las bajas y rebotes nuevos de Mailchimp, también.
- **Cada campaña** lleva enlace de baja, asunto y remitente identificables (Ley 19.496, art. 28 B).
- **Medición de aperturas y clics:** EmailOctopus la trae encendida por omisión y deja apagar por separado el seguimiento de aperturas («Open tracking») y el de clics («Click tracking») al crear cada campaña o correo automático. Fuente: https://help.emailoctopus.com/article/187-campaign-tracking (actualizado el 04-04-2026, revisado el 27-11-2026). La Política §3 dice que «esa medición se puede desactivar en cada envío»; no hay un proceso para apagarla por persona.
- **Registro de altas y bajas:** EmailOctopus (estado del contacto, etiquetas `origen-*` y `supr-*`, campos «Fecha de alta» y «Base del permiso»). Reemplaza a las pestañas «Altas» y «Bajas» de la hoja de ventas; lo que ya tenían se carga en EmailOctopus.
  - **«Base del permiso»**, según el origen (la constancia de cómo entró, Política §7):
    - altas del sitio: `Casilla web · <formulario> · v<versión> · <referencia RC-/NE-/PY-/INST-/ESTL-> · <fecha de la constancia>`, más el registro del doble opt-in que guarda EmailOctopus (estado y fecha de la confirmación). Así la constancia sigue aunque la solicitud se borre a los 24 meses;
    - base heredada: `Mailchimp · <público o públicos> · <origen en Mailchimp (SOURCE): Pipedrive CRM, Jivochat, formulario…>`.
  - **«Fecha de alta»:** la de la constancia en las altas del sitio; en la base heredada, la más antigua de sus públicos de Mailchimp. En los contactos sincronizados desde Pipedrive o Jivochat esa fecha es la de la sincronización y no prueba un permiso.
  - Bajas desde el enlace de un correo: EmailOctopus las registra solo.
  - Bajas pedidas por correo (respuesta a una campaña o asunto «Datos personales»): marca el contacto como baja en EmailOctopus antes de 2 días.
  - Altas y bajas del sitio: desde el paso 16 del plan y hasta que la casilla quede conectada con EmailOctopus (PR 3 del plan), Claude hace una ronda cada 2 días como máximo, con un recordatorio programado desde ese paso:
    - bajas (`"marketing":false`), como baja: con OK permanente del dueño, porque no mandan ningún correo;
    - altas (`"marketing":true`), como pendiente: con OK del dueño en cada ronda, porque disparan el correo de confirmación.
- **Plazos:** el registro de novedades no se borra con la solicitud (24 meses sin compra): sigue en EmailOctopus mientras la persona no se dé de baja. Una baja queda en EmailOctopus marcada como baja mientras usemos esa lista, para respetarla y no volver a escribirle. No se borra: borrada, podría volver a entrar con una importación o un alta, y los Términos de EmailOctopus (§7.5) no permiten borrar contactos para volver a agregarlos. La supresión de Mailchimp se carga solo con el correo y su etiqueta.
- Un campo o una etiqueta de novedades en Pipedrive sería otra PR (`api/_lib/pipedrive` está protegido).

## 4. Oposición al origen de la visita

El origen de la visita (página de entrada, sitio anterior y parámetros de campaña) va en el bloque `--- ORIGEN DE LA VISITA ---` de cada nota y correo.

- **Desde el sitio**: el interruptor «Origen de la visita» de «Configurar cookies», al pie de cada página. Lo borra de ese navegador y no lo vuelve a anotar ahí. Ventas no hace nada.
- **Por correo** (asunto «Datos personales»): el bloque está en dos lugares, y hay que sacarlo de los dos.
  1. **Pipedrive**: busca los negocios de esa persona, edita cada nota en la interfaz y borra el bloque `--- ORIGEN DE LA VISITA ---` completo. En los pedidos, no borres la línea final `requested_items_json`.
  2. **Gmail** (ventas@elights.cl): busca los correos de esas solicitudes por su referencia (`RC-`, `NE-`, `PY-`, `INST-` o `ESTL-`), incluidos los de «ATENCIÓN» cuando Pipedrive falló. Gmail no deja editar un correo recibido:
     - si la nota del negocio tiene el bloque `--- PRIVACIDAD Y AUTORIZACIONES ---`, elimina el correo (Gmail lo borra del todo a los 30 días de la papelera);
     - si la nota no lo tiene (el correo es la única constancia), deja el correo, ponle la etiqueta «Origen: oposición» y no lo uses para analizar canales: queda solo como registro de la solicitud.
  3. Responde confirmando qué borraste y, si quedó un correo como constancia, que solo se guarda como registro de la solicitud.

### 4.1 Oposición a la revisión del asistente de WhatsApp (desde la 1.4)

Llega por correo (asunto «Datos personales»), con el teléfono desde el que la persona le escribió al bot.

1. Pásale el teléfono a Claude en una sesión de la carpeta `~/proyectos/elights-bot-2026-10/marcha-blanca/`. Claude calcula la huella del teléfono y busca su código en las copias seudonimizadas de los ciclos vigentes (hasta 60 días), sin leer las conversaciones.
2. Si aparece, se borran sus conversaciones de la copia y de los informes que aún no se cierran, y su número se agrega a `EXCLUIR_NUMEROS` en `marcha-blanca/.env`, para que no entre en los ciclos siguientes.
3. Anota en `marcha-blanca/registro.md` la fecha y «oposición atendida» (sin el teléfono).
4. Responde confirmando que sus conversaciones ya no se revisan. Lo que quedó en Pipedrive sigue el plazo de las solicitudes (§6); si también pide borrar eso, es una solicitud de supresión.

## 5. Plazos para responder (Política §8)

| Fecha de la solicitud | Plazo |
| --- | --- |
| Hasta el 14-10-2027 | 2 días hábiles |
| Desde el 15-10-2027 | 30 días corridos, prorrogables una vez por otros 30 (avisando al cliente). Bloqueo: 2 días hábiles |

Aplica a la oposición y a los demás derechos (acceso, rectificación, supresión, portabilidad, bloqueo y retiro del consentimiento). Si piden la supresión y tenían novedades, marca la baja en EmailOctopus (punto 3) antes de borrar.

## 6. Plazos de conservación (Política §7)

- Solicitudes que no terminan en compra: 24 meses desde el último contacto. La constancia sigue a su solicitud.
- Novedades: en EmailOctopus, mientras no se den de baja; no se borran con la solicitud.
- Bajas de novedades: en EmailOctopus, marcadas como baja, mientras usemos esa lista (punto 3).
- Twilio (asistente de WhatsApp): 400 días en su consola y su API, más su respaldo (Backup Storage), que queda encendido por decisión del dueño (2026-10-18) para revisar y mejorar el asistente. La política §7 lo informa.
- Revisión del asistente (desde la 1.4): la exportación de Twilio no se guarda; la tabla de claves, cifrada, 14 días; la copia seudonimizada y la huella del teléfono, 60 días; las cifras, sin plazo. Los borrados los ejecuta el dueño con el comando que deja Claude en `marcha-blanca/registro.md`, y cada uno tiene su recordatorio en el calendario.

## 7. Lo que no se registra en el servidor

- **Las decisiones de cookies** (aviso y «Configurar cookies») no se guardan en nuestros sistemas, por minimización: quedan en el navegador del visitante. Si acepta Google Analytics, cada medición lleva a Google las señales de Consent Mode con lo que permitió (Política §10). La prueba es el código versionado, sus pruebas automáticas y esas señales.
- **Qué texto de cookies vio una persona:** la decisión guarda `v` y `at`; el texto vigente en esa fecha es el del historial de git de `src/lib/cookieTexts.ts` (la versión 2 rige desde la PR 14, 22-10-2026).
- **El asistente de WhatsApp** agrega un aviso breve de privacidad (responsable, uso, asistente con IA, registro en el sistema de seguimiento, enlace a la política y canal «Datos personales») al final de su primera respuesta a cada número (PR 13w, `api/_lib/whatsapp/privacyNotice.ts`).
  - **El perfil de WhatsApp Business mantiene el texto y el enlace a la política.** Es lo único que la persona ve antes de su primer mensaje, y el asistente procesa ese mensaje antes de enviar el aviso: lo manda a Anthropic, queda en los registros técnicos y, si trae correo y contexto, crea la persona, el negocio y la nota en Pipedrive. No lo quites del perfil.
  - El aviso puede repetirse cuando vence la conversación en Upstash (7 días sin mensajes), si Upstash falla (la marca queda solo en la memoria de esa instancia y otra no la ve) o cuando el registro llega a 5.000 números. Si la respuesta tarda más de 10 segundos (Twilio espera 15 y después no envía nada), la lleva igual, pero el número no se marca y la siguiente respuesta lo vuelve a llevar. Si Twilio o WhatsApp no entregan una respuesta enviada a tiempo, ese número no lo recibe de nuevo hasta que vence la conversación (7 días sin mensajes).
  - No deja constancia en Pipedrive. La prueba es el código versionado y sus pruebas automáticas, igual que con las cookies. El registro de mensajes de Twilio sirve como evidencia adicional solo mientras Twilio lo guarde (400 días, §6). Desde la versión 1.3, la política ya no les aplica los «plazos breves» a Twilio ni a Anthropic: dice que conservan los registros de los mensajes según las condiciones de servicio que aceptamos al contratarlos (§7), porque son encargados (§5). Twilio: 400 días, confirmado (§6). Pendientes: el respaldo de Twilio y Anthropic (repaso 2026-11, G05). Los «plazos breves» quedan solo para los registros técnicos del sitio y del asistente.
- **Lo que la política 1.3 dice del asistente** (§2, §4 y §7):
  - **Lo que hace hoy el código.** En ese WhatsApp siempre responde el asistente, con mensajes predefinidos que pueden repetir datos que reconoció la IA. La IA (Claude) solo reconoce los datos y escribe el resumen. El número, el nombre del perfil de WhatsApp y los adjuntos llegan solos. **Sin correo no se crea el negocio en Pipedrive**, así que esa conversación no llega a ventas. En Pipedrive la prioridad es «Alta» si pidió una persona y «Normal» si no. Si piden una persona, el asistente **no siempre** pide el correo: si el mensaje dice «necesito», «busco», «cotizar» o «comprar», sigue con las preguntas de cotización; si nombran a Claudio o a Constanza, les da sus correos. Tampoco reconoce retractos, garantías ni reclamos: por eso, desde la 1.3, Cambios y los Términos §16 los piden por correo.
  - **Regla del dueño.** La respuesta de una persona va siempre por correo, nunca por WhatsApp ni por teléfono. La política lo dice así, y la PR 13y (#85) ajustó a esa regla los mensajes `MSG_HUMAN` («Te va a atender Claudio Quero directamente por correo») y `MSG4_INSTALL`. Excepción: en las solicitudes de instalación, el equipo responde por correo o por teléfono (dueño, 2026-10-24; Términos §1 desde la 1.14).
  - **Diferencias con el bot, resueltas en la PR 1 del bot (#88):** «quedó registrada» y «ya derivé» salen solo si Pipedrive confirma el negocio; sin correo, el bot pide el correo (texto A) y, si Pipedrive falla, ofrece ventas@elights.cl (texto B). Si alguien dice que el asistente le confirmó su solicitud y no tiene negocio en Pipedrive, búscalo en el registro de mensajes de Twilio y respóndele por correo si lo dio.
  - Si el asistente cambia (por ejemplo, con la especificación nueva del bot), la política cambia en la misma PR y sube la versión.

## 8. Antes de cotizar: versión de los Términos (Términos §15)

Los Términos §15 prometen: «Tu compra se rige por la versión vigente cuando pagaste; si cambió desde tu solicitud, la cotización te lo indica». Las cotizaciones se arman a mano, así que este paso lo hace ventas:

- **Antes de mandar la cotización**, compara la línea `Versión de los textos legales` del bloque (o `"v"` en `consent_json`) con la versión vigente, que aparece bajo el título de `/terminos-y-condiciones` («Versión X.Y. Vigente desde el …») y en `LEGAL_VERSION` (`api/_lib/forms/consent.ts`).
- **Si es distinta**, o si la constancia es `web-legacy` (`"v":null`), agrega en la cotización: «Los Términos y condiciones cambiaron desde tu solicitud. Tu compra se rige por la versión X.Y, vigente desde el <fecha>: <dominio>/legal/terminos-y-condiciones-vX.Y.html» (el dominio es el del punto 2).
- **Versión 1.3** (PR 13x): además de la Política de privacidad, cambiaron los Términos §1 («Te respondemos por correo electrónico») y §16 (los problemas con la compra, por correo, sin WhatsApp). Una solicitud con `"v":"1.2"` lleva el aviso, como con cualquier versión distinta.
- **Solicitudes por correo o WhatsApp** (sin bloque): compara la fecha de la solicitud con la fecha «Vigente desde» de los Términos. Si la solicitud es anterior, agrega el mismo aviso.
- **Si sale una versión nueva entre la cotización y el pago**, manda el mismo aviso antes de enviar o renovar el link de pago.
