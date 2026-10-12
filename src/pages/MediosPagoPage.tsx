// /medios-de-pago: cómo se paga y cuándo queda confirmado el pago (PR 12). Misma URL que
// en elights.cl (fila `served` en legacy-urls.json). Medios: los de elights.cl/medios-de-pago
// (transferencia, Webpay a través de Flow, Mercado Pago y crédito caso a caso para clientes
// frecuentes). La orden de compra y Mercado Público no se publican: sin confirmar.

import { Link } from 'react-router-dom';
import LegalLayout from '@/components/legal/LegalLayout';
import { EmailLink } from '@/components/legal/CompanyFacts';
import { LEGAL_NAME } from '@/config/site';

const MediosPagoPage = () => (
  <LegalLayout
    path="/medios-de-pago"
    description="Paga con link de pago (Webpay o Mercado Pago) o por transferencia, solo después de recibir tu cotización. Boleta o factura electrónica. Precios con IVA."
  >
    <p>
      En eLIGHTS no hay cobros automáticos. Pagas solo después de recibir nuestra cotización con el link de pago, cuando ya
      confirmamos la disponibilidad de tus productos.
    </p>
    <p>Los precios están en pesos chilenos e incluyen IVA.</p>

    <h2>Cómo puedes pagar</h2>
    <ol>
      <li>
        <strong>Link de pago.</strong> Con la cotización te mandamos un link de pago de nuestra plataforma de ventas (Jumpseller).
        Ahí puedes pagar con Webpay (a través de Flow) o con Mercado Pago.
      </li>
      <li>
        <strong>Transferencia bancaria</strong> a la cuenta de {LEGAL_NAME}. Los datos de la cuenta van en tu cotización. Nunca te
        pediremos transferir a una cuenta a nombre de otra persona o empresa: si recibes una instrucción así, no pagues y avísanos.
      </li>
      <li>
        <strong>Crédito para clientes frecuentes.</strong> Si ya nos has comprado más de una vez, podemos acordar caso a caso el
        pago con cheque a 30 o 60 días o con vale vista.
      </li>
    </ol>

    <h2>Seguridad de tu pago</h2>
    <p>
      No recibimos ni guardamos los datos de tu tarjeta. Los ingresas directamente en la plataforma de pago, que los procesa con
      sus propias medidas de seguridad. Nunca te pediremos datos de tarjetas ni claves por correo, teléfono o WhatsApp.
    </p>

    <h2>Cuándo se confirma tu pago</h2>
    <ul>
      <li>
        <strong>Link de pago:</strong> al terminar el pago.
      </li>
      <li>
        <strong>Transferencia:</strong> cuando el dinero se acredita en nuestra cuenta. Si nos mandas el comprobante a{' '}
        <EmailLink />, lo revisamos más rápido.
      </li>
      <li>
        <strong>Crédito acordado:</strong> cuando recibimos el cheque o el vale vista.
      </li>
    </ul>
    <p>Despacho en hasta 2 días hábiles desde que el pago está confirmado, y a veces el mismo día.</p>

    <h2>Boleta o factura</h2>
    <ul>
      <li>
        <strong>Personas:</strong> boleta electrónica.
      </li>
      <li>
        <strong>Empresas:</strong> factura electrónica. Antes de pagar, indícanos el RUT, la razón social, el giro y la dirección
        comercial de la empresa.
      </li>
    </ul>
    <p>
      Más información en <Link to="/terminos-y-condiciones">Términos y condiciones</Link>.
    </p>
  </LegalLayout>
);

export default MediosPagoPage;
