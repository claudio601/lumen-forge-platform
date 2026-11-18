// eLIGHTS · Relay del aviso de despacho (Nivel 2) · versión 1 (18-11-2026)
//
// Aplicación web de Apps Script en la cuenta Workspace del dueño. Recibe de nuevo.elights.cl
// (api/_lib/notify/shippingRelay.ts) el aviso de despacho ya armado y lo envía:
//   - acción «despacho»: al correo del cliente, una sola vez por clave;
//   - acción «preview» (vista previa): solo a OWNER_EMAIL, sin copia, con «[Vista previa] »
//     al comienzo del asunto.
// Cómo instalarlo y probarlo: README.md, en esta misma carpeta del repo.
//
// Seguridad:
//   - el cuerpo trae { ts, payload, sig }: sig es el HMAC-SHA256 en hex de `${ts}.${payload}`,
//     con SHARED_SECRET como clave. Sin la firma correcta no se envía nada, y se rechaza un ts
//     (segundos) con más de 5 minutos de diferencia;
//   - el nombre del remitente, la respuesta, la copia oculta y el destino de la vista previa
//     salen solo de las propiedades del script, nunca del pedido;
//   - un solo destinatario, que tiene que ser un correo válido; hasta 2 adjuntos (PDF, JPEG o
//     PNG, comprobados por sus primeros bytes) y 10 MB en total.
//
// Envío doble: cada despacho trae una clave, que es un hash (no deja leer ni el negocio ni la
// orden de flete). Dentro de un candado (LockService), si la clave ya está registrada responde
// «duplicate» sin enviar; si no, envía y registra la clave solo si el envío no lanzó error, para
// que un reintento después de una falla sí salga. Las claves de más de 400 días se borran
// (PropertiesService guarda hasta 500 KB).
//
// Registros: solo la acción, los primeros 8 caracteres de la clave y el resultado. Nunca el
// destinatario, el nombre, el asunto, el cuerpo ni los adjuntos.
//
// Respuesta (JSON): {status: "ok"}, {status: "duplicate"}, {status: "quota"} o
// {status: "rejected", reason: "<código>"}. Códigos: json, firma, hora, version, accion, clave,
// para, asunto, texto, adjuntos, config, ocupado, envio, interno.
//
// Este archivo no tiene secretos ni direcciones (el repo es público): todo va en
// Configuración del proyecto → Propiedades del script.

var VERSION = 1;
var PREFIJO_CLAVE = 'aviso:';
var MAX_DIFERENCIA_MS = 5 * 60 * 1000;
var MAX_ADJUNTOS = 2;
var MAX_BYTES_ADJUNTOS = 10 * 1024 * 1024;
var MAX_ASUNTO = 250;
var MAX_TEXTO = 200000;
var MIN_SECRETO = 32;
var DIAS_CLAVE = 400;
var ESPERA_CANDADO_MS = 10000;
var PREFIJO_VISTA_PREVIA = '[Vista previa] ';

var RE_HEX64 = /^[0-9a-f]{64}$/;
// Un solo correo, sin nombre visible ni separadores (coma, punto y coma, espacios).
var RE_CORREO = /^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
// Nombre del adjunto: sin caracteres de control ni separadores de ruta.
var RE_NOMBRE_ADJUNTO = /^[^\x00-\x1f\x7f\\\/:*?"<>|]{1,120}$/;
var RE_BASE64 = /^[A-Za-z0-9+\/]+={0,2}$/;
// Mensajes de Gmail cuando se acaba la cuota diaria.
var RE_CUOTA = /too many times|quota|cuota|l[ií]mite|limit exceeded/i;

// Tipos aceptados: extensión del nombre y primeros bytes.
var TIPOS = {
  'application/pdf': { extension: /\.pdf$/i, inicio: [0x25, 0x50, 0x44, 0x46, 0x2d] },
  'image/jpeg': { extension: /\.jpe?g$/i, inicio: [0xff, 0xd8, 0xff] },
  'image/png': { extension: /\.png$/i, inicio: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }
};

function doPost(e) {
  var cuerpo = e && e.postData && typeof e.postData.contents === 'string' ? e.postData.contents : '';
  return responder(procesar(cuerpo, entornoReal()));
}

// Abrir la URL /exec en una ventana de incógnito: si se ve esto, el acceso es «Cualquier persona».
function doGet() {
  return responder({ servicio: 'aviso-despacho', version: VERSION });
}

function responder(objeto) {
  return ContentService.createTextOutput(JSON.stringify(objeto)).setMimeType(ContentService.MimeType.JSON);
}

// ---------- Entorno: Google en producción, simulado en testDoPost ----------

function entornoReal() {
  var propiedades = PropertiesService.getScriptProperties();
  return {
    config: leerConfig(propiedades),
    claves: propiedades,
    ahora: function () { return Date.now(); },
    cuota: function () { return MailApp.getRemainingDailyQuota(); },
    enviar: function (para, asunto, texto, opciones) { GmailApp.sendEmail(para, asunto, texto, opciones); },
    candado: function () { return LockService.getScriptLock(); },
    registrar: function (linea) { console.log(linea); }
  };
}

function leerConfig(propiedades) {
  function valor(nombre) {
    var v = propiedades.getProperty(nombre);
    return v === null || v === undefined ? '' : String(v).trim();
  }
  return {
    secreto: valor('SHARED_SECRET'),
    ownerEmail: valor('OWNER_EMAIL'),
    replyTo: valor('REPLY_TO'),
    senderName: valor('SENDER_NAME'),
    bcc: valor('BCC')
  };
}

// ---------- Proceso ----------

/** Procesa un cuerpo y deja una línea en el registro. Nunca lanza. */
function procesar(cuerpo, entorno) {
  var registro = { accion: 'desconocida', clave: '--------' };
  var respuesta;
  try {
    respuesta = evaluar(cuerpo, entorno, registro);
  } catch (err) {
    // El envío y el registro de la clave tienen su propio manejo: esto pasa antes de enviar.
    respuesta = rechazo('interno');
  }
  entorno.registrar('[aviso-despacho] ' + registro.accion + ' ' + registro.clave + ' ' + respuesta.status +
    (respuesta.reason ? ' ' + respuesta.reason : ''));
  return respuesta;
}

function evaluar(cuerpo, entorno, registro) {
  var sobre = leerJson(cuerpo);
  if (!sobre || typeof sobre.payload !== 'string' || typeof sobre.sig !== 'string' || typeof sobre.ts !== 'number') {
    return rechazo('json');
  }
  var config = entorno.config;
  if (config.secreto.length < MIN_SECRETO) return rechazo('config');
  if (!RE_HEX64.test(sobre.sig) || !igualesEnTiempoConstante(firmar(config.secreto, sobre.ts, sobre.payload), sobre.sig)) {
    return rechazo('firma');
  }
  if (Math.floor(sobre.ts) !== sobre.ts || Math.abs(entorno.ahora() - sobre.ts * 1000) > MAX_DIFERENCIA_MS) {
    return rechazo('hora');
  }

  var pedido = leerJson(sobre.payload);
  if (!pedido) return rechazo('json');
  if (pedido.v !== VERSION) return rechazo('version');
  if (pedido.action !== 'preview' && pedido.action !== 'despacho') return rechazo('accion');
  registro.accion = pedido.action;
  if (typeof pedido.key !== 'string' || !RE_HEX64.test(pedido.key)) return rechazo('clave');
  registro.clave = pedido.key.slice(0, 8);
  if (!asuntoValido(pedido.subject)) return rechazo('asunto');
  if (!textoValido(pedido.html) || !textoValido(pedido.text)) return rechazo('texto');
  if (pedido.action === 'despacho' && !correoValido(pedido.to)) return rechazo('para');
  var adjuntos = leerAdjuntos(pedido.attachments);
  if (!adjuntos) return rechazo('adjuntos');
  if (!correoValido(config.ownerEmail) || !correoValido(config.replyTo) || !config.senderName ||
      (config.bcc && !correoValido(config.bcc))) {
    return rechazo('config');
  }

  return pedido.action === 'preview' ? vistaPrevia(pedido, adjuntos, entorno) : despacho(pedido, adjuntos, entorno);
}

/** Vista previa: solo a OWNER_EMAIL, sin cc ni bcc. No usa ni registra la clave. */
function vistaPrevia(pedido, adjuntos, entorno) {
  if (entorno.cuota() < 1) return { status: 'quota' };
  var asunto = pedido.subject.indexOf(PREFIJO_VISTA_PREVIA) === 0 ? pedido.subject : PREFIJO_VISTA_PREVIA + pedido.subject;
  try {
    entorno.enviar(entorno.config.ownerEmail, asunto, pedido.text, opcionesCorreo(pedido, adjuntos, entorno.config, false));
  } catch (err) {
    return errorDeEnvio(err);
  }
  return { status: 'ok' };
}

/** Despacho: una sola vez por clave, dentro del candado del script. */
function despacho(pedido, adjuntos, entorno) {
  var candado = entorno.candado();
  if (!candado.tryLock(ESPERA_CANDADO_MS)) return rechazo('ocupado');
  try {
    var ahora = entorno.ahora();
    try {
      limpiarClaves(entorno.claves, ahora);
    } catch (errLimpieza) {
      // Una limpieza que falla no detiene el aviso: se reintenta en el próximo.
      entorno.registrar('[aviso-despacho] limpieza de claves no terminó');
    }
    var nombre = PREFIJO_CLAVE + pedido.key;
    if (entorno.claves.getProperty(nombre) !== null) return { status: 'duplicate' };
    var destinatarios = entorno.config.bcc ? 2 : 1;
    if (entorno.cuota() < destinatarios) return { status: 'quota' };
    try {
      entorno.enviar(pedido.to, pedido.subject, pedido.text, opcionesCorreo(pedido, adjuntos, entorno.config, true));
    } catch (err) {
      // No se registra la clave: el reintento tiene que poder salir.
      return errorDeEnvio(err);
    }
    try {
      entorno.claves.setProperty(nombre, String(ahora));
    } catch (errRegistro) {
      // El correo ya salió: se responde ok. Redis y el campo «Aviso enviado» siguen evitando el doble envío.
      entorno.registrar('[aviso-despacho] despacho ' + pedido.key.slice(0, 8) + ' clave no registrada');
    }
    return { status: 'ok' };
  } finally {
    try {
      candado.releaseLock();
    } catch (errCandado) {
      // Google suelta el candado al terminar la ejecución.
    }
  }
}

/** Borra las claves de más de 400 días. No toca las propiedades de configuración. */
function limpiarClaves(claves, ahora) {
  var limite = ahora - DIAS_CLAVE * 24 * 60 * 60 * 1000;
  var todas = claves.getProperties();
  Object.keys(todas).forEach(function (nombre) {
    if (nombre.indexOf(PREFIJO_CLAVE) !== 0) return;
    var cuando = Number(todas[nombre]);
    if (isFinite(cuando) && cuando < limite) claves.deleteProperty(nombre);
  });
}

function opcionesCorreo(pedido, adjuntos, config, conCopiaOculta) {
  var opciones = { htmlBody: pedido.html, name: config.senderName, replyTo: config.replyTo };
  if (adjuntos.length) opciones.attachments = adjuntos;
  if (conCopiaOculta && config.bcc) opciones.bcc = config.bcc;
  return opciones;
}

/** Excepción de Gmail: cuota agotada o envío rechazado. El mensaje no se registra (puede traer el correo). */
function errorDeEnvio(err) {
  var texto = String(err && err.message ? err.message : err);
  return RE_CUOTA.test(texto) ? { status: 'quota' } : rechazo('envio');
}

function rechazo(motivo) {
  return { status: 'rejected', reason: motivo };
}

// ---------- Validación ----------

function leerJson(texto) {
  try {
    var valor = JSON.parse(texto);
    return valor && typeof valor === 'object' && !Array.isArray(valor) ? valor : null;
  } catch (e) {
    return null;
  }
}

function correoValido(valor) {
  return typeof valor === 'string' && valor.length <= 254 && RE_CORREO.test(valor);
}

function asuntoValido(valor) {
  return typeof valor === 'string' && valor.trim() !== '' && valor.length <= MAX_ASUNTO && !/[\r\n]/.test(valor);
}

function textoValido(valor) {
  return typeof valor === 'string' && valor.trim() !== '' && valor.length <= MAX_TEXTO;
}

/** Adjuntos como blobs, o null si alguno no sirve. */
function leerAdjuntos(lista) {
  if (!Array.isArray(lista) || lista.length > MAX_ADJUNTOS) return null;
  var total = 0;
  var blobs = [];
  for (var i = 0; i < lista.length; i++) {
    var a = lista[i];
    if (!a || typeof a !== 'object' || !Object.prototype.hasOwnProperty.call(TIPOS, a.mimeType)) return null;
    var tipo = TIPOS[a.mimeType];
    if (typeof a.name !== 'string' || !RE_NOMBRE_ADJUNTO.test(a.name) || !tipo.extension.test(a.name)) return null;
    if (typeof a.data !== 'string' || a.data.length % 4 !== 0 || !RE_BASE64.test(a.data)) return null;
    // Tamaño decodificado antes de decodificar: 3 bytes por cada 4 caracteres, menos el relleno.
    var relleno = a.data.slice(-2) === '==' ? 2 : a.data.slice(-1) === '=' ? 1 : 0;
    total += a.data.length / 4 * 3 - relleno;
    if (total > MAX_BYTES_ADJUNTOS) return null;
    var bytes = Utilities.base64Decode(a.data);
    if (!empiezaCon(bytes, tipo.inicio)) return null;
    blobs.push(Utilities.newBlob(bytes, a.mimeType, a.name));
  }
  return blobs;
}

/** Apps Script da los bytes con signo (-128 a 127). */
function empiezaCon(bytes, inicio) {
  if (bytes.length < inicio.length) return false;
  for (var i = 0; i < inicio.length; i++) {
    if ((bytes[i] & 0xff) !== inicio[i]) return false;
  }
  return true;
}

// ---------- Firma ----------

/** HMAC-SHA256 en hex de `${ts}.${payload}`: el mismo cálculo que signShippingPayload en el servidor. */
function firmar(secreto, ts, payload) {
  return aHex(Utilities.computeHmacSha256Signature(String(ts) + '.' + payload, secreto, Utilities.Charset.UTF_8));
}

function aHex(bytes) {
  var hex = '';
  for (var i = 0; i < bytes.length; i++) {
    var b = bytes[i] & 0xff;
    hex += (b < 16 ? '0' : '') + b.toString(16);
  }
  return hex;
}

/** Compara sin cortar en la primera diferencia, para no revelar cuántos caracteres coinciden. */
function igualesEnTiempoConstante(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  var diferencia = 0;
  for (var i = 0; i < a.length; i++) diferencia |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diferencia === 0;
}

// ---------- Prueba: ejecutar testDoPost desde el editor (botón Ejecutar) ----------
// Usa datos ficticios y el mismo vector de firma que api/_lib/notify/shippingRelay.test.ts.
// No envía correos ni toca las propiedades reales: corre con un entorno simulado.

var PRUEBA = {
  secreto: 'secreto-de-prueba-solo-para-el-vector-0123456789abcdef',
  ts: 1795000000,
  payload:
    '{"v":1,"action":"despacho","key":"c4ea6a81742a5462b236a0d8840ed67e10003fce958d08d528e2ffe866266ba3",' +
    '"to":"cliente.prueba@example.com",' +
    '"subject":"Tu pedido va en camino \\u2014 Factura N\\u00b0 1234, Starken orden de flete ABC123456",' +
    '"html":"<p>Hola Prueba, tu pedido va en camino.</p>",' +
    '"text":"Hola Prueba,\\n\\nTu pedido ya va en camino.",' +
    '"attachments":[{"name":"Factura-1234.pdf","mimeType":"application/pdf","data":"JVBERi0xLjQKJXBydWViYQo="}]}',
  sig: 'bba784e7b2ca71c7b18d36e080c4aeca7cf41631321917dc285131e688edba27'
};

function testDoPost() {
  var lineas = [];
  var verificaciones = 0;
  function verificar(condicion, que) {
    if (!condicion) throw new Error('testDoPost falló: ' + que);
    verificaciones++;
  }
  function base() {
    return JSON.parse(PRUEBA.payload);
  }
  function sobre(pedido, ts, secreto) {
    var payload = JSON.stringify(pedido);
    var t = ts === undefined ? PRUEBA.ts : ts;
    return JSON.stringify({ ts: t, payload: payload, sig: firmar(secreto || PRUEBA.secreto, t, payload) });
  }
  var vector = JSON.stringify({ ts: PRUEBA.ts, payload: PRUEBA.payload, sig: PRUEBA.sig });
  var clave = 'aviso:' + base().key;
  var e;
  var p;

  // 1. La firma del vector es la misma que calcula el servidor.
  verificar(firmar(PRUEBA.secreto, PRUEBA.ts, PRUEBA.payload) === PRUEBA.sig, 'la firma del vector no coincide con la del servidor');
  verificar(base().subject === 'Tu pedido va en camino — Factura N° 1234, Starken orden de flete ABC123456', 'el asunto del vector no se lee bien');

  // 2. Un envío que falla no registra la clave; el reintento sí sale; el tercero es duplicate.
  e = entornoDePrueba({}, lineas);
  e.fallar = true;
  verificar(procesar(vector, e).reason === 'envio', 'una falla de Gmail no respondió rejected/envio');
  verificar(e.guardadas[clave] === undefined, 'una falla de envío registró la clave');
  verificar(e.tomados === 1 && e.liberados === 1, 'el candado no se soltó después de la falla');
  e.fallar = false;
  verificar(procesar(vector, e).status === 'ok', 'el reintento después de la falla no salió');
  verificar(e.envios.length === 1 && e.envios[0].para === 'cliente.prueba@example.com', 'el despacho no fue al correo del pedido');
  verificar(e.envios[0].asunto === base().subject && e.envios[0].texto === base().text, 'el despacho cambió el asunto o el texto');
  verificar(e.envios[0].opciones.htmlBody === base().html && e.envios[0].opciones.name === e.config.senderName &&
    e.envios[0].opciones.replyTo === e.config.replyTo, 'faltan el HTML, el nombre o la respuesta');
  verificar(e.envios[0].opciones.attachments.length === 1 && !('bcc' in e.envios[0].opciones), 'adjuntos o copia oculta incorrectos');
  verificar(e.guardadas[clave] === String(PRUEBA.ts * 1000), 'la clave no quedó registrada después del envío');
  verificar(procesar(vector, e).status === 'duplicate' && e.envios.length === 1, 'el tercer intento volvió a enviar');
  verificar(e.tomados === 3 && e.liberados === 3, 'el candado no se soltó');

  // 3. Vista previa: solo al dueño, sin copia oculta, con el prefijo una sola vez y sin registrar la clave.
  e = entornoDePrueba({ bcc: 'copia.prueba@example.com' }, lineas);
  p = base();
  p.action = 'preview';
  delete p.to;
  verificar(procesar(sobre(p), e).status === 'ok', 'la vista previa no salió');
  verificar(e.envios[0].para === e.config.ownerEmail, 'la vista previa no fue a OWNER_EMAIL');
  verificar(e.envios[0].asunto === '[Vista previa] ' + p.subject, 'la vista previa no lleva el prefijo');
  verificar(!('bcc' in e.envios[0].opciones) && !('cc' in e.envios[0].opciones), 'la vista previa llevó copia');
  verificar(Object.keys(e.guardadas).length === 0 && e.tomados === 0, 'la vista previa usó la clave o el candado');
  p.to = 'cliente.prueba@example.com';
  p.subject = '[Vista previa] ' + p.subject;
  procesar(sobre(p), e);
  verificar(e.envios[1].para === e.config.ownerEmail, 'la vista previa con correo del cliente salió al cliente');
  verificar(e.envios[1].asunto === p.subject, 'el prefijo de la vista previa quedó dos veces');

  // 4. Con BCC en las propiedades, el despacho lleva la copia oculta.
  e = entornoDePrueba({ bcc: 'copia.prueba@example.com' }, lineas);
  procesar(vector, e);
  verificar(e.envios[0].opciones.bcc === 'copia.prueba@example.com', 'el despacho no llevó el BCC configurado');

  // 5. Rechazos: nada sale.
  e = entornoDePrueba({}, lineas);
  var otraFirma = (PRUEBA.sig.charAt(0) === 'a' ? 'b' : 'a') + PRUEBA.sig.slice(1);
  verificar(procesar(JSON.stringify({ ts: PRUEBA.ts, payload: PRUEBA.payload, sig: otraFirma }), e).reason === 'firma', 'aceptó una firma alterada');
  verificar(procesar(JSON.stringify({ ts: PRUEBA.ts, payload: PRUEBA.payload + ' ', sig: PRUEBA.sig }), e).reason === 'firma', 'aceptó un payload alterado');
  verificar(procesar(JSON.stringify({ ts: PRUEBA.ts + 1, payload: PRUEBA.payload, sig: PRUEBA.sig }), e).reason === 'firma', 'aceptó otro ts con la misma firma');
  verificar(procesar(sobre(base(), PRUEBA.ts, 'otro-secreto-de-prueba-con-mas-de-32-caracteres'), e).reason === 'firma', 'aceptó otro secreto');
  verificar(procesar(sobre(base(), PRUEBA.ts - 301), e).reason === 'hora', 'aceptó un ts de hace más de 5 minutos');
  verificar(procesar(sobre(base(), PRUEBA.ts + 301), e).reason === 'hora', 'aceptó un ts de más de 5 minutos en el futuro');
  verificar(procesar(sobre(base(), PRUEBA.ts - 299), e).status === 'ok', 'rechazó un ts de hace menos de 5 minutos');
  e = entornoDePrueba({}, lineas);
  verificar(procesar('no es json', e).reason === 'json', 'aceptó un cuerpo que no es JSON');
  verificar(procesar('', e).reason === 'json', 'aceptó un cuerpo vacío');
  p = base(); p.v = 2;
  verificar(procesar(sobre(p), e).reason === 'version', 'aceptó otra versión');
  p = base(); p.action = 'enviar';
  verificar(procesar(sobre(p), e).reason === 'accion', 'aceptó otra acción');
  p = base(); p.key = 'abc';
  verificar(procesar(sobre(p), e).reason === 'clave', 'aceptó una clave que no es un hash');
  p = base(); p.to = 'uno.prueba@example.com, dos.prueba@example.com';
  verificar(procesar(sobre(p), e).reason === 'para', 'aceptó dos destinatarios');
  p = base(); p.to = 'Cliente Prueba <uno.prueba@example.com>';
  verificar(procesar(sobre(p), e).reason === 'para', 'aceptó un destinatario con nombre');
  p = base(); delete p.to;
  verificar(procesar(sobre(p), e).reason === 'para', 'aceptó un despacho sin destinatario');
  p = base(); p.subject = 'Asunto\r\nBcc: otro.prueba@example.com';
  verificar(procesar(sobre(p), e).reason === 'asunto', 'aceptó un asunto con salto de línea');
  p = base(); p.html = '';
  verificar(procesar(sobre(p), e).reason === 'texto', 'aceptó un correo sin HTML');
  p = base(); p.attachments = [p.attachments[0], p.attachments[0], p.attachments[0]];
  verificar(procesar(sobre(p), e).reason === 'adjuntos', 'aceptó 3 adjuntos');
  p = base(); p.attachments[0].data = Utilities.base64Encode('hola, no soy un PDF');
  verificar(procesar(sobre(p), e).reason === 'adjuntos', 'aceptó un PDF que no empieza con %PDF-');
  p = base(); p.attachments[0].mimeType = 'application/zip';
  verificar(procesar(sobre(p), e).reason === 'adjuntos', 'aceptó otro tipo de archivo');
  p = base(); p.attachments[0].name = 'Factura-1234.jpg';
  verificar(procesar(sobre(p), e).reason === 'adjuntos', 'aceptó un nombre con otra extensión');
  p = base(); p.attachments[0].data = 'JVBERi0x$%&=';
  verificar(procesar(sobre(p), e).reason === 'adjuntos', 'aceptó un base64 inválido');
  verificar(e.envios.length === 0 && Object.keys(e.guardadas).length === 0, 'un pedido rechazado envió o registró algo');

  // 6. Cuota, candado ocupado, configuración y cuota agotada en Gmail.
  e = entornoDePrueba({}, lineas);
  e.cuotaRestante = 0;
  verificar(procesar(vector, e).status === 'quota' && e.envios.length === 0 && e.guardadas[clave] === undefined, 'sin cuota envió o registró la clave');
  e = entornoDePrueba({ bcc: 'copia.prueba@example.com' }, lineas);
  e.cuotaRestante = 1;
  verificar(procesar(vector, e).status === 'quota', 'con BCC y cuota para un solo destinatario igual envió');
  e = entornoDePrueba({}, lineas);
  e.ocupado = true;
  verificar(procesar(vector, e).reason === 'ocupado' && e.envios.length === 0, 'con el candado tomado igual envió');
  e = entornoDePrueba({}, lineas);
  e.config.secreto = '';
  verificar(procesar(vector, e).reason === 'config', 'sin SHARED_SECRET no respondió config');
  e = entornoDePrueba({}, lineas);
  e.config.secreto = 'corto';
  verificar(procesar(vector, e).reason === 'config', 'con un SHARED_SECRET corto no respondió config');
  ['ownerEmail', 'replyTo', 'senderName'].forEach(function (campo) {
    e = entornoDePrueba({}, lineas);
    e.config[campo] = '';
    verificar(procesar(vector, e).reason === 'config', 'sin ' + campo + ' no respondió config');
  });
  e = entornoDePrueba({ bcc: 'no es un correo' }, lineas);
  verificar(procesar(vector, e).reason === 'config', 'aceptó un BCC inválido');
  e = entornoDePrueba({}, lineas);
  e.fallar = 'Service invoked too many times for one day: email.';
  verificar(procesar(vector, e).status === 'quota' && e.guardadas[clave] === undefined, 'la cuota agotada en Gmail no respondió quota o registró la clave');

  // 7. Limpieza: borra las claves de más de 400 días y deja las demás y la configuración.
  e = entornoDePrueba({}, lineas);
  var dia = 24 * 60 * 60 * 1000;
  var vieja = 'aviso:' + 'a'.repeat(64);
  var reciente = 'aviso:' + 'b'.repeat(64);
  e.guardadas[vieja] = String(PRUEBA.ts * 1000 - 401 * dia);
  e.guardadas[reciente] = String(PRUEBA.ts * 1000 - 399 * dia);
  e.guardadas.SHARED_SECRET = 'no se toca';
  verificar(procesar(vector, e).status === 'ok', 'el despacho con claves guardadas no salió');
  verificar(e.guardadas[vieja] === undefined, 'no borró la clave de más de 400 días');
  verificar(e.guardadas[reciente] !== undefined && e.guardadas.SHARED_SECRET === 'no se toca', 'borró una clave reciente o la configuración');

  // 8. Registros: sin destinatario, nombre, asunto, cuerpo, adjuntos ni secreto.
  var registros = lineas.join('\n');
  ['cliente.prueba', 'dueno.prueba', 'copia.prueba', 'respuestas.prueba', 'Hola Prueba', 'Factura', 'camino',
    'JVBERi0', PRUEBA.secreto, base().key].forEach(function (dato) {
    verificar(registros.indexOf(dato) === -1, 'un registro lleva datos del pedido');
  });
  verificar(registros.indexOf('[aviso-despacho] despacho c4ea6a81 ok') !== -1, 'falta la línea del despacho');

  // 9. La respuesta es JSON.
  verificar(responder({ status: 'ok' }).getContent() === '{"status":"ok"}', 'la respuesta no es JSON');

  console.log('testDoPost: ' + verificaciones + ' verificaciones OK (sin enviar correos ni tocar las propiedades)');
}

/** Entorno simulado: propiedades en memoria, Gmail que no envía, cuota y candado controlables. */
function entornoDePrueba(opciones, lineas) {
  var e = {
    config: {
      secreto: PRUEBA.secreto,
      ownerEmail: 'dueno.prueba@example.com',
      replyTo: 'respuestas.prueba@example.com',
      senderName: 'eLIGHTS.cl (prueba)',
      bcc: opciones.bcc || ''
    },
    guardadas: {},
    envios: [],
    fallar: false,
    cuotaRestante: 100,
    ocupado: false,
    tomados: 0,
    liberados: 0,
    ahora: function () { return PRUEBA.ts * 1000; },
    cuota: function () { return e.cuotaRestante; },
    enviar: function (para, asunto, texto, o) {
      if (e.fallar) throw new Error(typeof e.fallar === 'string' ? e.fallar : 'Fallo simulado de Gmail');
      e.envios.push({ para: para, asunto: asunto, texto: texto, opciones: o });
    },
    candado: function () {
      return {
        tryLock: function () {
          if (e.ocupado) return false;
          e.tomados++;
          return true;
        },
        releaseLock: function () { e.liberados++; }
      };
    },
    registrar: function (linea) { lineas.push(linea); }
  };
  e.claves = {
    getProperty: function (nombre) {
      return Object.prototype.hasOwnProperty.call(e.guardadas, nombre) ? e.guardadas[nombre] : null;
    },
    setProperty: function (nombre, valor) { e.guardadas[nombre] = String(valor); },
    deleteProperty: function (nombre) { delete e.guardadas[nombre]; },
    getProperties: function () {
      var copia = {};
      Object.keys(e.guardadas).forEach(function (nombre) { copia[nombre] = e.guardadas[nombre]; });
      return copia;
    }
  };
  return e;
}
