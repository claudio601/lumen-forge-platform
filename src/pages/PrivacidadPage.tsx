// /politica-de-privacidad: tratamiento de datos personales. Base: Ley 19.628 con las
// modificaciones de la Ley 21.719 (rigen desde el 2026-12-01), art. 14 ter. Defaults del
// dueño: solicitudes a ventas@elights.cl con el asunto "Datos personales"; sin delegado de
// protección de datos; encargados sin Axiom; 24 meses para solicitudes sin compra y 6 años
// para documentos tributarios; asistente de WhatsApp con IA activo, descrito como funciona hoy
// (versión 1.3); una persona revisa cada solicitud que queda registrada. Que el equipo responda
// por correo (nunca por WhatsApp ni por teléfono) es regla del dueño. La PR 13y (#85) ajustó
// MSG_HUMAN y MSG4_INSTALL a esa regla, y la PR 1 del bot (#88) hizo que «quedó registrada» y
// «ya derivé» salgan solo cuando Pipedrive confirma el negocio.
// Versión 1.4 (decisión del dueño, 2026-10-17): revisión de las conversaciones con el asistente
// para corregirlo (finalidad, §3, §4, §5, §7, §8 y §9), con el procedimiento y los plazos de
// ~/proyectos/elights-bot-2026-10/marcha-blanca/protocolo-marcha-blanca.md (fuera del repo):
// la exportación de Twilio no se guarda cruda; la copia seudonimizada se borra a los 60 días y la
// tabla de claves, cifrada, a los 14; la lee Claude solo con una cuenta comercial de Anthropic.
// El aviso del bot (privacyNotice.ts) informa la finalidad nueva. TWILIO_RETENTION_DAYS es el
// plazo configurado en la consola de Twilio (400, confirmado por el dueño); su respaldo sigue
// encendido (decisión del dueño, 2026-10-18) y §7 lo informa.
// Versión 1.5 (PR 14, decisiones del dueño del 2026-10-22): «Publicidad en Meta», con el píxel de
// Meta que carga el contenedor de Google Tag Manager solo con ese consentimiento y junto con la
// medición de visitas (§3, §5, §7 y §10); Meta recibe a lo más PageView, Lead y Contact, con un
// solo parámetro, content_name, de una lista cerrada de 8 valores (tipo de solicitud o medio de
// contacto), sin coincidencia avanzada ni datos de clientes; sin públicos ni remarketing; Google
// Analytics conserva los datos 14 meses (verificado en GA4 el 2026-10-22). El píxel envía la
// dirección completa de la página y el sitio anterior (src/lib/analytics.ts quita de la URL los
// ids de clic sin su consentimiento); el fbclid viene de cualquier enlace de Facebook o Instagram;
// Contact sale con el clic en WhatsApp, correo o teléfono. Google Ads (_gcl_ls) y el píxel de
// Meta también guardan datos en el almacenamiento local del navegador, y se borran al retirar el
// permiso. Agregar un evento o un parámetro hacia Meta, o crear públicos, exige otra versión de
// esta política.
// Versión 1.6 (especificación «Adjuntar archivos» del 2026-10-22, aprobada por el dueño con las
// decisiones D1 a D3): el cotizador recibe archivos (bases de licitación, fichas técnicas,
// planos o planillas). Pasan por un almacén privado y temporal de Vercel Blob y quedan en la
// pestaña Archivos del negocio en Pipedrive (§2, §5 y §7). Upstash (§5) guarda además, por 48
// horas, la ruta de cada archivo en Blob con el número de su negocio en Pipedrive (reserva y
// reintento del traspaso, api/_lib/attachments/quota.ts); los topes de subida cuentan archivos
// y bytes, sin datos personales. §9 no cambia.
// Versión 1.7 (especificación «Recordar mis datos en este dispositivo» del 2026-10-23, aprobada
// por el dueño con sus 4 decisiones): una casilla opcional en los cinco formularios guarda en el
// almacenamiento local del navegador los datos de contacto que se enviaron, para completar los
// formularios al volver (§2, §3, §7 y §10). Se guarda el RUT solo si es válido (decisión 1), dura
// 12 meses desde el último envío con la casilla marcada (decisión 2), la casilla aparece marcada
// si ya hay datos y se desmarca sola si cambia el correo (decisión 3), y el botón «Borrar mis
// datos guardados» va en §10, junto a «Configurar cookies» (decisión 4). No son cookies ni pasan
// por el aviso: los textos de las casillas y COOKIE_CONSENT_VERSION no cambian.
// Versión 1.8 (correcciones del dueño, 2026-10-25): el link de pago es de Flow, no de Jumpseller,
// y ya no se usa Mercado Pago (§2, §5 y §7). Los medios de §5 son los activos en la cuenta Flow (los
// mismos de MediosPagoPage.tsx). Jumpseller queda como catálogo y como registro de las
// solicitudes de su tienda, que llegan por su webhook (api/_lib/jumpseller/eventPolicy.ts), y
// Upstash relaciona cada una con su negocio en Pipedrive (api/_lib/idempotency/redis.ts).
// Versión 1.9 (dueño, 2026-10-25): §5 nombra la lista completa de transportistas con que
// despachamos (REGION_CARRIERS, la misma de /despacho), que pasó de 3 a 10 nombres.
// El texto describe lo que hace el código; si cambia uno, cambia el otro:
// - Asistente de WhatsApp (§2, §4 y §7; api/whatsapp/webhook.ts y api/_lib/whatsapp/): las
//   respuestas son mensajes predefinidos (flowEngine.ts), y buildRepregunta1 repite datos que
//   devolvió la IA; la IA (claudeAgent.ts) recibe los mensajes recientes y el nombre del perfil,
//   solo extrae los datos y escribe el resumen; si piden una persona, no siempre pide el
//   correo: no deriva si el mensaje trae intención comercial («necesito», COMMERCIAL_INTENT_RE)
//   y, si nombran a Claudio o Constanza, da sus correos (MSG_EXECUTIVE); sin correo no crea el
//   negocio en Pipedrive (hasMinCommercial); prioridad «Alta» si pidió una persona
//   (pipedriveLead.ts); historial, estado y registro del aviso solo en memoria; aviso breve en
//   la primera respuesta (privacyNotice.ts); adjuntos: NumMedia (webhook.ts). Twilio y Anthropic
//   conservan los mensajes según las condiciones de servicio que aceptamos al contratarlos (el
//   plazo, pendiente: consola de Twilio y pregunta Q6). El bot no reconoce retractos, garantías
//   ni reclamos: por eso Términos §16 y Cambios los piden por correo.
// - Casillas de los cinco formularios (useConsentFields, src/components/legal/ConsentFields.tsx):
//   la de privacidad, obligatoria (con los términos en /solicitar-pedido), y la de novedades
//   por correo, opcional y sin marcar.
// - Constancia de las casillas, la versión y la hora del servidor en la nota de Pipedrive y
//   en el correo a ventas@ (api/_lib/forms/consent.ts).
// - Origen de la visita (src/lib/attribution.ts): solo para saber de dónde vienen las
//   solicitudes, nunca se sube a Google Ads ni a Meta; oposición con su interruptor.
// - Aviso de cookies básico (src/lib/cookieConsent.ts y CookieConsent.tsx) con 5 categorías:
//   necesarias, origen de la visita, medición de visitas, medición de anuncios de Google y
//   Publicidad en Meta (las dos últimas requieren la de visitas). Duraciones: decisión 12 meses,
//   _ga 13 meses (cookie_expires de la etiqueta de Google en el contenedor), _gcl_ y _gcl_ls 90
//   días, _fbp y _fbc 90 días. src/lib/analytics.ts carga el contenedor (VITE_GTM_ID) solo en
//   elights.cl y www, y al retirar un permiso borra las cookies y el almacenamiento local de
//   Google y de Meta y recarga la página.
// - Transportistas (§5): los mismos de /despacho, desde REGION_CARRIERS (src/config/business.ts).
// - Archivos del cotizador (§2, §5 y §7; src/components/forms/FileAttachments.tsx y
//   api/_lib/attachments/): se suben a Vercel Blob (privado) solo al enviar, pasan al negocio en
//   Pipedrive y se borran de Blob; si uno no llega, se borra igual (D3) y el barrido diario
//   (api/cron/blob-sweep.ts) borra lo que tenga más de 24 h: nada queda más de unas 48 h.
// - Recordar mis datos (§2, §3, §7 y §10; src/lib/savedContact.ts y
//   src/components/forms/RememberContact.tsx): localStorage 'elights_contact', solo con la casilla
//   marcada y un envío confirmado; nombre, correo, teléfono, tipo de cliente, la empresa (razón
//   social, giro, dirección y RUT válido), comuna y región, y la fecha del último envío. Nunca
//   comentarios, archivos ni datos del proyecto. Vence a los 12 meses y AppLayout borra lo vencido
//   al abrir cualquier página. Desmarcar o «Borrar mis datos guardados»
//   (DeleteSavedContactButton) lo borran. Retirar un permiso de cookies no lo toca.
// - Búsquedas medidas (§10; src/lib/searchTracking.ts, claimSearch): sessionStorage
//   'elights_search_tracked', hasta 50 marcas «clave de la entrada del historial + resumen (hash)
//   de la consulta», sin el texto; se escribe con o sin consentimiento y queda solo en el navegador.
// - Archivo de versiones: public/legal/<página>-v<X.Y>.html (npm run legal:archive).
// Al cambiar este texto, sube LEGAL_VERSION (api/_lib/forms/consent.ts) y corre
// npm run legal:archive.

import { Link } from 'react-router-dom';
import LegalLayout from '@/components/legal/LegalLayout';
import { EmailLink } from '@/components/legal/CompanyFacts';
import CookieSettingsButton from '@/components/legal/CookieSettingsButton';
import DeleteSavedContactButton, { SavedContactClearedNotice } from '@/components/legal/DeleteSavedContactButton';
import { LEGAL_COMUNA, LEGAL_NAME, LEGAL_REPRESENTATIVE, LEGAL_RUT } from '@/config/site';
import { REGION_CARRIERS } from '@/config/business';

const DATA_SUBJECT = 'Datos personales';

/**
 * Días que Twilio guarda los mensajes (Messaging → Settings → General de su consola): 400, confirmado
 * por el dueño el 2026-10-18. El respaldo de Twilio (Backup Storage) queda encendido por decisión
 * del dueño, para revisar y mejorar el asistente; §7 lo informa.
 */
const TWILIO_RETENTION_DAYS = 400;

const PURPOSES: [string, string][] = [
  ['Responder tu solicitud, confirmar disponibilidad, cotizar y mandarte el link de pago', 'Medidas previas a un contrato, a tu pedido'],
  ['Cumplir tu compra: pago, despacho, retracto y garantías', 'Ejecución del contrato'],
  ['Emitir boletas y facturas y cumplir obligaciones tributarias y contables', 'Obligación legal'],
  [
    'Ordenar y priorizar el seguimiento de las solicitudes (ver punto 4)',
    'Interés legítimo de eLIGHTS en atender primero lo más urgente; puedes oponerte',
  ],
  [
    'Revisar las conversaciones con el asistente de WhatsApp para corregir sus errores y mejorarlo (ver punto 4)',
    'Interés legítimo de eLIGHTS en que el asistente entienda bien las solicitudes y las registre completas; puedes oponerte',
  ],
  [
    'Saber qué canales y campañas generan solicitudes (origen de la visita)',
    'Interés legítimo de eLIGHTS en evaluar su publicidad; puedes oponerte desde «Configurar cookies», al pie de cada página, o escribiéndonos',
  ],
  ['Proteger el sitio y prevenir abusos y fraudes', 'Interés legítimo'],
  [
    'Enviarte novedades y ofertas por correo, solo si marcas la casilla opcional de un formulario',
    'Tu consentimiento, que puedes retirar cuando quieras',
  ],
  [
    'Recordar tus datos en tu navegador para completar los formularios, solo si marcas esa casilla',
    'Tu consentimiento, que retiras desmarcando la casilla',
  ],
  ['Medir visitas con Google Analytics (solo en elights.cl)', 'Tu consentimiento, dado en el aviso de cookies'],
  [
    'Que Google Ads registre, con sus propias cookies, si una visita desde nuestros anuncios terminó en una solicitud o en un contacto con nosotros, como un clic para escribirnos por WhatsApp (solo en elights.cl)',
    'Tu consentimiento, dado en el aviso de cookies',
  ],
  [
    'Que Meta registre, con su píxel y sus cookies, las páginas que visitas y si nos enviaste una solicitud (y de qué tipo) o hiciste clic para contactarnos (y por qué medio), para medir nuestros anuncios en Facebook e Instagram (solo en elights.cl)',
    'Tu consentimiento, dado en el aviso de cookies',
  ],
  [
    'Guardar la constancia de tus autorizaciones y decisiones para poder demostrarlas',
    'Obligación legal de acreditar que tratamos tus datos de forma lícita',
  ],
];

const PrivacidadPage = () => (
  <LegalLayout
    path="/politica-de-privacidad"
    description="Qué datos personales trata eLIGHTS.CL SpA, para qué, con quién los comparte, cuánto tiempo los guarda y cómo ejercer tus derechos (Leyes 19.628 y 21.719)."
    updated
  >
    <p>
      Esta política explica qué datos personales tratamos cuando usas este sitio, nos envías una solicitud, nos escribes por
      correo o WhatsApp, o nos compras; para qué los usamos, con quién los compartimos, cuánto tiempo los guardamos y cómo puedes
      ejercer tus derechos. Se basa en la Ley N° 19.628 sobre Protección de la Vida Privada, con las modificaciones de la Ley N°
      21.719, que rigen desde el 1 de diciembre de 2026.
    </p>

    <h2>1. Responsable de tus datos</h2>
    <ul>
      <li>
        <strong>Responsable:</strong> {LEGAL_NAME}, RUT {LEGAL_RUT}, con domicilio en {LEGAL_COMUNA}, Región Metropolitana, Chile.
      </li>
      {LEGAL_REPRESENTATIVE && (
        <li>
          <strong>Representante legal:</strong> {LEGAL_REPRESENTATIVE}
        </li>
      )}
      <li>
        <strong>Contacto para temas de datos personales:</strong> <EmailLink subject={DATA_SUBJECT} />, con el asunto
        "{DATA_SUBJECT}".
      </li>
    </ul>
    <p>No hemos designado un delegado de protección de datos.</p>

    <h2>2. Qué datos tratamos y de quién</h2>
    <p>
      Tratamos datos de quienes nos piden información o cotizaciones, de nuestros clientes, de las personas de contacto de
      empresas e instituciones y de quienes visitan el sitio.
    </p>
    <ul>
      <li>
        <strong>Contacto:</strong> nombre, correo electrónico y teléfono.
      </li>
      <li>
        <strong>Empresa (si compras para una):</strong> razón social, RUT, giro y dirección comercial. Los datos de una empresa no
        son datos personales, pero sí lo son los de su persona de contacto.
      </li>
      <li>
        <strong>Tu solicitud:</strong> productos, cantidades, montos referenciales, comuna y región, comentarios y, en las
        solicitudes de proyecto, datos de la obra (tipo de proyecto, medidas, altura de montaje, normativa, plazos y ubicación) y
        los archivos que adjuntes, como bases de licitación, fichas técnicas, planos o planillas.
      </li>
      <li>
        <strong>Tu compra:</strong> dirección de despacho, documento tributario y estado del pago. No recibimos los datos de tu
        tarjeta.
      </li>
      <li>
        <strong>Tus mensajes:</strong> lo que nos escribes o nos envías (por ejemplo, fotos o archivos) por correo, WhatsApp o
        desde el sitio.
      </li>
      <li>
        <strong>Origen de tu visita:</strong> la página por la que entraste al sitio, el sitio desde el que llegaste y los
        parámetros de campaña del enlace (por ejemplo utm_source, gclid o fbclid).
      </li>
      <li>
        <strong>Tus autorizaciones y decisiones:</strong> que leíste esta política y autorizaste usar tus datos para responder
        (y, en la solicitud de pedido, que aceptaste los términos), si quieres recibir novedades, la versión de los textos y la
        fecha y hora del envío. En tu navegador guardamos tu decisión sobre cookies y, si lo pides, tus datos de contacto (punto
        10).
      </li>
      <li>
        <strong>Datos técnicos:</strong> dirección IP, tipo de navegador y registros de funcionamiento y seguridad del sitio y del
        asistente de WhatsApp. Estos registros pueden incluir tu teléfono, nombre, empresa, correo, comuna o un extracto de tu
        mensaje (ver punto 9).
      </li>
    </ul>
    <p>
      No pedimos datos sensibles (salud, origen étnico, creencias, etc.). Por favor no los incluyas en tus comentarios ni en tus
      archivos.
    </p>
    <p>
      <strong>De dónde vienen:</strong> casi todos nos los das tú en los formularios, por correo o por WhatsApp. Si nos escribes
      por WhatsApp, también recibimos automáticamente tu número y el nombre de tu perfil de WhatsApp. Si pagas con el link de
      pago, Flow nos informa el estado de tu pago. Si haces tu solicitud en nuestra tienda de Jumpseller, sus datos vienen de
      esa plataforma. Los parámetros de campaña vienen del enlace con el que llegaste.
    </p>

    <h2>3. Para qué los usamos y con qué base legal</h2>
    <div className="overflow-x-auto">
      <table>
        <thead>
          <tr>
            <th scope="col">Finalidad</th>
            <th scope="col">Base legal</th>
          </tr>
        </thead>
        <tbody>
          {PURPOSES.map(([purpose, basis]) => (
            <tr key={purpose}>
              <td>{purpose}</td>
              <td>{basis}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    <p>
      Hasta el 30 de noviembre de 2026 rige la Ley N° 19.628 en su texto anterior. Durante ese período tratamos tus datos con las
      mismas finalidades, sobre la base de la autorización que nos das al enviarnos una solicitud (en el sitio, al marcar la
      casilla «Leí la Política de privacidad y autorizo…»; por correo o WhatsApp, con tu mensaje escrito) y de las obligaciones
      legales que nos aplican. Ordenar y priorizar tu solicitud es parte de responderla. Para saber de dónde vienen las
      solicitudes usamos el origen de tu visita solo internamente, con fines estadísticos, como permite esa ley. La medición con
      cookies (Google Analytics, medición de anuncios de Google y Publicidad en Meta) se basa, también en ese período, en la
      autorización que das en el aviso de cookies. Recordar tus datos en tu navegador se basa en la autorización que das al
      marcar esa casilla. En ese período, la
      revisión de las conversaciones con el asistente de WhatsApp (punto 4) se basa en la autorización que nos das al escribirle;
      el asistente te informa esa finalidad en su aviso de privacidad, al final de su primera respuesta. Desde el 1 de
      diciembre de 2026 rigen las bases de la tabla: responder tu solicitud se basa en las medidas previas a un contrato que nos
      pides, y la casilla queda como constancia de que leíste esta política.
    </p>
    <p>
      No usamos tus datos para fines distintos de los de esta tabla sin avisarte antes y, cuando corresponda, pedir tu
      consentimiento.
    </p>
    <p>
      Los parámetros de campaña (como gclid o fbclid) que van con tu solicitud los usamos solo para saber de dónde vienen nuestras
      solicitudes: no los subimos a Google Ads ni a Meta. Si en elights.cl aceptas la medición de anuncios de Google en el aviso
      de cookies, es Google quien registra, con sus propias cookies, si tu visita desde un anuncio terminó en una solicitud o en
      un contacto con nosotros (por ejemplo, un clic para escribirnos por WhatsApp). Si en elights.cl aceptas «Publicidad en
      Meta», es Meta quien registra con su píxel y sus cookies (como _fbp y _fbc) las páginas que visitas (con su dirección
      completa y el sitio desde el que llegaste), el identificador del clic (fbclid) si llegaste desde un enlace de Facebook o
      Instagram, y si nos enviaste una solicitud (y de qué tipo) o hiciste clic para contactarnos (y por qué medio). Para medir
      visitas y anuncios no enviamos a Google ni a Meta tu nombre, correo ni teléfono.
    </p>

    <h2>4. Priorización de solicitudes y respuestas automáticas</h2>
    <p>
      <strong>Priorización.</strong> Cuando envías una solicitud desde el sitio, un programa le asigna un puntaje con reglas
      fijas: si compras como empresa o como persona, el monto referencial, la cantidad de productos y si indicaste empresa y
      teléfono. En las solicitudes de instalación considera el tipo de proyecto, el tipo de cliente y qué tan completa viene la
      solicitud. El resultado solo ordena el seguimiento ("Alta" o "Normal"). En WhatsApp no hay puntaje: tu solicitud queda en
      "Alta" si el asistente detecta que pides hablar con una persona y en "Normal" si no, y se clasifica como de empresa o de
      persona con reglas fijas, según lo que escribes. Nada de esto decide si te vendemos, a qué precio ni en qué condiciones, y
      una persona de nuestro equipo revisa y responde cada solicitud que queda registrada en nuestro sistema de seguimiento.
      Puedes pedirnos que te expliquemos el resultado u oponerte a este tratamiento.
    </p>
    <p>
      <strong>Asistente de WhatsApp.</strong> En nuestro WhatsApp te atiende un asistente automático. Sus respuestas son mensajes
      predefinidos, que pueden repetir datos que reconoció en tus mensajes (como el proyecto o el tipo de luz); no las redacta una
      inteligencia artificial. El asistente envía tus mensajes recientes y el nombre de tu perfil a una inteligencia artificial
      (Claude, de Anthropic), que reconoce en ellos los datos de tu solicitud (producto, tipo de luz, cantidad, proyecto o uso,
      comuna o ciudad, nombre, empresa y correo), detecta si pides hablar con una persona y escribe un resumen para nuestro equipo.
      Si pides hablar con una persona, una persona de nuestro equipo te responde por correo, así que necesitamos tu correo. El
      asistente no siempre te lo pide; por ejemplo, si nombras a uno de nuestros ejecutivos, te da su correo para que le escribas.
      Sin tu correo, tu solicitud no queda registrada en nuestro sistema de seguimiento y no llega a nuestro equipo; en ese caso,
      escríbenos a <EmailLink />. En su primera respuesta, el asistente te muestra un aviso breve con el enlace a esta política.
    </p>
    <p>
      <strong>Revisión del asistente.</strong> Algunas semanas, como la primera de cada mes, guardamos una copia de las
      conversaciones con el asistente para encontrar sus errores (por ejemplo, un dato mal reconocido, una pregunta que faltó o una
      solicitud que no quedó registrada) y corregirlos. El mismo día cambiamos tu teléfono por un código y quitamos los datos de
      contacto que reconocemos (correo, RUT, teléfonos y direcciones), y también tu nombre y tu empresa cuando los reconocemos. Esa
      copia la revisa nuestro equipo con ayuda de Claude, la inteligencia artificial de Anthropic. La revisión no decide nada sobre
      ti ni se usa para enviarte publicidad, y para probar el asistente usamos mensajes inventados, nunca los tuyos. Puedes
      oponerte escribiéndonos a <EmailLink subject={DATA_SUBJECT} /> con el asunto «{DATA_SUBJECT}».
    </p>

    <h2>5. Con quién compartimos tus datos</h2>
    <p>
      No vendemos tus datos ni los entregamos a terceros para que hagan su propia publicidad, salvo lo que registra el píxel de
      Meta si aceptas «Publicidad en Meta» (ver más abajo). Los compartimos solo con:
    </p>
    <p>
      <strong>Proveedores que los tratan por encargo nuestro (encargados):</strong>
    </p>
    <ul>
      <li>
        <strong>Vercel Inc.</strong> (Estados Unidos): alojamiento del sitio y de los formularios, y almacenamiento temporal de
        los archivos que adjuntas.
      </li>
      <li>
        <strong>Pipedrive</strong> (Unión Europea / Estados Unidos): sistema donde registramos y damos seguimiento a solicitudes y
        clientes, incluidos los archivos que adjuntas.
      </li>
      <li>
        <strong>Google</strong> (Estados Unidos): correo electrónico y envío de los avisos de solicitudes a nuestro equipo (Gmail y
        Google Apps Script) y, solo en elights.cl y si lo aceptas en el aviso de cookies, Google Analytics, bajo los términos de
        tratamiento de datos de Google.
      </li>
      <li>
        <strong>Twilio Inc.</strong> (Estados Unidos): conexión de nuestro número de WhatsApp.
      </li>
      <li>
        <strong>Anthropic PBC</strong> (Estados Unidos): inteligencia artificial del asistente de WhatsApp y de la revisión de sus
        conversaciones (punto 4).
      </li>
      <li>
        <strong>Upstash Inc.:</strong> registro técnico temporal que relaciona cada solicitud hecha en nuestra tienda de Jumpseller
        con su ficha en nuestro sistema de seguimiento y, por 48 horas, cada archivo que adjuntas en el sitio con tu solicitud.
      </li>
      <li>
        <strong>Jumpseller:</strong> plataforma de ventas: catálogo, precios e imágenes de productos, y registro de las solicitudes
        hechas en nuestra tienda de Jumpseller.
      </li>
    </ul>
    <p>
      <strong>Otros destinatarios, que tratan los datos bajo su propia responsabilidad:</strong>
    </p>
    <ul>
      <li>
        <strong>Medios de pago:</strong> Flow (flow.cl), la plataforma con la que cobramos, y el medio que elijas al pagar
        (Transbank para Webpay y Onepay, MACH, Servipag o Banca.me): reciben los datos de tu pago y los que ingresas al pagar.
      </li>
      <li>
        <strong>Transportistas</strong> ({REGION_CARRIERS}, incluido el que elijas): reciben tu nombre, dirección y teléfono para
        hacer la entrega.
      </li>
      <li>
        <strong>WhatsApp (Meta):</strong> si nos escribes por WhatsApp, ese servicio trata tus mensajes según su propia política.
      </li>
      <li>
        <strong>Google (medición de anuncios):</strong> solo en elights.cl y si lo aceptas en el aviso de cookies, Google recibe con
        sus cookies si tu visita desde uno de nuestros anuncios terminó en una solicitud o en un contacto con nosotros (por
        ejemplo, un clic para escribirnos por WhatsApp), y lo trata también según su propia política. Desde nuestros formularios
        no le enviamos tus datos de contacto.
      </li>
      <li>
        <strong>Meta (Publicidad en Meta):</strong> solo en elights.cl y si lo aceptas en el aviso de cookies, Meta recibe con su
        píxel las páginas que visitas, con su dirección completa y el sitio desde el que llegaste, el identificador del clic si
        llegaste desde un enlace de Facebook o Instagram, y si nos enviaste una solicitud (pedido, cotización, cotizador, estudio
        lumínico o instalación) o hiciste clic para contactarnos (por WhatsApp, correo o teléfono). Lo trata según su propia
        política y lo usa también para sus propios anuncios. No le enviamos tu nombre, correo ni teléfono.
      </li>
      <li>
        <strong>Autoridades, tribunales y asesores</strong> (por ejemplo, el Servicio de Impuestos Internos o nuestro contador),
        cuando la ley lo exige o para defender nuestros derechos.
      </li>
    </ul>

    <h2>6. Datos que salen de Chile</h2>
    <p>
      Varios de estos proveedores tratan los datos fuera de Chile, principalmente en Estados Unidos y la Unión Europea. Esas
      transferencias se rigen por las condiciones de servicio y de tratamiento de datos de cada proveedor. Si la Agencia de
      Protección de Datos Personales publica una lista de países con nivel adecuado o cláusulas tipo, actualizaremos esta
      sección.
    </p>

    <h2>7. Cuánto tiempo guardamos tus datos</h2>
    <ul>
      <li>
        <strong>Solicitudes que no terminan en compra:</strong> 24 meses desde el último contacto; después las eliminamos o
        anonimizamos.
      </li>
      <li>
        <strong>Clientes:</strong> mientras dure la relación comercial y los plazos de retracto y garantía.
      </li>
      <li>
        <strong>Boletas, facturas y respaldos contables:</strong> 6 años, por obligación tributaria.
      </li>
      <li>
        <strong>Novedades y ofertas:</strong> tu nombre, tu correo y la constancia de tu consentimiento, mientras no lo retires; si
        se elimina tu solicitud, pasan a nuestro registro de novedades. Si en una solicitud posterior no marcas la casilla, lo
        tomamos como retiro. Cuando lo retiras, guardamos solo tu correo y la constancia (versión y fechas) por 4 años, para
        respetar tu baja y poder demostrar que tuvimos tu consentimiento.
      </li>
      <li>
        <strong>Constancia de tus autorizaciones</strong> (casillas, versión y fecha): junto con tu solicitud y por el mismo plazo.
      </li>
      <li>
        <strong>Archivos que adjuntas en el sitio:</strong> pasan por un almacenamiento privado y temporal de Vercel (Estados
        Unidos) y se borran apenas quedan en nuestro sistema de seguimiento o, si el envío no se completa, a más tardar en 48
        horas. La copia en nuestro sistema de seguimiento sigue el plazo de tu solicitud.
      </li>
      <li>
        <strong>Origen de tu visita:</strong> en tu navegador se borra al cerrar la pestaña; la copia que va con tu solicitud sigue
        el plazo de la solicitud.
      </li>
      <li>
        <strong>Tu decisión sobre cookies:</strong> 12 meses en tu navegador; después te volvemos a preguntar. Si te opusiste al
        registro del origen de tu visita, lo seguimos respetando en ese navegador.
      </li>
      <li>
        <strong>Datos que pides recordar en tu navegador:</strong> 12 meses desde tu último envío con la casilla marcada; después
        no los usamos y los borramos en tu próxima visita.
      </li>
      <li>
        <strong>Cookies de Google</strong> (si las aceptas): las de Google Analytics, hasta 13 meses; las de medición de anuncios
        y su copia en el almacenamiento local de tu navegador (_gcl_ls), hasta 90 días. Google Analytics conserva los datos de medición asociados a sus cookies hasta 14 meses desde tu última
        visita; después solo quedan informes agregados. Lo que registra Google Ads lo conserva Google según su propia política.
      </li>
      <li>
        <strong>Cookies de Meta</strong> (si las aceptas): las del píxel, como _fbp y _fbc, y lo que guarda en el almacenamiento
        local de tu navegador, hasta 90 días. Lo que registra Meta lo conserva según su propia política.
      </li>
      <li>
        <strong>Registro técnico de las solicitudes de nuestra tienda de Jumpseller (Upstash):</strong> 30 días.
      </li>
      <li>
        <strong>Asistente de WhatsApp:</strong> guarda solo en memoria temporal el historial reciente de la conversación, los datos
        que va reuniendo de tu solicitud y si ya te mostró el aviso de privacidad. Lo que registramos de la conversación en nuestro
        sistema de seguimiento sigue el plazo de las solicitudes.
      </li>
      <li>
        <strong>Copia de revisión del asistente</strong> (punto 4): no guardamos la exportación original; el mismo día la cambiamos
        por una copia con tu teléfono cambiado por un código y sin los datos de contacto que reconocemos, y esa copia la borramos a
        los 60 días. La tabla que une cada código con tu teléfono la guardamos cifrada y la borramos dentro de 14 días; después
        queda solo un código secreto derivado de tu teléfono, que sirve únicamente para encontrar tu caso si te opones, y lo
        borramos junto con la copia. Las cifras que salen de la revisión (por ejemplo, cuántas solicitudes quedaron completas) no
        te identifican y las guardamos sin plazo.
      </li>
      <li>
        <strong>Registros técnicos del sitio y del asistente de WhatsApp</strong> (pueden incluir tu teléfono, nombre, correo o un
        extracto de tu mensaje): los plazos breves que define cada proveedor.
      </li>
      <li>
        <strong>Twilio</strong> (asistente de WhatsApp): guarda los registros de los mensajes, con su texto,
        por {TWILIO_RETENTION_DAYS} días, el plazo que tenemos configurado en su servicio, y además un respaldo de esos registros, que
        conservamos para revisar y mejorar el asistente (punto 4) mientras sirva para ese fin.
      </li>
      <li>
        <strong>Anthropic</strong> (asistente de WhatsApp): conserva los registros de los mensajes que pasan por su servicio según
        las condiciones de servicio que aceptamos al contratarlo.
      </li>
    </ul>

    <h2>8. Tus derechos</h2>
    <p>Tienes derecho a:</p>
    <ul>
      <li>
        <strong>acceso:</strong> saber qué datos tuyos tenemos y cómo los usamos;
      </li>
      <li>
        <strong>rectificación:</strong> corregir datos inexactos o incompletos;
      </li>
      <li>
        <strong>supresión:</strong> pedir que eliminemos tus datos cuando ya no sean necesarios o no haya base para tratarlos;
      </li>
      <li>
        <strong>oposición:</strong> oponerte a un tratamiento, incluidos el envío de novedades, el registro del origen de tu visita
        (también desde «Configurar cookies»), la priorización automática y la revisión de tus conversaciones con el asistente;
      </li>
      <li>
        <strong>portabilidad:</strong> recibir tus datos en un formato de uso común;
      </li>
      <li>
        <strong>bloqueo:</strong> pedir que suspendamos temporalmente el uso de tus datos mientras resolvemos otra solicitud tuya;
      </li>
      <li>
        <strong>retirar tu consentimiento</strong> en cualquier momento, sin afectar lo hecho antes;
      </li>
      <li>
        <strong>no quedar sujeto a decisiones basadas solo en tratamiento automatizado</strong> que te afecten de forma
        significativa.
      </li>
    </ul>
    <p>
      <strong>Cómo ejercerlos.</strong> Escríbenos a <EmailLink subject={DATA_SUBJECT} /> con el asunto "{DATA_SUBJECT}",
      indicando qué derecho quieres ejercer. Si hace falta, te pediremos un dato para confirmar tu identidad. No tiene costo.
    </p>
    <p>
      <strong>Plazos y reclamos.</strong> Te confirmamos que recibimos tu solicitud y, si la rechazamos, te explicaremos por qué.
      El plazo para responderte y dónde puedes reclamar dependen de la fecha de tu solicitud:
    </p>
    <ul>
      <li>
        <strong>Hasta el 30 de noviembre de 2026</strong> (Ley N° 19.628 en su texto anterior): respondemos dentro de 2 días
        hábiles. Si no respondemos en ese plazo o rechazamos tu solicitud, puedes recurrir al juez de letras en lo civil (art. 16
        de la Ley N° 19.628) o, si eres consumidor, reclamar ante el Servicio Nacional del Consumidor (SERNAC).
      </li>
      <li>
        <strong>Desde el 1 de diciembre de 2026</strong> (con las modificaciones de la Ley N° 21.719): respondemos dentro de 30
        días corridos, prorrogables una vez por otros 30 si es necesario; te avisaremos si usamos la prórroga. Las solicitudes de
        bloqueo las resolvemos dentro de 2 días hábiles. Si no quedas conforme, puedes reclamar ante la Agencia de Protección de
        Datos Personales dentro de 30 días hábiles desde nuestra respuesta o desde que venció el plazo para responder.
      </li>
    </ul>

    <h2>9. Seguridad</h2>
    <p>
      Usamos conexiones cifradas (HTTPS), damos acceso a tus datos solo a las personas de nuestro equipo y a los proveedores que lo
      necesitan y guardamos las credenciales de los sistemas fuera del código del sitio. Los registros técnicos del sitio y del
      asistente de WhatsApp pueden incluir tu teléfono, nombre, empresa, correo, comuna o un extracto de tu mensaje; se guardan
      solo los plazos breves que define cada proveedor, salvo la copia de revisión del asistente, que tiene sus propios plazos
      (punto 7). Si ocurre una vulneración de seguridad que pueda afectar tus datos, la informaremos a la Agencia
      de Protección de Datos Personales y, cuando corresponda, a ti.
    </p>

    <h2>10. Cookies y almacenamiento en tu navegador</h2>
    <ul>
      <li>
        <strong>Sin tu consentimiento, este sitio no instala cookies en tu navegador.</strong>
      </li>
      <li>
        Usa el <strong>almacenamiento de sesión</strong> de tu navegador, que se borra al cerrar la pestaña, para recordar tu lista
        de cotización, tu lista de pedido y si ves los precios con o sin IVA. Es necesario para que el sitio funcione como pides.
        También anota qué búsquedas ya contamos en esa pestaña (un resumen, sin el texto que escribiste), para no contar dos veces
        la misma; esa anotación queda solo en tu navegador.
      </li>
      <li>
        También anota ahí el <strong>origen de tu visita</strong> (punto 2). No es una cookie y solo sale de tu navegador cuando
        envías un formulario; esa copia no la enviamos a Google ni a Meta. Rechazar las cookies no lo desactiva. Si te opones con
        el interruptor «Origen de la visita» en «Configurar cookies», lo borramos de este navegador y no lo volvemos a anotar aquí;
        para que dejemos de usar el que ya enviaste con una solicitud, escríbenos a <EmailLink subject={DATA_SUBJECT} /> con el
        asunto "{DATA_SUBJECT}".
      </li>
      <li>
        Tu <strong>decisión sobre cookies</strong> se guarda 12 meses en el almacenamiento local de tu navegador. No es una cookie y
        no la guardamos en nuestros sistemas; si aceptas Google Analytics, cada medición le informa a Google qué permitiste.
      </li>
      <li>
        Si marcas <strong>«Recordar mis datos en este dispositivo»</strong>, guardamos en el almacenamiento local de tu navegador
        tu nombre, correo, teléfono, comuna y región, si compras como persona o empresa, los datos de tu empresa (razón social,
        RUT, giro y dirección) y la fecha de tu último envío, para completar los formularios cuando vuelvas. No son cookies, no
        dependen del aviso de cookies y no los guardamos en nuestros sistemas: salen de tu navegador solo cuando envías un
        formulario. Nunca guardamos ahí tus comentarios, tus archivos ni los datos de tu proyecto. Puedes borrarlos desmarcando
        la casilla en cualquier formulario o con el botón «
        <DeleteSavedContactButton className="font-medium text-primary underline hover:no-underline" />». No la marques en un
        computador compartido.
        <SavedContactClearedNotice />
      </li>
      <li>
        <strong>Imágenes de productos:</strong> se cargan desde los servidores de Jumpseller, que reciben datos técnicos de tu
        conexión, como tu dirección IP.
      </li>
      <li>
        <strong>Google Analytics</strong> (solo en elights.cl): se carga solo si aceptas la medición de visitas en el aviso de
        cookies; antes de que decidas no se carga nada de Google ni de Meta. Instala las cookies _ga y _ga_… por hasta 13 meses
        para contar visitas y saber qué páginas y botones se usan (por ejemplo, agregar productos a la lista, enviar un formulario
        o abrir WhatsApp). Google registra por su cuenta la página por la que entraste, el sitio anterior y los parámetros de
        campaña, sin tus datos de contacto.
      </li>
      <li>
        <strong>Medición de anuncios de Google</strong> (solo en elights.cl): solo si la aceptas, y requiere la medición de
        visitas. Usa cookies de Google (_gcl_…, hasta 90 días) y su copia en el almacenamiento local de tu navegador (_gcl_ls)
        para saber si una visita desde nuestros anuncios terminó en una solicitud o en un contacto con nosotros (por ejemplo, un clic para escribirnos por WhatsApp). No activa anuncios
        personalizados de Google.
      </li>
      <li>
        <strong>Publicidad en Meta</strong> (solo en elights.cl): solo si la aceptas, y requiere la medición de visitas. Carga el
        píxel de Meta, que guarda en tu navegador cookies, como _fbp y _fbc, y datos en el almacenamiento local por hasta 90 días,
        y le envía a Meta las páginas que visitas, con su dirección completa y el sitio desde el que llegaste, el identificador del
        clic (fbclid) si llegaste desde un enlace de Facebook o Instagram, y si nos enviaste una solicitud y de qué tipo (pedido,
        cotización, cotizador, estudio lumínico o instalación) o hiciste clic para contactarnos y por qué medio (WhatsApp, correo
        o teléfono). Como todo servicio que se carga en tu navegador, Meta recibe también datos técnicos de tu conexión, como tu
        dirección IP. No le enviamos tu nombre ni tus datos de contacto. Meta también usa estos datos para sus propios anuncios,
        según su política.
      </li>
      <li>
        No creamos públicos con tus visitas ni hacemos remarketing, ni en Google ni en Meta. Si lo hacemos, te pediremos tu
        consentimiento de nuevo y actualizaremos esta política.
      </li>
      <li>
        Puedes cambiar tu decisión cuando quieras con el botón{' '}
        <CookieSettingsButton className="font-medium text-primary underline hover:no-underline" />, aquí o al pie de cada página. Si
        retiras un permiso, la página se vuelve a cargar: dejamos de medir en esa misma página y borramos de tu navegador lo que
        Google y Meta guardaron en este sitio con ese permiso (cookies y almacenamiento local).
      </li>
      <li>Los enlaces a WhatsApp abren ese servicio, que se rige por su propia política.</li>
    </ul>

    <h2>11. Menores de edad</h2>
    <p>Este sitio está dirigido a empresas y a personas mayores de edad. No recolectamos a sabiendas datos de menores.</p>

    <h2>12. Cambios a esta política</h2>
    <p>
      Si cambiamos esta política, publicaremos aquí la nueva versión con su fecha. Si el cambio afecta algo que depende de tu
      consentimiento, te lo pediremos de nuevo. Si cambian las finalidades del aviso de cookies, te lo volveremos a mostrar.
    </p>
    <p>
      Puedes guardar o imprimir cada versión desde el enlace al comienzo de esta página, donde también están las anteriores; o
      pedirlas a <EmailLink />.
    </p>
    <p>
      La compra y sus condiciones están en <Link to="/terminos-y-condiciones">Términos y condiciones</Link>.
    </p>
  </LegalLayout>
);

export default PrivacidadPage;
