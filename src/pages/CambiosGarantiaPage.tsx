// /cambios-devoluciones-y-garantia: derecho a retracto, garantía legal y garantía del
// fabricante (PR 12). Base: Ley 19.496 arts. 3 bis, 20 y 21; DS 52 (exclusiones del
// retracto). Defaults del dueño: retracto para todos; en el retracto el cliente paga la
// devolución; en la garantía legal eLIGHTS paga el traslado de ida y vuelta; una garantía
// del fabricante mayor que 6 meses da los mismos derechos durante todo su plazo (art. 21);
// un producto sin plazo en su ficha tiene los 6 meses legales.
// Versión 1.3 (PR 13x): el retracto, la garantía y los demás casos se piden por correo (o
// teléfono, en el retracto), no por WhatsApp: en ese número atiende el asistente automático,
// que no reconoce estos casos y, sin correo, no registra nada (Política de privacidad §4).

import { Link } from 'react-router-dom';
import LegalLayout from '@/components/legal/LegalLayout';
import { EmailLink, PhoneLink } from '@/components/legal/CompanyFacts';
import { businessHoursLong } from '@/config/business';

const CambiosGarantiaPage = () => (
  <LegalLayout
    path="/cambios-devoluciones-y-garantia"
    description="Derecho a retracto de 10 días corridos, garantía legal de 6 meses y garantía del fabricante según cada producto. Cómo pedirlos en eLIGHTS."
    updated
  >
    <p>
      <strong>En resumen</strong>
    </p>
    <ul>
      <li>
        <strong>Derecho a retracto:</strong> puedes arrepentirte de tu compra dentro de 10 días corridos desde que recibes el
        producto.
      </li>
      <li>
        <strong>Garantía legal:</strong> 6 meses desde que recibes el producto. Si falla, eliges entre reparación sin costo, cambio
        o devolución de lo pagado.
      </li>
      <li>
        <strong>Garantía del fabricante:</strong> muchos productos tienen una garantía más larga, que varía según el tipo de
        producto. La indica la ficha de cada producto, y durante ese plazo tienes los mismos derechos que en la garantía legal.
      </li>
    </ul>
    <p>
      Para cualquiera de estos casos, escríbenos a <EmailLink />, de {businessHoursLong} En nuestro WhatsApp te atiende un
      asistente automático que no gestiona estos casos.
    </p>

    <h2>1. Derecho a retracto</h2>
    <p>
      <strong>Quién puede usarlo.</strong> Quien compra a eLIGHTS a distancia: desde este sitio, por correo, por WhatsApp o por
      teléfono, cualquiera sea el medio de pago. Lo damos igual a personas y a empresas.
    </p>
    <p>
      <strong>Plazo.</strong> 10 días corridos (se cuentan sábados, domingos y festivos) desde que recibes el producto. Si no
      recibiste la confirmación escrita de tu compra, el plazo es de 90 días.
    </p>
    <p>
      <strong>Cómo hacerlo.</strong> Avísanos por correo a <EmailLink /> o por teléfono al <PhoneLink /> (o por el mismo medio
      con que compraste), indicando tu número de cotización o de pedido y que quieres retractarte. No necesitas explicar por
      qué. Te confirmamos que recibimos tu aviso y coordinamos contigo la devolución del producto.
    </p>
    <p>
      <strong>En qué estado debe volver.</strong> Puedes abrir el embalaje y revisar el producto. Debe volver sin daños causados
      por ti, con sus accesorios, manuales y etiquetas, y con su embalaje original en buen estado (no tiene que estar intacto).
    </p>
    <p>
      <strong>Cuándo no aplica.</strong> La ley permite excluir el retracto en estos casos, que son los que aplicamos:
    </p>
    <ul>
      <li>
        productos ya instalados o usados más allá de lo necesario para revisarlos (por ejemplo, una luminaria montada y conectada
        en obra);
      </li>
      <li>
        productos fabricados o adaptados según tus especificaciones (por ejemplo, cintas LED cortadas a medida o equipos
        fabricados o configurados con especificaciones que tú definiste, como largo, potencia o temperatura de color a medida).
      </li>
    </ul>
    <p>
      Si tu compra incluye alguno de estos productos, la cotización lo dirá junto a su precio, con la frase "sin derecho a
      retracto", antes de que pagues.
    </p>
    <p>Un producto del catálogo que conseguimos a pedido sí tiene derecho a retracto.</p>
    <p>
      <strong>Servicios.</strong> En el estudio lumínico, la visita técnica y la instalación puedes retractarte desde que los
      contratas hasta antes de que comiencen. Te avisaremos cuándo comienza cada servicio.
    </p>
    <p>
      <strong>Costo de devolver el producto.</strong> El traslado del producto de vuelta a eLIGHTS es de tu cargo; coordinamos
      contigo la forma de devolverlo.
    </p>
    <p>
      <strong>Reembolso.</strong> Te devolvemos todo lo que nos pagaste por esa compra, sin descuentos, incluido el despacho si
      nos lo pagaste a nosotros. Lo hacemos lo antes posible y, como máximo, dentro de 45 días desde tu aviso de retracto, por el
      mismo medio de pago o por transferencia a una cuenta a tu nombre o al de tu empresa.
    </p>

    <h2>2. Garantía legal (6 meses)</h2>
    <p>
      <strong>Qué cubre.</strong> Tienes garantía legal si el producto tiene fallas o defectos de fabricación, si no cumple lo
      indicado en su ficha o en tu cotización, o si no sirve para el uso al que está destinado.
    </p>
    <p>
      <strong>Qué puedes elegir.</strong> Dentro de los 6 meses siguientes a la recepción del producto, eliges libremente entre:
    </p>
    <ul>
      <li>reparación sin costo;</li>
      <li>cambio por un producto igual;</li>
      <li>devolución de lo que pagaste.</li>
    </ul>
    <p>
      Si eliges la reparación y el producto sigue fallando, puedes pedir el cambio o la devolución. Si eliges la devolución del
      dinero, los 6 meses se cuentan desde la fecha de la boleta o factura.
    </p>
    <p>
      <strong>Qué necesitas.</strong> La boleta, la factura u otro comprobante de tu compra, y una descripción de la falla,
      idealmente con fotos o un video corto.
    </p>
    <p>
      <strong>Cómo pedirla.</strong> Escríbenos a <EmailLink />. Revisamos tu caso y coordinamos el retiro o la recepción del
      producto. El traslado del producto con falla, de ida y de vuelta, es de cargo de eLIGHTS.
    </p>
    <p>
      <strong>Qué no cubre.</strong> Daños causados después de la recepción, por ti o por terceros: golpes, instalación o
      conexión incorrecta, conexión a un voltaje distinto al indicado en la ficha, uso fuera de las especificaciones del producto
      o modificaciones. Si la instalación la hizo eLIGHTS, respondemos nosotros por esos daños.
    </p>
    <p>
      Lo que se vende como un conjunto (por ejemplo, un kit solar con panel, batería y luminaria) se considera un solo producto
      para la garantía.
    </p>
    <p>Las empresas, de cualquier tamaño, también pueden usar la garantía legal.</p>

    <h2>3. Garantía del fabricante (según el tipo de producto)</h2>
    <p>
      Muchos productos tienen, además, una garantía del fabricante más larga que la legal. Su plazo varía según el tipo de
      producto y el fabricante, y aparece en la ficha de cada producto (en sus especificaciones o en su descripción) o en su
      ficha técnica. Si la ficha no indica un plazo de garantía, se aplica la garantía legal de 6 meses.
    </p>
    <p>
      Si el producto tiene una garantía más larga que 6 meses, la ley hace que ese plazo mayor reemplace a los 6 meses: durante
      todo ese plazo tienes los mismos derechos de la garantía legal (reparación sin costo, cambio o devolución de lo pagado, a tu
      elección) ante una falla cubierta, y la pides de la misma forma.
    </p>
    <p>
      La garantía cubre defectos de materiales y de fabricación. No cubre lo indicado en "Qué no cubre" del punto anterior, ni el
      desgaste normal de componentes con vida útil propia, como las baterías, salvo que la ficha del producto indique para ellos
      un plazo propio.
    </p>

    <h2>4. Otros cambios</h2>
    <p>
      Fuera del retracto y de las garantías no tenemos una política de cambios por otro motivo. Si necesitas cambiar un producto
      por otro, escríbenos y vemos las alternativas caso a caso.
    </p>

    <h2>5. Si no quedas conforme</h2>
    <p>
      Si no llegamos a una solución, puedes recurrir al Servicio Nacional del Consumidor (SERNAC,{' '}
      <a href="https://www.sernac.cl" target="_blank" rel="noopener noreferrer">
        www.sernac.cl
      </a>
      ) o al juzgado de policía local de tu domicilio o del domicilio de eLIGHTS.
    </p>
    <p>
      Más información sobre la compra en <Link to="/terminos-y-condiciones">Términos y condiciones</Link>.
    </p>
  </LegalLayout>
);

export default CambiosGarantiaPage;
