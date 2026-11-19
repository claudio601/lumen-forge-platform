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
// orden de flete). Dentro de un candado (LockService):
//   - antes de enviar, la clave queda reservada en las propiedades («pendiente:<ms>»). Si la
//     reserva no se puede guardar (almacenamiento lleno), no se envía;
//   - si Gmail lanza error, la reserva se borra para que el reintento sí salga;
//   - si el envío sale, la clave pasa a «enviado:<ms>». Si ese cambio falla, la reserva queda y
//     se responde ok: el reintento no vuelve a enviar;
//   - una clave «enviado» responde «duplicate»; una «pendiente» (una ejecución anterior se cortó
//     en el envío) responde «uncertain» y no se reenvía: hay que revisar Enviados.
// Las claves de más de 400 días, en los dos estados, se borran (PropertiesService guarda hasta
// 500 KB).
//
// Reenvío del mismo cuerpo: la firma de cada cuerpo aceptado (su hash) queda en CacheService
// mientras el ts siga dentro de los 5 minutos, más un margen. El mismo cuerpo otra vez responde
// «duplicate» con reason «reenvio», sin enviar, en la vista previa y en el despacho. Un cuerpo
// nuevo (otro ts u otro payload) tiene otra firma y sí sale.
//
// Registros: solo la acción, los primeros 8 caracteres de la clave y el resultado. Nunca el
// destinatario, el nombre, el asunto, el cuerpo ni los adjuntos.
//
// Respuesta (JSON): {status: "ok"}, {status: "duplicate"} (o con reason "reenvio"),
// {status: "quota"}, {status: "uncertain", reason: "pendiente"} o
// {status: "rejected", reason: "<código>"}. Códigos: json, firma, hora, version, accion, clave,
// para, asunto, texto, adjuntos, config, ocupado, almacenamiento, envio, interno.
//
// Este archivo no tiene secretos ni direcciones (el repo es público): todo va en
// Configuración del proyecto → Propiedades del script.

var VERSION = 1;
var PREFIJO_CLAVE = 'aviso:';
// Valor de una clave: «pendiente:<ms>» mientras se envía, «enviado:<ms>» cuando salió.
var PENDIENTE = 'pendiente:';
var ENVIADO = 'enviado:';
var PREFIJO_HUELLA = 'firma:';
// Margen de la huella después de que el ts sale de los 5 minutos.
var MARGEN_HUELLA_S = 60;
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
    cache: function () { return CacheService.getScriptCache(); },
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

  var huella = { nombre: PREFIJO_HUELLA + huellaDeFirma(sobre.sig), segundos: segundosDeHuella(sobre.ts, entorno.ahora()) };
  return pedido.action === 'preview' ? vistaPrevia(pedido, adjuntos, huella, entorno) : despacho(pedido, adjuntos, huella, entorno);
}

/** Vista previa: solo a OWNER_EMAIL, sin cc ni bcc. No registra la clave; el candado es para la huella. */
function vistaPrevia(pedido, adjuntos, huella, entorno) {
  return conCandado(entorno, function () {
    if (huellaRepetida(entorno, huella)) return { status: 'duplicate', reason: 'reenvio' };
    if (entorno.cuota() < 1) return { status: 'quota' };
    var asunto = pedido.subject.indexOf(PREFIJO_VISTA_PREVIA) === 0 ? pedido.subject : PREFIJO_VISTA_PREVIA + pedido.subject;
    guardarHuella(entorno, huella);
    try {
      entorno.enviar(entorno.config.ownerEmail, asunto, pedido.text, opcionesCorreo(pedido, adjuntos, entorno.config, false));
    } catch (err) {
      quitarHuella(entorno, huella);
      return errorDeEnvio(err);
    }
    return { status: 'ok' };
  });
}

/** Despacho: una sola vez por clave, dentro del candado del script. */
function despacho(pedido, adjuntos, huella, entorno) {
  return conCandado(entorno, function () {
    if (huellaRepetida(entorno, huella)) return { status: 'duplicate', reason: 'reenvio' };
    var ahora = entorno.ahora();
    try {
      limpiarClaves(entorno.claves, ahora);
    } catch (errLimpieza) {
      // Una limpieza que falla no detiene el aviso: se reintenta en el próximo.
      entorno.registrar('[aviso-despacho] limpieza de claves no terminó');
    }
    var nombre = PREFIJO_CLAVE + pedido.key;
    var estado = entorno.claves.getProperty(nombre);
    if (estado !== null) {
      // «pendiente»: una ejecución anterior reservó la clave y se cortó sin confirmar el envío.
      // No se sabe si el correo salió: nunca se reenvía (hay que revisar Enviados).
      return String(estado).indexOf(PENDIENTE) === 0 ? { status: 'uncertain', reason: 'pendiente' } : { status: 'duplicate' };
    }
    var destinatarios = entorno.config.bcc ? 2 : 1;
    if (entorno.cuota() < destinatarios) return { status: 'quota' };
    try {
      // Reserva durable antes de enviar: sin ella no hay cómo evitar el doble envío.
      entorno.claves.setProperty(nombre, PENDIENTE + ahora);
    } catch (errReserva) {
      return rechazo('almacenamiento');
    }
    guardarHuella(entorno, huella);
    try {
      entorno.enviar(pedido.to, pedido.subject, pedido.text, opcionesCorreo(pedido, adjuntos, entorno.config, true));
    } catch (err) {
      // Gmail no lo aceptó: se borra la reserva para que el reintento sí salga.
      try {
        entorno.claves.deleteProperty(nombre);
      } catch (errBorrado) {
        // La reserva queda: el reintento responde uncertain/pendiente, nunca un segundo envío.
        entorno.registrar('[aviso-despacho] despacho ' + pedido.key.slice(0, 8) + ' reserva no borrada');
      }
      quitarHuella(entorno, huella);
      return errorDeEnvio(err);
    }
    try {
      entorno.claves.setProperty(nombre, ENVIADO + ahora);
    } catch (errRegistro) {
      // El correo ya salió y la reserva sigue: el reintento no vuelve a enviar. Se responde ok.
      entorno.registrar('[aviso-despacho] despacho ' + pedido.key.slice(0, 8) + ' clave quedó pendiente');
    }
    return { status: 'ok' };
  });
}

/** Corre `trabajo` dentro del candado del script y lo suelta siempre. */
function conCandado(entorno, trabajo) {
  var candado = entorno.candado();
  if (!candado.tryLock(ESPERA_CANDADO_MS)) return rechazo('ocupado');
  try {
    return trabajo();
  } finally {
    try {
      candado.releaseLock();
    } catch (errCandado) {
      // Google suelta el candado al terminar la ejecución.
    }
  }
}

// ---------- Huella del cuerpo (reenvío del mismo cuerpo firmado) ----------
// CacheService puede perder una entrada antes de tiempo: en el despacho, la clave de las
// propiedades sigue evitando el doble envío. Si CacheService falla, el aviso no se detiene.

/** SHA-256 en hex de la firma: identifica el cuerpo sin guardar la firma. */
function huellaDeFirma(sig) {
  return aHex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, sig, Utilities.Charset.UTF_8));
}

/** Segundos que el ts sigue dentro de los 5 minutos, más el margen (normalmente unos 6 minutos). */
function segundosDeHuella(ts, ahora) {
  return Math.ceil((ts * 1000 + MAX_DIFERENCIA_MS - ahora) / 1000) + MARGEN_HUELLA_S;
}

function huellaRepetida(entorno, huella) {
  try {
    return entorno.cache().get(huella.nombre) !== null;
  } catch (err) {
    entorno.registrar('[aviso-despacho] huella no leída');
    return false;
  }
}

function guardarHuella(entorno, huella) {
  try {
    entorno.cache().put(huella.nombre, '1', huella.segundos);
  } catch (err) {
    entorno.registrar('[aviso-despacho] huella no guardada');
  }
}

function quitarHuella(entorno, huella) {
  try {
    entorno.cache().remove(huella.nombre);
  } catch (err) {
    entorno.registrar('[aviso-despacho] huella no borrada');
  }
}

/** Borra las claves de más de 400 días, pendientes o enviadas. No toca la configuración. */
function limpiarClaves(claves, ahora) {
  var limite = ahora - DIAS_CLAVE * 24 * 60 * 60 * 1000;
  var todas = claves.getProperties();
  Object.keys(todas).forEach(function (nombre) {
    if (nombre.indexOf(PREFIJO_CLAVE) !== 0) return;
    var valor = String(todas[nombre]);
    var marca = valor.indexOf(PENDIENTE) === 0 ? PENDIENTE : valor.indexOf(ENVIADO) === 0 ? ENVIADO : '';
    var cuando = Number(valor.slice(marca.length));
    if (marca && valor.length > marca.length && isFinite(cuando) && cuando < limite) claves.deleteProperty(nombre);
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
  var r;

  // 1. La firma del vector es la misma que calcula el servidor.
  verificar(firmar(PRUEBA.secreto, PRUEBA.ts, PRUEBA.payload) === PRUEBA.sig, 'la firma del vector no coincide con la del servidor');
  verificar(base().subject === 'Tu pedido va en camino — Factura N° 1234, Starken orden de flete ABC123456', 'el asunto del vector no se lee bien');

  // 2. Un envío que falla no deja la reserva ni la huella; el reintento sí sale; después, duplicate.
  e = entornoDePrueba({}, lineas);
  e.fallar = true;
  verificar(procesar(vector, e).reason === 'envio', 'una falla de Gmail no respondió rejected/envio');
  verificar(e.guardadas[clave] === undefined, 'una falla de envío dejó la reserva de la clave');
  verificar(Object.keys(e.huellas).length === 0, 'una falla de envío dejó la huella del cuerpo');
  verificar(e.tomados === 1 && e.liberados === 1, 'el candado no se soltó después de la falla');
  e.fallar = false;
  verificar(procesar(vector, e).status === 'ok', 'el reintento (el mismo cuerpo) después de la falla no salió');
  verificar(e.envios.length === 1 && e.envios[0].para === 'cliente.prueba@example.com', 'el despacho no fue al correo del pedido');
  verificar(e.envios[0].asunto === base().subject && e.envios[0].texto === base().text, 'el despacho cambió el asunto o el texto');
  verificar(e.envios[0].opciones.htmlBody === base().html && e.envios[0].opciones.name === e.config.senderName &&
    e.envios[0].opciones.replyTo === e.config.replyTo, 'faltan el HTML, el nombre o la respuesta');
  verificar(e.envios[0].opciones.attachments.length === 1 && !('bcc' in e.envios[0].opciones), 'adjuntos o copia oculta incorrectos');
  verificar(e.envios[0].guardadas[clave] === 'pendiente:' + PRUEBA.ts * 1000 && e.envios[0].huellas === 1,
    'la reserva de la clave o la huella no estaban guardadas antes de enviar');
  verificar(e.guardadas[clave] === 'enviado:' + PRUEBA.ts * 1000, 'la clave no quedó como enviada después del envío');
  r = procesar(sobre(base(), PRUEBA.ts + 1), e);
  verificar(r.status === 'duplicate' && r.reason === undefined && e.envios.length === 1, 'otro cuerpo con la misma clave volvió a enviar');
  verificar(e.tomados === 3 && e.liberados === 3, 'el candado no se soltó');

  // 3. Reserva durable de la clave antes de enviar.
  // 3a. Almacenamiento lleno: sin reserva no se envía.
  e = entornoDePrueba({}, lineas);
  e.fallarGuardar = '';
  r = procesar(vector, e);
  verificar(r.status === 'rejected' && r.reason === 'almacenamiento' && e.envios.length === 0, 'sin espacio para la reserva igual envió');
  verificar(e.guardadas[clave] === undefined && Object.keys(e.huellas).length === 0, 'sin reserva quedó la clave o la huella');
  e.fallarGuardar = null;
  verificar(procesar(vector, e).status === 'ok' && e.envios.length === 1, 'con espacio otra vez, el reintento no salió');
  // 3b. Falla el paso a «enviado»: ok, la reserva queda y el reintento no vuelve a enviar.
  e = entornoDePrueba({}, lineas);
  e.fallarGuardar = 'enviado:';
  verificar(procesar(vector, e).status === 'ok' && e.envios.length === 1, 'el correo salió, pero no respondió ok');
  verificar(e.guardadas[clave] === 'pendiente:' + PRUEBA.ts * 1000, 'la reserva no quedó cuando falló el paso a enviado');
  r = procesar(vector, e);
  verificar(r.status === 'duplicate' && r.reason === 'reenvio' && e.envios.length === 1, 'el mismo cuerpo volvió a enviar después del paso a enviado fallido');
  r = procesar(sobre(base(), PRUEBA.ts + 1), e);
  verificar(r.status === 'uncertain' && r.reason === 'pendiente' && e.envios.length === 1, 'el reintento con la reserva pendiente volvió a enviar');
  verificar(lineas.indexOf('[aviso-despacho] despacho c4ea6a81 clave quedó pendiente') !== -1, 'el paso a enviado fallido no quedó en el registro');
  // 3c. Reserva trabada (una ejecución anterior se cortó en el envío): uncertain, sin enviar ni tocarla.
  e = entornoDePrueba({}, lineas);
  e.guardadas[clave] = 'pendiente:' + (PRUEBA.ts * 1000 - 60000);
  r = procesar(vector, e);
  verificar(r.status === 'uncertain' && r.reason === 'pendiente' && e.envios.length === 0, 'una reserva trabada no respondió uncertain o envió');
  verificar(e.guardadas[clave] === 'pendiente:' + (PRUEBA.ts * 1000 - 60000) && Object.keys(e.huellas).length === 0,
    'la reserva trabada cambió o dejó huella');
  // 3d. Gmail falla y la reserva no se puede borrar: el reintento responde uncertain, nunca un segundo intento.
  e = entornoDePrueba({}, lineas);
  e.fallar = true;
  e.fallarBorrar = true;
  verificar(procesar(vector, e).reason === 'envio', 'con la reserva sin borrar no respondió rejected/envio');
  e.fallar = false;
  r = procesar(sobre(base(), PRUEBA.ts + 1), e);
  verificar(r.status === 'uncertain' && r.reason === 'pendiente' && e.envios.length === 0, 'con la reserva sin borrar el reintento envió');

  // 4. El mismo cuerpo firmado otra vez: duplicate/reenvio, sin enviar (vista previa y despacho).
  e = entornoDePrueba({}, lineas);
  p = base();
  p.action = 'preview';
  delete p.to;
  var cuerpoVista = sobre(p);
  var huellaVista = 'firma:' + huellaDeFirma(JSON.parse(cuerpoVista).sig);
  verificar(procesar(cuerpoVista, e).status === 'ok', 'la vista previa no salió');
  verificar(e.envios[0].huellas === 1 && e.huellas[huellaVista].segundos === 360,
    'la huella no se guardó antes de enviar o no dura unos 6 minutos');
  r = procesar(cuerpoVista, e);
  verificar(r.status === 'duplicate' && r.reason === 'reenvio' && e.envios.length === 1, 'el mismo cuerpo de vista previa salió dos veces');
  verificar(procesar(sobre(p, PRUEBA.ts + 1), e).status === 'ok' && e.envios.length === 2, 'una vista previa con un sobre nuevo no salió');
  e = entornoDePrueba({}, lineas);
  verificar(procesar(vector, e).status === 'ok', 'el despacho no salió');
  r = procesar(vector, e);
  verificar(r.status === 'duplicate' && r.reason === 'reenvio' && e.envios.length === 1, 'el mismo cuerpo de despacho salió dos veces');
  // La huella dura lo que le queda al ts dentro de los 5 minutos, más el margen.
  verificar(segundosDeHuella(PRUEBA.ts, PRUEBA.ts * 1000) === 360, 'la huella de un ts actual no dura 6 minutos');
  verificar(segundosDeHuella(PRUEBA.ts + 300, PRUEBA.ts * 1000) === 660, 'la huella de un ts adelantado no cubre su ventana');
  verificar(segundosDeHuella(PRUEBA.ts - 300, PRUEBA.ts * 1000) === 60, 'la huella de un ts atrasado no lleva el margen');
  // Con CacheService caído, el aviso sale igual y la clave sigue evitando el doble envío.
  e = entornoDePrueba({}, lineas);
  e.cacheRota = true;
  verificar(procesar(vector, e).status === 'ok' && e.envios.length === 1, 'con CacheService caído el despacho no salió');
  r = procesar(vector, e);
  verificar(r.status === 'duplicate' && r.reason === undefined && e.envios.length === 1, 'con CacheService caído el mismo cuerpo volvió a enviar');

  // 5. Vista previa: solo al dueño, sin copia oculta, con el prefijo una sola vez y sin registrar la clave.
  e = entornoDePrueba({ bcc: 'copia.prueba@example.com' }, lineas);
  p = base();
  p.action = 'preview';
  delete p.to;
  verificar(procesar(sobre(p), e).status === 'ok', 'la vista previa no salió');
  verificar(e.envios[0].para === e.config.ownerEmail, 'la vista previa no fue a OWNER_EMAIL');
  verificar(e.envios[0].asunto === '[Vista previa] ' + p.subject, 'la vista previa no lleva el prefijo');
  verificar(!('bcc' in e.envios[0].opciones) && !('cc' in e.envios[0].opciones), 'la vista previa llevó copia');
  verificar(Object.keys(e.guardadas).length === 0, 'la vista previa registró la clave');
  verificar(e.tomados === 1 && e.liberados === 1, 'la vista previa no tomó o no soltó el candado');
  p.to = 'cliente.prueba@example.com';
  p.subject = '[Vista previa] ' + p.subject;
  procesar(sobre(p), e);
  verificar(e.envios[1].para === e.config.ownerEmail, 'la vista previa con correo del cliente salió al cliente');
  verificar(e.envios[1].asunto === p.subject, 'el prefijo de la vista previa quedó dos veces');
  e = entornoDePrueba({}, lineas);
  e.ocupado = true;
  verificar(procesar(sobre(p), e).reason === 'ocupado' && e.envios.length === 0, 'la vista previa con el candado tomado igual salió');
  e = entornoDePrueba({}, lineas);
  e.fallar = true;
  verificar(procesar(sobre(p), e).reason === 'envio' && Object.keys(e.huellas).length === 0, 'una vista previa fallida dejó la huella');
  e.fallar = false;
  verificar(procesar(sobre(p), e).status === 'ok' && e.envios.length === 1, 'el reintento de la vista previa fallida no salió');

  // 6. Con BCC en las propiedades, el despacho lleva la copia oculta.
  e = entornoDePrueba({ bcc: 'copia.prueba@example.com' }, lineas);
  procesar(vector, e);
  verificar(e.envios[0].opciones.bcc === 'copia.prueba@example.com', 'el despacho no llevó el BCC configurado');

  // 7. Rechazos: nada sale.
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

  // 8. Cuota, candado ocupado, configuración y cuota agotada en Gmail.
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

  // 9. Limpieza: borra las claves de más de 400 días, enviadas o pendientes, y deja las demás y la configuración.
  e = entornoDePrueba({}, lineas);
  var dia = 24 * 60 * 60 * 1000;
  var vieja = 'aviso:' + 'a'.repeat(64);
  var viejaPendiente = 'aviso:' + 'c'.repeat(64);
  var reciente = 'aviso:' + 'b'.repeat(64);
  var recientePendiente = 'aviso:' + 'd'.repeat(64);
  e.guardadas[vieja] = 'enviado:' + (PRUEBA.ts * 1000 - 401 * dia);
  e.guardadas[viejaPendiente] = 'pendiente:' + (PRUEBA.ts * 1000 - 401 * dia);
  e.guardadas[reciente] = 'enviado:' + (PRUEBA.ts * 1000 - 399 * dia);
  e.guardadas[recientePendiente] = 'pendiente:' + (PRUEBA.ts * 1000 - 399 * dia);
  e.guardadas.SHARED_SECRET = 'no se toca';
  verificar(procesar(vector, e).status === 'ok', 'el despacho con claves guardadas no salió');
  verificar(e.guardadas[vieja] === undefined && e.guardadas[viejaPendiente] === undefined, 'no borró una clave de más de 400 días');
  verificar(e.guardadas[reciente] !== undefined && e.guardadas[recientePendiente] !== undefined &&
    e.guardadas.SHARED_SECRET === 'no se toca', 'borró una clave reciente o la configuración');
  // Una limpieza que falla (al leer o al borrar) no detiene el aviso.
  e = entornoDePrueba({}, lineas);
  e.fallarLeer = true;
  verificar(procesar(vector, e).status === 'ok' && e.envios.length === 1, 'una limpieza que no pudo leer detuvo el aviso');
  e = entornoDePrueba({}, lineas);
  e.guardadas[vieja] = 'enviado:' + (PRUEBA.ts * 1000 - 401 * dia);
  e.fallarBorrar = true;
  verificar(procesar(vector, e).status === 'ok' && e.envios.length === 1, 'una limpieza que no pudo borrar detuvo el aviso');
  verificar(e.guardadas[clave] === 'enviado:' + PRUEBA.ts * 1000, 'con la limpieza fallida la clave no quedó como enviada');
  verificar(lineas.indexOf('[aviso-despacho] limpieza de claves no terminó') !== -1, 'la limpieza fallida no quedó en el registro');

  // 10. Registros: sin destinatario, nombre, asunto, cuerpo, adjuntos, firma ni secreto.
  var registros = lineas.join('\n');
  ['cliente.prueba', 'dueno.prueba', 'copia.prueba', 'respuestas.prueba', 'Hola Prueba', 'Factura', 'camino',
    'JVBERi0', PRUEBA.secreto, PRUEBA.sig, huellaDeFirma(PRUEBA.sig), base().key].forEach(function (dato) {
    verificar(registros.indexOf(dato) === -1, 'un registro lleva datos del pedido');
  });
  verificar(registros.indexOf('[aviso-despacho] despacho c4ea6a81 ok') !== -1, 'falta la línea del despacho');
  verificar(registros.indexOf('[aviso-despacho] despacho c4ea6a81 duplicate reenvio') !== -1, 'falta la línea del reenvío');
  verificar(registros.indexOf('[aviso-despacho] despacho c4ea6a81 uncertain pendiente') !== -1, 'falta la línea de la reserva pendiente');

  // 11. La respuesta es JSON.
  verificar(responder({ status: 'ok' }).getContent() === '{"status":"ok"}', 'la respuesta no es JSON');

  console.log('testDoPost: ' + verificaciones + ' verificaciones OK (sin enviar correos ni tocar las propiedades)');
}

/**
 * Entorno simulado: propiedades y caché en memoria, Gmail que no envía, cuota y candado
 * controlables. Fallas: `fallar` (Gmail lanza; un texto es su mensaje), `fallarGuardar` (null o
 * un prefijo: setProperty lanza si el valor empieza con él; '' = almacenamiento lleno),
 * `fallarBorrar` (deleteProperty lanza), `fallarLeer` (getProperties lanza) y `cacheRota`.
 */
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
    huellas: {},
    envios: [],
    fallar: false,
    fallarGuardar: null,
    fallarBorrar: false,
    fallarLeer: false,
    cacheRota: false,
    cuotaRestante: 100,
    ocupado: false,
    tomados: 0,
    liberados: 0,
    ahora: function () { return PRUEBA.ts * 1000; },
    cuota: function () { return e.cuotaRestante; },
    enviar: function (para, asunto, texto, o) {
      if (e.fallar) throw new Error(typeof e.fallar === 'string' ? e.fallar : 'Fallo simulado de Gmail');
      // Lo que había guardado al momento de enviar: la reserva y la huella van antes.
      e.envios.push({ para: para, asunto: asunto, texto: texto, opciones: o, guardadas: JSON.parse(JSON.stringify(e.guardadas)),
        huellas: Object.keys(e.huellas).length });
    },
    cache: function () {
      if (e.cacheRota) throw new Error('CacheService simulado caído');
      return {
        get: function (nombre) {
          return Object.prototype.hasOwnProperty.call(e.huellas, nombre) ? e.huellas[nombre].valor : null;
        },
        put: function (nombre, valor, segundos) { e.huellas[nombre] = { valor: String(valor), segundos: segundos }; },
        remove: function (nombre) { delete e.huellas[nombre]; }
      };
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
    setProperty: function (nombre, valor) {
      if (e.fallarGuardar !== null && String(valor).indexOf(e.fallarGuardar) === 0) throw new Error('Almacenamiento simulado lleno');
      e.guardadas[nombre] = String(valor);
    },
    deleteProperty: function (nombre) {
      if (e.fallarBorrar) throw new Error('Fallo simulado al borrar');
      delete e.guardadas[nombre];
    },
    getProperties: function () {
      if (e.fallarLeer) throw new Error('Fallo simulado al leer');
      var copia = {};
      Object.keys(e.guardadas).forEach(function (nombre) { copia[nombre] = e.guardadas[nombre]; });
      return copia;
    }
  };
  return e;
}
