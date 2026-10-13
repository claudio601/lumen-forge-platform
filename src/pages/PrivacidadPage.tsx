// /politica-de-privacidad: tratamiento de datos personales (PR 12). Base: Ley 19.628 con las
// modificaciones de la Ley 21.719 (rigen desde el 2026-12-01), art. 14 ter. Defaults del
// dueño: solicitudes a ventas@elights.cl con el asunto "Datos personales"; sin delegado de
// protección de datos; encargados sin Axiom; 24 meses para solicitudes sin compra y 6 años
// para documentos tributarios; asistente de WhatsApp con IA activo y con paso a una persona;
// una persona revisa cada solicitud; novedades solo con consentimiento (casilla de la
// PR 13); el origen de la visita (PR 10) solo para atribución interna, nunca se sube a
// Google Ads ni a Meta. La sección 10 (cookies) se revisa con el aviso de cookies (PR 13).

import { Link } from 'react-router-dom';
import LegalLayout from '@/components/legal/LegalLayout';
import { EmailLink } from '@/components/legal/CompanyFacts';
import { LEGAL_COMUNA, LEGAL_NAME, LEGAL_REPRESENTATIVE, LEGAL_RUT } from '@/config/site';

const DATA_SUBJECT = 'Datos personales';

const PURPOSES: [string, string][] = [
  ['Responder tu solicitud, confirmar disponibilidad, cotizar y mandarte el link de pago', 'Medidas previas a un contrato, a tu pedido'],
  ['Cumplir tu compra: pago, despacho, retracto y garantías', 'Ejecución del contrato'],
  ['Emitir boletas y facturas y cumplir obligaciones tributarias y contables', 'Obligación legal'],
  [
    'Ordenar y priorizar el seguimiento de las solicitudes (ver punto 4)',
    'Interés legítimo de eLIGHTS en atender primero lo más urgente; puedes oponerte',
  ],
  [
    'Saber qué canales y campañas generan solicitudes (origen de la visita)',
    'Interés legítimo de eLIGHTS en evaluar su publicidad; puedes oponerte',
  ],
  ['Proteger el sitio y prevenir abusos y fraudes', 'Interés legítimo'],
  ['Enviarte novedades y ofertas', 'Tu consentimiento, que puedes retirar cuando quieras'],
  ['Medir visitas con Google Analytics (solo en elights.cl)', 'Tu consentimiento, dado en el aviso de cookies'],
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
        solicitudes de proyecto, datos de la obra (tipo de proyecto, medidas, altura de montaje, normativa, plazos y ubicación).
      </li>
      <li>
        <strong>Tu compra:</strong> dirección de despacho, documento tributario y estado del pago. No recibimos los datos de tu
        tarjeta.
      </li>
      <li>
        <strong>Tus mensajes:</strong> lo que nos escribes por correo o WhatsApp.
      </li>
      <li>
        <strong>Origen de tu visita:</strong> la página por la que entraste al sitio, el sitio desde el que llegaste y los
        parámetros de campaña del enlace (por ejemplo utm_source, gclid o fbclid).
      </li>
      <li>
        <strong>Datos técnicos:</strong> dirección IP, tipo de navegador y registros de funcionamiento y seguridad del sitio y del
        asistente de WhatsApp. Estos registros pueden incluir tu teléfono, nombre, empresa, correo, comuna o un extracto de tu
        mensaje (ver punto 9).
      </li>
    </ul>
    <p>No pedimos datos sensibles (salud, origen étnico, creencias, etc.). Por favor no los incluyas en tus comentarios.</p>
    <p>
      <strong>De dónde vienen:</strong> casi todos nos los das tú en los formularios, por correo o por WhatsApp. Los datos de pago
      y despacho de tu compra vienen de la plataforma del link de pago (Jumpseller). Los parámetros de campaña vienen del enlace
      con el que llegaste.
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
      mismas finalidades, sobre la base de la autorización que nos das al enviarnos una solicitud y de las obligaciones legales que
      nos aplican.
    </p>
    <p>
      No usamos tus datos para fines distintos de los de esta tabla sin avisarte antes y, cuando corresponda, pedir tu
      consentimiento.
    </p>
    <p>
      Los parámetros de campaña (como gclid o fbclid) los usamos solo para saber de dónde vienen nuestras solicitudes: no los
      subimos a Google Ads ni a Meta.
    </p>

    <h2>4. Priorización de solicitudes y respuestas automáticas</h2>
    <p>
      <strong>Priorización.</strong> Cuando envías una solicitud, un programa le asigna un puntaje con reglas fijas: si compras
      como empresa o como persona, el monto referencial, la cantidad de productos y si indicaste empresa y teléfono. En las
      solicitudes de instalación considera el tipo de proyecto, el tipo de cliente y qué tan completa viene la solicitud. El
      resultado solo ordena el seguimiento ("Alta" o "Normal"). No decide si te vendemos, a qué precio ni en qué condiciones, y una
      persona de nuestro equipo revisa y responde cada solicitud. Puedes pedirnos que te expliquemos el resultado u oponerte a
      este tratamiento.
    </p>
    <p>
      <strong>Asistente de WhatsApp.</strong> Las primeras respuestas en nuestro WhatsApp pueden venir de un asistente automático
      que usa inteligencia artificial (Claude, de Anthropic) para entender tu consulta y responderla. En cualquier momento puedes
      pedir hablar con una persona.
    </p>

    <h2>5. Con quién compartimos tus datos</h2>
    <p>
      No vendemos tus datos ni los entregamos a terceros para que hagan su propia publicidad. Los compartimos solo con:
    </p>
    <p>
      <strong>Proveedores que los tratan por encargo nuestro (encargados):</strong>
    </p>
    <ul>
      <li>
        <strong>Vercel Inc.</strong> (Estados Unidos): alojamiento del sitio y de los formularios.
      </li>
      <li>
        <strong>Pipedrive</strong> (Unión Europea / Estados Unidos): sistema donde registramos y damos seguimiento a solicitudes y
        clientes.
      </li>
      <li>
        <strong>Google</strong> (Estados Unidos): correo electrónico y envío de los avisos de solicitudes a nuestro equipo (Gmail y
        Google Apps Script).
      </li>
      <li>
        <strong>Twilio Inc.</strong> (Estados Unidos): conexión de nuestro número de WhatsApp.
      </li>
      <li>
        <strong>Anthropic PBC</strong> (Estados Unidos): inteligencia artificial del asistente de WhatsApp.
      </li>
      <li>
        <strong>Upstash Inc.:</strong> registro técnico temporal que relaciona cada pedido pagado con su ficha en nuestro sistema de
        seguimiento.
      </li>
      <li>
        <strong>Jumpseller:</strong> plataforma de ventas: catálogo, imágenes de productos, links de pago y registro de pedidos.
      </li>
    </ul>
    <p>
      <strong>Otros destinatarios, que tratan los datos bajo su propia responsabilidad:</strong>
    </p>
    <ul>
      <li>
        <strong>Medios de pago</strong> (Flow y Transbank para Webpay, Mercado Pago): reciben los datos que ingresas al pagar.
      </li>
      <li>
        <strong>Transportistas</strong> (Starken, Chilexpress, Cruz del Sur, PDQ u otro que elijas): reciben tu nombre, dirección y
        teléfono para hacer la entrega.
      </li>
      <li>
        <strong>WhatsApp (Meta):</strong> si nos escribes por WhatsApp, ese servicio trata tus mensajes según su propia política.
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
        <strong>Novedades y ofertas:</strong> hasta que retires tu consentimiento.
      </li>
      <li>
        <strong>Origen de tu visita:</strong> en tu navegador se borra al cerrar la pestaña; la copia que va con tu solicitud sigue
        el plazo de la solicitud.
      </li>
      <li>
        <strong>Registro técnico de pedidos (Upstash):</strong> 30 días.
      </li>
      <li>
        <strong>Asistente de WhatsApp:</strong> guarda el historial reciente de la conversación solo en memoria temporal. Lo que
        registramos de la conversación en nuestro sistema de seguimiento sigue el plazo de las solicitudes.
      </li>
      <li>
        <strong>Registros técnicos del sitio y del asistente de WhatsApp</strong> (pueden incluir tu teléfono, nombre, correo o un
        extracto de tu mensaje): los plazos breves que define cada proveedor.
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
        <strong>oposición:</strong> oponerte a un tratamiento, incluidos el envío de novedades y la priorización automática;
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
      solo los plazos breves que define cada proveedor (punto 7). Si ocurre una vulneración de seguridad que pueda afectar tus datos, la informaremos a la Agencia
      de Protección de Datos Personales y, cuando corresponda, a ti.
    </p>

    <h2>10. Cookies y almacenamiento en tu navegador</h2>
    <ul>
      <li>
        <strong>Este sitio no instala cookies propias.</strong>
      </li>
      <li>
        Usa el <strong>almacenamiento de sesión</strong> de tu navegador, que se borra al cerrar la pestaña, para recordar tu lista
        de cotización, tu lista de pedido, si ves los precios con o sin IVA y el origen de tu visita. Son necesarios para que el
        sitio funcione como pides, y solo salen de tu navegador cuando envías un formulario.
      </li>
      <li>
        <strong>Imágenes de productos:</strong> se cargan desde los servidores de Jumpseller, que reciben datos técnicos de tu
        conexión, como tu dirección IP.
      </li>
      <li>
        <strong>Google Analytics:</strong> no se usa en nuevo.elights.cl. Cuando el sitio funcione en elights.cl, se activará solo
        si lo aceptas en el aviso de cookies; usa cookies para medir visitas de forma agregada. Puedes cambiar tu decisión cuando
        quieras desde ese mismo aviso.
      </li>
      <li>
        Hoy no usamos el píxel de Meta ni etiquetas de publicidad de Google en este sitio. Si los agregamos, será solo con tu
        consentimiento y actualizaremos esta política.
      </li>
      <li>Los enlaces a WhatsApp abren ese servicio, que se rige por su propia política.</li>
    </ul>

    <h2>11. Menores de edad</h2>
    <p>Este sitio está dirigido a empresas y a personas mayores de edad. No recolectamos a sabiendas datos de menores.</p>

    <h2>12. Cambios a esta política</h2>
    <p>
      Si cambiamos esta política, publicaremos aquí la nueva versión con su fecha. Si el cambio afecta algo que depende de tu
      consentimiento, te lo pediremos de nuevo. Puedes pedir las versiones anteriores a <EmailLink />.
    </p>
    <p>
      La compra y sus condiciones están en <Link to="/terminos-y-condiciones">Términos y condiciones</Link>.
    </p>
  </LegalLayout>
);

export default PrivacidadPage;
