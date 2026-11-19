# Aviso de despacho: paso a paso

Cuando el pedido ya está con el operador, el sitio le manda al cliente un correo con el seguimiento, la factura (o la guía de despacho) y el comprobante. Lo eliges tú en el negocio de Pipedrive, con el campo **«Despacho · Aviso»**. Nadie más envía avisos a clientes: ni el sitio por su cuenta ni Claude.

El resultado siempre queda como **nota en el negocio**. Si el campo «Despacho · Aviso» vuelve a quedar vacío, el aviso ya se procesó: lee la nota.

---

## 1. Antes de elegir el aviso

**Archivos del negocio** (pestaña Archivos, subidos ahí y no como adjunto de un correo):

- **El PDF de la factura o de la guía de despacho.** Ponle el número en el nombre (por ejemplo `factura-8430.pdf`), sobre todo si hay más PDF en el negocio. Hasta 3 MB.
- **La foto del comprobante del operador** (opcional), en JPG o PNG. Si hay más de una foto, ponle «comprobante» o «voucher» en el nombre. Hasta 5 MB. HEIC no sirve.

Solo cuentan los archivos agregados en los últimos 7 días y, si el negocio ya tuvo un aviso, los agregados después de ese aviso.

**Campos** (los «Despacho · …» del negocio):

| Campo | Qué va |
|---|---|
| Despacho · Operador | el de la lista. Si el operador no está, agrégalo como opción: el aviso sale sin botón de seguimiento. |
| Despacho · Orden de flete | la del comprobante, como venga (con puntos o guiones). |
| Despacho · Entrega | «Retiro en agencia» o «A domicilio». |
| Despacho · Agencia o comuna | la agencia (retiro) o la comuna (domicilio). |
| Despacho · Flete | «Por pagar» o «Pagado por eLIGHTS.cl». |
| Despacho · Flete por pagar | solo con «Por pagar»: el monto del comprobante, en pesos, sin puntos. No toca el valor del negocio. |
| Despacho · Bultos y Despacho · Kilos | los del comprobante. |
| Despacho · Fecha de envío | si va vacía, es hoy. No puede ser una fecha futura. |
| Despacho · Entrega estimada | opcional. Si va vacía, el correo no promete fecha. |
| Despacho · Documento | «Factura» o «Guía de despacho». Vacío = factura. |
| Despacho · N° de documento | solo dígitos. |
| Despacho · Productos | opcional: una línea por producto, `<cantidad> <SKU>`, y si quieres ` — <texto como en la factura>` (ver abajo). |

El correo va al **correo principal de la persona del negocio** (o al primero de su lista, si ninguno es principal). Si está mal, corrígelo en la persona.

**Productos.** Con «Despacho · Productos», el correo lista esos productos con el enlace a su ficha. Un SKU que no está en el catálogo necesita el texto después de « — » (sale sin enlace); sin texto, el aviso no sale. Si lo dejas vacío:

- en un pedido de /solicitar-pedido (RC-…), la vista previa usa los productos de la solicitud, y «Enviar al cliente» también, si la vista previa fue en las últimas 24 horas;
- en los demás casos, el correo dice «el detalle de los productos va en la factura N° … adjunta».

## 2. Vista previa y envío

1. Elige **«Vista previa»** en «Despacho · Aviso» y guarda. En menos de un minuto te llega a tu correo el aviso tal como lo vería el cliente, con «[Vista previa]» en el asunto, y en el negocio queda la nota «Vista previa enviada…». El campo vuelve a quedar vacío.
2. Revisa el correo. Si algo está mal, corrige el campo o el archivo y pide otra vista previa (hasta 5 por hora por negocio).
3. Elige **«Enviar al cliente»**. Sale el correo al cliente. En el negocio quedan:
   - la nota «Aviso de despacho enviado (…)», con todos los datos y los adjuntos;
   - «Despacho · Aviso enviado» con la fecha, la hora, el operador y la orden;
   - la etapa «Despachado» (si el embudo la tiene; si no, solo la nota);
   - el campo «Despacho · Aviso» vacío.

El valor del negocio nunca cambia. Mover el negocio a mano a «Despachado» no envía nada.

**Un segundo envío del mismo negocio** (otra parte del pedido): otra orden de flete, la factura y el comprobante nuevos agregados después del primer aviso, y otra vez «Vista previa» y «Enviar al cliente». Si el negocio está archivado, desarchívalo primero.

## 3. Qué significa cada nota

| La nota dice | Qué pasó | Qué hacer |
|---|---|---|
| Vista previa enviada a tu correo | salió la vista previa, solo a ti | revisarla y elegir «Enviar al cliente» |
| Aviso de despacho enviado | el cliente ya lo tiene | nada |
| NO enviado … Falta o hay que corregir: (lista) | faltaba un dato, el correo, un archivo, o un archivo no sirve | corregir lo de la lista y volver a elegir |
| NO enviado … Reintenta en unos minutos | Pipedrive, Redis o el plazo de la función fallaron un momento | volver a elegir en unos minutos |
| NO enviado: ya se envió el … | esa orden de flete ya tuvo su aviso | nada; para corregir algo, escríbele desde Gmail |
| NO enviado: hay un envío en curso o sin confirmar | otro aviso de la misma orden estaba saliendo | revisar Enviados en 10 minutos; si no está, volver a elegir «Enviar al cliente» |
| no sé si salió | el relay no confirmó a tiempo | revisar Enviados (el asunto sin «[Vista previa]»); si no está, volver a elegir «Enviar al cliente». Si había salido, no se repite. |
| NO enviado: se acabó la cuota diaria de correos | Gmail no envía más hoy | reintentar mañana (también llega un correo ATENCIÓN a ventas@) |
| NO enviado: el relay rechazó el pedido / falta configuración | el relay o Vercel están mal configurados | avisarle a Claude (también llega un correo ATENCIÓN) |
| Vista previa NO enviada: ya van 5 vistas previas | límite de 5 por hora | esperar un rato |
| el envío al cliente queda disponible después del cambio de dominio | el sitio todavía no es elights.cl | por ahora, solo vista previa |

**Correo ATENCIÓN «el aviso salió, pero no quedó en Pipedrive»** (a ventas@, más una tarea para ti en el negocio): el cliente sí recibió el aviso, pero Pipedrive no guardó la nota o los campos. El correo dice qué falta anotar a mano y qué va en «Despacho · Aviso enviado». No vuelvas a elegir «Enviar al cliente» para esa orden.

## 4. Si el campo no se vació

Si a los 2 minutos «Despacho · Aviso» sigue con valor y no hay nota nueva, el aviso no se procesó (otro aviso del mismo negocio estaba en curso o el webhook no llegó):

1. vacía el campo y guarda;
2. vuelve a elegir la opción y guarda.

Elegir de nuevo el valor que ya tiene no hace nada: Pipedrive no avisa si el campo no cambió. Reintentar nunca envía dos veces la misma orden de flete: el sitio, el campo «Aviso enviado» y el relay lo impiden.

Si editas otros campos con «Despacho · Aviso» todavía puesto, no se envía nada: el aviso sale solo en el momento en que eliges la opción.

## 5. Configuración (una sola vez)

- El relay de Apps Script y sus dos variables de Vercel (`SHIPPING_RELAY_URL`, `SHIPPING_RELAY_SECRET`): `apps-script/aviso-despacho/README.md`. El secreto lo pones tú.
- `PIPEDRIVE_OWNER_USER_ID` en Vercel: tu usuario de Pipedrive, para la tarea del caso ATENCIÓN. Sin ella, solo llega el correo ATENCIÓN.
- Los 15 campos «Despacho · …» y la etapa «Despachado» se buscan por nombre: si cambias un nombre, el aviso no sale y la nota dice cuál falta.
