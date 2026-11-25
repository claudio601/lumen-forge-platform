# Aviso de despacho: paso a paso

Cuando el pedido ya está con el operador, el sitio le manda al cliente un correo con el seguimiento y la foto del comprobante del operador (y la factura o la guía de despacho en PDF, si la subes). Lo eliges tú en el negocio de Pipedrive, con el campo **«Despacho · Aviso»**, o se lo pides a Claude en el chat (desde el 25-11-2026): le mandas la foto del comprobante y la subes a Archivos del negocio; Claude llena los campos, revisa la vista previa y lo envía al cliente. Si algo no calza, te pregunta antes de enviar. El sitio nunca envía un aviso por su cuenta.

El resultado siempre queda como **nota en el negocio**. Si el campo «Despacho · Aviso» vuelve a quedar vacío, el aviso ya se procesó: lee la nota.

---

## 1. Antes de elegir el aviso

**Archivos del negocio** (pestaña Archivos, subidos ahí y no como adjunto de un correo):

- **La foto del comprobante del operador** (obligatoria), en JPG o PNG. Puede ir junto a la factura en la misma foto. Si hay más de una foto, ponle «comprobante» o «voucher» en el nombre. Hasta 5 MB. HEIC no sirve.
- **El PDF de la factura o de la guía de despacho** (opcional: la factura se le envía al cliente antes del despacho). Si lo quieres adjuntar, ponle el número en el nombre (por ejemplo `factura-8430.pdf`): un PDF sin el número no se adjunta, porque podría ser un archivo del cliente. Hasta 3 MB.

Sin el PDF, el correo dice «Te adjuntamos el comprobante de <operador>» y, si no lleva la lista de productos, «el detalle de los productos va en la factura N° …».

Solo cuentan los archivos agregados en los últimos 7 días y, si el negocio ya tuvo un aviso, los agregados después de ese aviso.

**Campos** (los «Despacho · …» del negocio):

Orden de flete, entrega, agencia o comuna, flete y kilos son opcionales (dueño, 24-11-2026): sin ellos, el correo omite esas líneas. El monto del flete por pagar también (25-11-2026): con «Por pagar» y sin monto, el correo dice que el flete va por pagar, sin cifra. Sin orden, el aviso se identifica por el documento (tipo y número).

Nada se descarta sin avisar: si «Agencia o comuna» tiene texto y «Entrega» está vacía, o si «Flete por pagar» tiene monto y «Flete» está vacío, el aviso se detiene y la nota dice qué elegir o qué borrar.

| Campo | Qué va |
|---|---|
| Despacho · Operador | el de la lista. Si el operador no está, agrégalo como opción: el aviso sale sin botón de seguimiento. |
| Despacho · Orden de flete | opcional: la del comprobante, como venga (con puntos o guiones). Sin ella, el correo no lleva seguimiento ni nombra la orden. |
| Despacho · Entrega | opcional: «Retiro en agencia» o «A domicilio». Sin ella, el correo no dice cómo se entrega y cierra con «Al recibirlo». |
| Despacho · Agencia o comuna | opcional: la agencia (retiro) o la comuna (domicilio). Va con «Entrega»: con texto y sin «Entrega», el aviso se detiene (elige «Retiro en agencia» o «A domicilio», o borra el lugar). |
| Despacho · Flete | opcional: «Por pagar» o «Pagado por eLIGHTS.cl». Sin él, el correo no habla del flete. |
| Despacho · Flete por pagar | opcional, solo con «Por pagar»: el monto del comprobante, en pesos, sin puntos. Si el comprobante no lo trae (PDQ), déjalo vacío: el correo dice «Por pagar: lo pagas a … al recibirlo» (o «al retirarlo», si es retiro en agencia), sin cifra. No toca el valor del negocio. Con monto y sin «Flete», el aviso se detiene (elige «Por pagar» o borra el monto). |
| Despacho · Bultos | los del comprobante. |
| Despacho · Kilos | opcional: los del comprobante. Sin ellos, el correo dice solo los bultos. |
| Despacho · Fecha de envío | si va vacía, es hoy. No puede ser una fecha futura. |
| Despacho · Entrega estimada | opcional. Si va vacía, el correo no promete fecha. |
| Despacho · Documento | «Factura» o «Guía de despacho». Vacío = factura. |
| Despacho · N° de documento | solo dígitos. |
| Despacho · Productos | opcional: una línea por producto, `<cantidad> <SKU>`, y si quieres ` — <texto como en la factura>` (ver abajo). |

El correo va al **correo principal de la persona del negocio** (o al primero de su lista, si ninguno es principal). Si está mal, corrígelo en la persona.

**Productos.** Con «Despacho · Productos», el correo lista esos productos con el enlace a su ficha. Un SKU que no está en el catálogo necesita el texto después de « — » (sale sin enlace); sin texto, el aviso no sale. Si lo dejas vacío:

- en un pedido de /solicitar-pedido (RC-…), la vista previa usa los productos de la solicitud, y «Enviar al cliente» también, si la vista previa fue en las últimas 24 horas;
- en los demás casos, el correo dice «el detalle de los productos va en la factura N° …» (con «adjunta» si subiste el PDF).

## 2. Vista previa y envío

1. Elige **«Vista previa»** en «Despacho · Aviso» y guarda. En menos de un minuto te llega a tu correo el aviso tal como lo vería el cliente, con «[Vista previa]» en el asunto, y en el negocio queda la nota «Vista previa enviada…». El campo vuelve a quedar vacío.
2. Revisa el correo. Si algo está mal, corrige el campo o el archivo y pide otra vista previa (hasta 5 por hora por negocio).
3. Elige **«Enviar al cliente»**. Sale el correo al cliente. En el negocio quedan:
   - la nota «Aviso de despacho enviado (…)», con todos los datos y los adjuntos;
   - «Despacho · Aviso enviado» con la fecha, la hora, el operador y la orden (sin orden: «· sin orden · factura 8459» o «guía de despacho 123»);
   - la etapa «Despachado» (si el embudo la tiene; si no, solo la nota);
   - el campo «Despacho · Aviso» vacío.

El valor del negocio nunca cambia. Mover el negocio a mano a «Despachado» no envía nada.

**Un segundo envío del mismo negocio** (otra parte del pedido): otra orden de flete, la foto del comprobante nuevo (y el PDF de la factura, si lo quieres adjuntar) agregada después del primer aviso, y otra vez «Vista previa» y «Enviar al cliente». Si el negocio está archivado, desarchívalo primero.

**Sin orden de flete, el aviso se identifica por el documento** (tipo y número). Dos despachos del mismo negocio y operador sin orden, con facturas o guías distintas, son dos avisos: cada uno con su foto nueva del comprobante. Dos despachos parciales de la misma factura, sin orden y con el mismo operador, no se pueden avisar por separado: el segundo se escribe desde Gmail.

**Si el aviso salió sin orden de flete y después la completas**, «Enviar al cliente» lo cuenta como otro envío: sin una foto nueva del comprobante, la nota dice que falta; con una foto nueva, sale un segundo correo al cliente, ahora con la orden.

## 3. Qué significa cada nota

| La nota dice | Qué pasó | Qué hacer |
|---|---|---|
| Vista previa enviada a tu correo | salió la vista previa, solo a ti | revisarla y elegir «Enviar al cliente» |
| Aviso de despacho enviado | el cliente ya lo tiene | nada |
| No salió un correo nuevo … Aviso de despacho ya había salido: registrado el … | el relay ya tenía un aviso con la misma clave (por ejemplo, después de un «no sé si salió» que sí había salido) y no mandó otro correo. El sitio lo registra igual («Aviso enviado» y la etapa) para que no se reintente | si era el mismo despacho, nada. Sin orden, la clave es la del documento: si era otro despacho de esa factura o guía con el mismo operador, el cliente no recibió nada de este, y se lo escribes desde Gmail |
| NO enviado … Falta o hay que corregir: (lista) | faltaba un dato, el correo, la foto del comprobante, o un archivo no sirve | corregir lo de la lista y volver a elegir |
| NO enviado … Reintenta en unos minutos | Pipedrive, Redis o el plazo de la función fallaron un momento (en la vista previa, también el relay: «reenvío del mismo cuerpo firmado» o «caché del relay no disponible») | volver a elegir en unos minutos |
| NO enviado: ya se envió el … | esa orden de flete (o, sin orden, ese documento con ese operador) ya tuvo su aviso | nada; para corregir algo, o para otro despacho del mismo documento sin orden, escríbele desde Gmail |
| NO enviado: hay un envío en curso o sin confirmar | otro aviso de la misma orden estaba saliendo | revisar Enviados en 10 minutos; si no está, volver a elegir «Enviar al cliente» |
| no sé si salió | el relay no confirmó a tiempo | revisar Enviados (el asunto sin «[Vista previa]»); si no está, volver a elegir «Enviar al cliente». Si había salido, no se repite. |
| NO enviado: se acabó la cuota diaria de correos | Gmail no envía más hoy | reintentar mañana (también llega un correo ATENCIÓN a ventas@) |
| NO enviado: el relay rechazó el pedido / falta configuración | el relay o Vercel están mal configurados | avisarle a Claude (también llega un correo ATENCIÓN) |
| Vista previa NO enviada: ya van 5 vistas previas | límite de 5 por hora | esperar un rato |
| el envío al cliente queda disponible después del cambio de dominio | el sitio todavía no es elights.cl | por ahora, solo vista previa |
| NO enviado: el aviso de Pipedrive llegó sin la hora del cambio | Pipedrive cambió el formato de sus avisos | avisarle a Claude; mientras tanto, solo vista previa |
| NO enviado … El archivo «…» quedó guardado en Google Drive | Pipedrive tiene Google Drive conectado (Herramientas y aplicaciones → Documentos) y guardó ahí el archivo: el sitio no lo puede descargar | desconectar Drive en Pipedrive y volver a subir el archivo al negocio, o avisarle a Claude |
| NO enviado … El negocio tiene demasiados archivos para revisarlos todos | más de 500 archivos: el sitio no puede saber si hay otro PDF o comprobante | avisarle a Claude |

**Correo ATENCIÓN «el aviso salió, pero no quedó en Pipedrive»** (a ventas@, más una tarea para ti en el negocio): el cliente sí recibió el aviso, pero Pipedrive no guardó algo: la nota, «Despacho · Aviso enviado», la etapa «Despachado» o el campo «Despacho · Aviso» vacío. El correo dice qué falta hacer a mano y, si falta, qué va en «Despacho · Aviso enviado». No vuelvas a elegir «Enviar al cliente» para esa orden. Si dice «el aviso ya había salido (no salió un correo nuevo)», es el caso de la fila «No salió un correo nuevo» de arriba: lo mismo, más Gmail si era otro despacho.

## 4. Si el campo no se vació

Si a los 2 minutos «Despacho · Aviso» sigue con valor y no hay nota nueva, el aviso no se procesó (otro aviso del mismo negocio estaba en curso o el webhook no llegó):

1. vacía el campo y guarda;
2. vuelve a elegir la opción y guarda.

Elegir de nuevo el valor que ya tiene no hace nada: Pipedrive no avisa si el campo no cambió. Reintentar nunca envía dos veces la misma orden de flete (ni, sin orden, el mismo documento con el mismo operador): el sitio, el campo «Aviso enviado» y el relay lo impiden. Si Pipedrive repite por su cuenta un aviso que ya llegó (sus reintentos), el sitio lo reconoce y no hace nada: solo cuenta lo que eliges tú.

Si editas otros campos con «Despacho · Aviso» todavía puesto, no se envía nada: el aviso sale solo en el momento en que eliges la opción.

## 5. Configuración (una sola vez)

- El relay de Apps Script y sus dos variables de Vercel (`SHIPPING_RELAY_URL`, `SHIPPING_RELAY_SECRET`): `apps-script/aviso-despacho/README.md`. El secreto lo pones tú.
- `PIPEDRIVE_OWNER_USER_ID` en Vercel: tu usuario de Pipedrive, para la tarea del caso ATENCIÓN. Sin ella, solo llega el correo ATENCIÓN.
- Google Drive desconectado en Pipedrive (Herramientas y aplicaciones → Documentos): con Drive conectado, los archivos que subes a un negocio quedan en Drive y el aviso no los puede adjuntar (prueba del 19-11-2026).
- Los 15 campos «Despacho · …» y la etapa «Despachado» se buscan por nombre: si cambias un nombre, el aviso no sale y la nota dice cuál falta.
