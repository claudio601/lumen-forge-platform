// /terminos-y-condiciones: términos de venta (PR 12). Base: Ley 19.496 y DS 6/2021
// (comercio electrónico). Defaults del dueño: retracto y garantía para todos los
// compradores (personas y empresas), cualquiera sea el medio de pago; en los servicios,
// retracto hasta que comienzan; la compra queda hecha al pagar (con transferencia, cuando el
// pago se acredita; con crédito acordado, cuando el cliente acepta por escrito la cotización).
// Despacho sin costo y retiro en bodega (dueño, 2026-10-14, PR 12b): monto, zona y lugar desde
// src/config/business.ts; el detalle está en /despacho.
// Versión y fecha: LEGAL_VERSION y LEGAL_UPDATED_LABEL (src/config/site.ts).

import { Link } from 'react-router-dom';
import LegalLayout from '@/components/legal/LegalLayout';
import { CompanyFacts, EmailLink, WhatsAppLink } from '@/components/legal/CompanyFacts';
import { clp, FREE_SHIPPING_AREA, FREE_SHIPPING_THRESHOLD_CLP, PICKUP_PLACE, quoteValidityBusinessDays } from '@/config/business';

const TerminosPage = () => (
  <LegalLayout
    path="/terminos-y-condiciones"
    title="Términos y condiciones de venta"
    description="Cómo compras en eLIGHTS: solicitud, cotización y link de pago, precios con IVA, boleta o factura, despacho, derecho a retracto y garantía."
    updated
  >
    <p>
      Estos términos explican cómo compras en eLIGHTS: qué pasa cuando envías una solicitud, cuándo queda hecha la compra, cómo
      pagas, cómo recibes tus productos y qué derechos tienes después. Léelos antes de enviar una solicitud. Puedes guardar o
      imprimir esta página desde tu navegador.
    </p>
    <p>
      Si compras como consumidor, estos términos no reducen ninguno de los derechos que te dan la Ley N° 19.496 sobre Protección
      de los Derechos de los Consumidores y su reglamento de comercio electrónico (Decreto Supremo N° 6 de 2021, del Ministerio de
      Economía). Si algo de este texto se contradice con la ley, se aplica la ley.
    </p>

    <h2>1. Quién vende</h2>
    <CompanyFacts />
    <p>Nos comunicaremos contigo por el correo electrónico, el teléfono o el WhatsApp que indiques en tu solicitud.</p>

    <h2>2. A quién se aplican</h2>
    <p>
      Se aplican a todas las compras que hagas a eLIGHTS a distancia (desde este sitio, por correo, por WhatsApp o por teléfono),
      cualquiera sea el medio de pago.
    </p>
    <p>Valen igual si compras como persona o para una empresa, incluidos el derecho a retracto y la garantía.</p>

    <h2>3. Cómo se compra, paso a paso</h2>
    <ol>
      <li>
        <strong>Solicitud.</strong> Eliges productos y envías una solicitud de pedido o de cotización desde el sitio, o nos pides
        una cotización por correo o WhatsApp. Antes de enviarla puedes revisar y corregir tus datos y los productos en el mismo
        formulario.
      </li>
      <li>
        <strong>La solicitud no es una compra.</strong> No te obliga a pagar ni genera ningún cobro. Tampoco es todavía una venta:
        primero confirmamos disponibilidad.
      </li>
      <li>
        <strong>Cotización y link de pago.</strong> Te respondemos con una cotización que indica los productos, las cantidades, el
        precio unitario y el total con IVA, el costo del despacho por separado (o si va sin costo o por pagar), el plazo, las
        condiciones especiales (por ejemplo, productos sin derecho a retracto) y un link de pago.
      </li>
      <li>
        <strong>Revisión.</strong> Si ves un error en la cotización, avísanos antes de pagar y te mandamos una corregida.
      </li>
      <li>
        <strong>Pago y formación del contrato.</strong> La compraventa queda hecha cuando pagas el total de la cotización con el
        link de pago. Si acordamos pago por transferencia, queda hecha cuando el pago se acredita en nuestra cuenta. Si acordamos
        pago con crédito (ver <Link to="/medios-de-pago">Medios de pago</Link>), queda hecha cuando aceptas por escrito la
        cotización con esas condiciones de pago. Desde ese momento los dos quedamos obligados: tú a pagar y nosotros a cumplir lo
        cotizado.
      </li>
      <li>
        <strong>Confirmación.</strong> Después del pago te mandamos por correo una confirmación con el detalle de tu compra y un
        enlace a la versión de estos términos vigente al pagar.
      </li>
      <li>
        <strong>Respaldo.</strong> Guardamos tu cotización, tu pago y la confirmación. Si necesitas una copia, pídela a{' '}
        <EmailLink />.
      </li>
    </ol>

    <h2>4. Precios</h2>
    <ul>
      <li>
        Los precios están en pesos chilenos e incluyen IVA. En el modo para empresas ("B2B - Precio neto") el sitio muestra los
        precios sin IVA, rotulados así; el total que pagas siempre incluye IVA.
      </li>
      <li>
        El costo del despacho no está incluido en el precio de los productos. Va por separado en la cotización, o la cotización
        indica que va sin costo (compras sobre {clp(FREE_SHIPPING_THRESHOLD_CLP)} con IVA, con entrega en la{' '}
        {FREE_SHIPPING_AREA.name}) o por pagar. Las comunas que no entran y las demás condiciones están en{' '}
        <Link to="/despacho">Despacho</Link>.
      </li>
      <li>
        Respetamos el precio publicado en el sitio al momento en que enviaste tu solicitud, mientras la cotización esté vigente.
      </li>
      <li>Si publicamos una promoción, junto a ella indicaremos sus condiciones y su vigencia.</li>
    </ul>

    <h2>5. Vigencia de la cotización</h2>
    <p>
      La cotización tiene una validez de {quoteValidityBusinessDays} días hábiles desde su fecha, salvo que la misma cotización
      indique otro plazo. Durante ese plazo mantenemos el precio y las condiciones cotizadas. Si pagas después, te confirmamos
      precio y disponibilidad antes de seguir.
    </p>

    <h2>6. Disponibilidad</h2>
    <p>
      No mostramos disponibilidad en línea porque parte de los productos los conseguimos a pedido. Por eso cada solicitud se
      confirma antes de mandarte el link de pago.
    </p>
    <p>
      Si después de cotizar un producto deja de estar disponible antes de tu pago, te avisamos y puedes elegir un reemplazo
      equivalente o no comprarlo. Si ya pagaste y no podemos cumplir, eliges entre un producto equivalente que aceptes y la
      devolución completa de lo que pagaste.
    </p>

    <h2>7. Pago</h2>
    <p>
      Los medios de pago están en <Link to="/medios-de-pago">Medios de pago</Link>. No recibimos ni guardamos los datos de tu
      tarjeta: el pago lo procesan la plataforma del link de pago y el medio de pago que elijas.
    </p>

    <h2>8. Boleta o factura</h2>
    <ul>
      <li>Si compras como persona, emitimos boleta electrónica.</li>
      <li>
        Si compras para una empresa, emitimos factura electrónica a su nombre. Para eso necesitamos, antes del pago, el RUT, la
        razón social, el giro y la dirección comercial de la empresa.
      </li>
      <li>
        El tipo de documento se define al pagar. Si necesitas cambiarlo, escríbenos de inmediato y vemos si es posible según las
        normas del Servicio de Impuestos Internos.
      </li>
    </ul>

    <h2>9. Despacho y recepción</h2>
    <p>
      Despacho en hasta 2 días hábiles desde que el pago está confirmado (ver <Link to="/medios-de-pago">Medios de pago</Link>), y
      a veces el mismo día. En regiones, es el plazo para entregar tu pedido al transportista; a eso se suma el tiempo de viaje,
      que te informamos en la cotización antes de que pagues. El costo y las condiciones de despacho a cada destino están en{' '}
      <Link to="/despacho">Despacho</Link> y en tu cotización. También puedes retirar tu pedido en {PICKUP_PLACE}: la dirección
      exacta te la damos cuando tu pago está acreditado.
    </p>
    <p>
      Al recibir, revisa el embalaje frente al transportista. Si viene dañado, déjalo anotado en el comprobante del transportista
      y avísanos lo antes posible, idealmente con fotos. Esto nos ayuda a reclamar al transportista y no limita tu garantía legal.
    </p>

    <h2>10. Derecho a retracto</h2>
    <p>
      Puedes arrepentirte de una compra hecha a distancia dentro de 10 días corridos desde que recibes el producto, sin dar
      razones. Si no recibiste la confirmación escrita de la compra (punto 3.6), el plazo es de 90 días.
    </p>
    <p>
      No hay derecho a retracto en los casos que permite la ley: productos ya instalados o usados más allá de lo necesario para
      revisarlos, y productos fabricados o adaptados según tus especificaciones. Si tu compra incluye alguno, la cotización lo
      dirá junto a su precio, con la frase "sin derecho a retracto", antes de que pagues. Un producto del catálogo que conseguimos
      a pedido sí tiene derecho a retracto.
    </p>
    <p>
      En los servicios (estudio lumínico, visita técnica e instalación) puedes retractarte desde que los contratas hasta antes de
      que comiencen; te avisaremos cuándo comienza cada servicio.
    </p>
    <p>
      Cómo ejercerlo, en qué estado debe volver el producto y cómo te devolvemos el dinero:{' '}
      <Link to="/cambios-devoluciones-y-garantia">Cambios, devoluciones y garantía</Link>.
    </p>

    <h2>11. Garantía</h2>
    <p>
      Todos los productos tienen la garantía legal de 6 meses desde que los recibes: si un producto falla, eliges entre
      reparación sin costo, cambio o devolución de lo pagado. Muchos productos tienen además una garantía del fabricante más
      larga, que varía según el tipo de producto y se indica en su ficha; durante ese plazo mayor tienes los mismos derechos.
      Detalles en <Link to="/cambios-devoluciones-y-garantia">Cambios, devoluciones y garantía</Link>.
    </p>

    <h2>12. Información de los productos e instalación</h2>
    <p>
      Describimos cada producto con los datos de su fabricante: potencia, flujo luminoso, grado de protección, medidas y demás
      especificaciones. Si encuentras un dato que no coincide con el producto que recibiste, avísanos: te corresponden los
      derechos de la garantía legal.
    </p>
    <p>
      Recomendamos que la instalación la haga un instalador eléctrico autorizado por la Superintendencia de Electricidad y
      Combustibles (SEC), siguiendo la ficha técnica del producto.
    </p>

    <h2>13. Datos personales</h2>
    <p>
      Tratamos tus datos según nuestra <Link to="/politica-de-privacidad">Política de privacidad</Link>.
    </p>

    <h2>14. Comunicaciones comerciales</h2>
    <p>
      Solo te enviaremos novedades u ofertas si lo autorizas. En cada mensaje encontrarás cómo dejar de recibirlos, y también
      puedes pedirlo en cualquier momento a <EmailLink />.
    </p>

    <h2>15. Cambios a estos términos</h2>
    <p>
      Podemos actualizar estos términos. Cada versión indica su fecha. Tu compra se rige por la versión vigente cuando pagaste. Si
      necesitas una versión anterior, pídela a <EmailLink />.
    </p>

    <h2>16. Consultas, reclamos y ley aplicable</h2>
    <p>
      Si tienes un problema con tu compra, escríbenos a <EmailLink /> o al WhatsApp <WhatsAppLink /> y lo resolvemos contigo.
      También puedes recurrir al Servicio Nacional del Consumidor (SERNAC,{' '}
      <a href="https://www.sernac.cl" target="_blank" rel="noopener noreferrer">
        www.sernac.cl
      </a>
      ).
    </p>
    <p>
      Estos términos se rigen por la ley chilena. Si eres consumidor, puedes presentar tu denuncia ante el juzgado de policía local
      de tu domicilio o del domicilio de eLIGHTS, a tu elección, como lo dispone la Ley N° 19.496.
    </p>
  </LegalLayout>
);

export default TerminosPage;
