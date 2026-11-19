# Relay del aviso de despacho (Apps Script)

`Code.gs` es la aplicación web que envía el aviso de despacho desde tu cuenta Workspace. El sitio (Vercel) arma el correo y se lo manda firmado; el script lo envía:

- **Vista previa:** solo a tu correo (`OWNER_EMAIL`), con «[Vista previa]» en el asunto y sin copias.
- **Enviar al cliente:** al correo del cliente, una sola vez por envío. Si llega dos veces el mismo, responde «duplicate» y no envía. Antes de enviar deja reservado el envío en las propiedades: si un intento anterior se cortó a mitad de camino, responde «uncertain» y no envía (revisa Enviados).
- **La misma vista previa firmada dos veces:** la segunda responde «rejected» (`reenvio`) y no sale. Una vista previa nueva desde el sitio sí sale. Si la caché del script no responde, la vista previa no sale (`cache`). En el envío al cliente manda solo la reserva: el mismo pedido otra vez es un reintento más.

Sin la firma correcta no envía nada. El archivo no tiene secretos ni direcciones (el repo es público): todo va en las propiedades del script. El secreto lo escribes tú en los dos lados; Claude nunca lo ve.

`Code.gs` queda fuera del sitio: no lo revisan TypeScript ni ESLint y no va en el build. Las pruebas del servidor sí lo cargan para correr `testDoPost` (`api/_lib/notify/shippingRelay.test.ts`).

---

## 1. Crear el proyecto

1. Entra a [script.google.com](https://script.google.com) con tu cuenta Workspace de eLIGHTS (nunca una cuenta personal).
2. **Nuevo proyecto**. Ponle de nombre «eLIGHTS · aviso de despacho».
3. Borra lo que trae `Código.gs` y pega todo el contenido de `apps-script/aviso-despacho/Code.gs` (rama `main` del repo). Guarda con Ctrl+S.
4. En **Configuración del proyecto** (el engranaje), deja marcado «Habilitar el entorno de ejecución de Chrome V8» (viene así).

## 2. Probar sin enviar nada: `testDoPost`

1. En el editor, elige `testDoPost` en la lista de funciones de arriba y pulsa **Ejecutar**.
2. La primera vez, Google pide autorizar: **Revisar permisos** → tu cuenta. Si dice «Google no verificó esta app», es porque el script es tuyo: **Configuración avanzada** → **Ir a eLIGHTS · aviso de despacho** → **Permitir**. Pide Gmail (para enviar los avisos), las propiedades del script y el envío de correo (para leer la cuota diaria).
3. En el **Registro de ejecución** tiene que aparecer «testDoPost: … verificaciones OK (sin enviar correos ni tocar las propiedades)».

`testDoPost` usa datos ficticios y un entorno simulado: no envía correos ni toca las propiedades reales. Revisa la firma con el mismo vector que las pruebas del servidor, la reserva del envío (que un envío que falla la borre y el reintento sí salga, que sin espacio no se envíe y que una reserva que quedó pendiente nunca se reenvíe), el «duplicate», la vista previa (solo a tu correo, sin repetir la misma y sin salir si la caché no responde), los rechazos, la cuota y la limpieza de claves viejas. Si dice «testDoPost falló: …», pásale ese texto a Claude.

## 3. El secreto

En una terminal tuya (no en la pestaña de terminal de la app de Claude, que Claude puede leer):

```bash
openssl rand -hex 32
```

Da 64 letras y números. Si prefieres que no quede a la vista, cópialo directo al portapapeles: `openssl rand -hex 32 | tr -d '\n' | wl-copy` (en Ubuntu necesita `sudo apt install wl-clipboard`).

Pégalo en los dos lados, sin espacios:

- **Apps Script:** propiedad `SHARED_SECRET` (paso 4).
- **Vercel:** proyecto → Settings → Environment Variables → `SHIPPING_RELAY_SECRET`, solo en **Production** y marcada como Sensitive.

No lo pegues en el chat ni en archivos del repo. Para cambiarlo, cámbialo en los dos lados y haz un despliegue nuevo en Vercel.

## 4. Las propiedades del script

**Configuración del proyecto** → **Propiedades del script** → **Agregar propiedad del script**:

| Propiedad | Valor |
|---|---|
| `SHARED_SECRET` | el secreto del paso 3 |
| `OWNER_EMAIL` | tu correo de Workspace. Ahí llega la vista previa, que trae el comprobante del cliente (y su factura, si se adjuntó): nunca una cuenta personal. |
| `REPLY_TO` | el correo donde quieres recibir las respuestas de los clientes (el de la firma del aviso) |
| `SENDER_NAME` | `eLIGHTS.cl` (el nombre que ve el cliente como remitente) |
| `BCC` | no la crees en la primera versión. Si algún día se agrega, va un solo correo y solo en los envíos al cliente, nunca en la vista previa. |

Sin `SHARED_SECRET` (o con uno de menos de 32 caracteres), `OWNER_EMAIL`, `REPLY_TO` o `SENDER_NAME`, el script responde «config» y no envía nada.

Con el uso van a aparecer filas `aviso:` seguidas de 64 letras y números: es el registro de los avisos enviados (un hash, sin datos del cliente). No las borres: el script borra solo las de más de 400 días.

## 5. Implementar como aplicación web

1. **Implementar** → **Nueva implementación** → en «Seleccionar tipo» (engranaje), **Aplicación web**.
2. Descripción: `v1`.
3. **Ejecutar como:** «Yo» (tu correo).
4. **Quién tiene acceso:** «Cualquier persona» (en inglés, «Anyone»). No elijas la opción con cuenta de Google ni la de tu dominio: Vercel no tiene cuenta de Google y recibiría la página para iniciar sesión. Lo protege la firma: sin el secreto, el script no envía nada.
5. **Implementar** y copia la **URL de la aplicación web**: termina en `/exec`.

**Si en «Quién tiene acceso» no aparece «Cualquier persona»** (solo la opción de tu dominio), la consola de administración de Workspace lo está limitando. No sigas y avísale a Claude: Vercel no podría llamar al script.

## 6. Comprobar el acceso

Abre la URL `/exec` en una ventana de incógnito, sin sesión de Google. Tiene que mostrar:

```json
{"servicio":"aviso-despacho","version":1}
```

Si muestra la página para iniciar sesión, el acceso no quedó en «Cualquier persona» (paso 5).

## 7. Vercel (Production)

| Variable | Valor | Quién |
|---|---|---|
| `SHIPPING_RELAY_URL` | la URL `/exec` del paso 5 | Claude, con tu OK (no es secreta, pero no va en el repo), o tú |
| `SHIPPING_RELAY_SECRET` | el secreto del paso 3 | tú |

Vercel toma las variables nuevas en el siguiente despliegue.

## 8. Actualizar el código

1. Corre `testDoPost` con la versión nueva pegada.
2. **Implementar** → **Gestionar implementaciones** → el lápiz → Versión: **Nueva versión** → **Implementar**.

Así la URL `/exec` no cambia. Una «Nueva implementación» crea otra URL, y habría que cambiar `SHIPPING_RELAY_URL` en Vercel.

## 9. Qué queda registrado

- **Ejecuciones** (menú de la izquierda): una línea por pedido, como `[aviso-despacho] despacho c4ea6a81 ok`: la acción, los primeros 8 caracteres de la clave y el resultado. Nunca el destinatario, el nombre, el asunto, el cuerpo ni los adjuntos.
- **Propiedades del script:** una fila `aviso:<clave>` por aviso al cliente: `pendiente:<hora>` mientras se envía y `enviado:<hora>` cuando salió. Las de más de 400 días se borran solas. No las edites a mano: si una queda en `pendiente` (el script se cortó o no pudo marcarla), el aviso responde `uncertain` hasta que revises Enviados.
- **Caché del script** (no se ve en el editor): la huella de cada vista previa firmada, unos 6 minutos, para no enviarla dos veces. El envío al cliente no la usa.
- **Enviados** de tu cuenta: el aviso y la vista previa (se confirma en la primera prueba).

## 10. Qué responde el script

| Respuesta | Qué pasó |
|---|---|
| `ok` | salió el correo |
| `duplicate` | ese envío ya había salido antes: no se repite |
| `uncertain` + `pendiente` | un intento anterior reservó el envío y no alcanzó a confirmarlo: no se reenvía. Revisa **Enviados**: si el correo no está, avísale a Claude |
| `quota` | se acabó la cuota diaria de correos de Gmail: no salió |
| `rejected` + `almacenamiento` | no se pudo guardar la reserva (propiedades llenas): no salió. Avísale a Claude |
| `rejected` + `reenvio` | llegó otra vez exactamente la misma vista previa firmada: no se repite. Pide una nueva desde el sitio |
| `rejected` + `cache` | la caché del script no respondió: la vista previa no salió. Se puede reintentar |
| `rejected` + `firma` | el secreto no es el mismo en Apps Script y en Vercel |
| `rejected` + `hora` | el pedido llegó con más de 5 minutos de diferencia |
| `rejected` + `config` | falta una propiedad del script (paso 4) |
| `rejected` + `para` | el correo del cliente no es válido |
| `rejected` + `adjuntos` | más de 2 adjuntos, más de 10 MB o un archivo que no es PDF, JPEG o PNG |
| `rejected` + `ocupado` | otro aviso se estaba enviando: se puede reintentar |
| `rejected` + `envio` | Gmail no aceptó el envío: no salió y se puede reintentar |
| `rejected` + otro código | `json`, `version`, `accion`, `clave`, `asunto`, `texto` o `interno`: un problema del pedido o del script. Avísale a Claude. |

En el día a día, el resultado te llega como nota en el negocio de Pipedrive: no hace falta mirarlo aquí.

## 11. Por confirmar en la primera prueba

Con una vista previa en el negocio de prueba (va solo a tu correo):

- que acepte un pedido de unos 8 MB (factura y comprobante grandes): Google no documenta el tamaño máximo que recibe `doPost`;
- que el aviso quede en **Enviados**;
- que el acceso «Cualquier persona» funcione desde Vercel (paso 6).
