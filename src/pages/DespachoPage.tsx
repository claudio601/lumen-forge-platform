// /despacho: plazo, costo, transportistas y seguimiento (PR 12). Defaults del dueño: el
// monto del despacho sin costo en Santiago urbano no se publica mientras
// FREE_SHIPPING_THRESHOLD_CLP sea null (el costo va en la cotización); el tiempo de viaje a
// regiones se informa en la cotización; transportistas de la página de envíos de
// elights.cl; sin retiro en oficina. El único plazo publicado es "hasta 2 días hábiles":
// check-prerender bloquea cualquier otro (scripts/jumpseller/descriptions.ts).

import { Link } from 'react-router-dom';
import LegalLayout from '@/components/legal/LegalLayout';
import { EmailLink, WhatsAppLink } from '@/components/legal/CompanyFacts';
import { FREE_SHIPPING_THRESHOLD_CLP } from '@/config/business';

/** $200000 → "$200.000" (sin Intl: el servidor y el navegador dibujan lo mismo). */
const clp = (amount: number) => `$${String(Math.round(amount)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;

/** Condición en Santiago urbano: con monto publicado, las dos franjas; si no, el costo va en la cotización. */
export const UrbanShipping = ({ thresholdClp }: { thresholdClp: number | null }) =>
  thresholdClp === null ? (
    <p>
      Despachamos a domicilio. El costo del despacho te lo informamos en la cotización, antes de que pagues. Si el despacho va por
      pagar, eliges entre Starken y Chilexpress y pagas el flete directamente al transportista cuando recibes.
    </p>
  ) : (
    <>
      <ul>
        <li>
          <strong>Compras sobre {clp(thresholdClp)} (IVA incluido):</strong> despacho a domicilio sin costo.
        </li>
        <li>
          <strong>Compras de {clp(thresholdClp)} o menos:</strong> el despacho va por pagar con Starken o Chilexpress, a tu
          elección. Pagas el flete directamente al transportista cuando recibes.
        </li>
      </ul>
      <p>Si tu dirección está en el límite del área urbana, te confirmamos en la cotización qué condición aplica.</p>
      <p>
        El despacho sin costo es una condición permanente de venta, no una promoción con fecha de término. Si la cambiamos, lo
        publicaremos en esta página.
      </p>
    </>
  );

const DespachoPage = () => (
  <LegalLayout
    path="/despacho"
    description="Despacho en hasta 2 días hábiles desde que tu pago está confirmado. Costo, transportista y tiempo de viaje a regiones en tu cotización, antes de pagar."
  >
    <p>
      <strong>Despacho en hasta 2 días hábiles, y a veces el mismo día.</strong> El plazo corre desde que tu pago está
      confirmado. No se cuentan sábados, domingos ni festivos. En regiones, es el plazo para entregar tu pedido al transportista;
      a eso se suma el tiempo de viaje, que te informamos en la cotización antes de que pagues.
    </p>
    <p>Despachamos a todo Chile.</p>

    <h2>Santiago urbano</h2>
    <UrbanShipping thresholdClp={FREE_SHIPPING_THRESHOLD_CLP} />

    <h2>Regiones</h2>
    <ul>
      <li>El despacho a regiones va por pagar, con el transportista que prefieras. Te recomendamos Starken, Cruz del Sur o PDQ.</li>
      <li>
        El tiempo de viaje hasta tu ciudad depende del transportista y del destino. Te lo informamos en la cotización, antes de que
        pagues.
      </li>
    </ul>

    <h2>Costo del despacho</h2>
    <p>
      El costo del despacho no está incluido en el precio de los productos. Antes de que pagues, la cotización y el link de pago
      lo muestran por separado, o indican que va por pagar.
    </p>
    <p>
      Para pedidos grandes o de proyecto (por ejemplo, entregas en obra o en varias partes), acordamos las condiciones en la
      cotización.
    </p>

    <h2>Retiro</h2>
    <p>No tenemos tienda abierta al público ni retiro en oficina: todos los pedidos se despachan.</p>

    <h2>Seguimiento</h2>
    <p>
      Cuando tu pedido sale, te mandamos el nombre del transportista y el número de seguimiento. Si quieres saber en qué va tu
      pedido, escríbenos a <EmailLink /> o al WhatsApp <WhatsAppLink />.
    </p>

    <h2>Al recibir</h2>
    <ul>
      <li>
        Revisa el embalaje frente al transportista. Si viene dañado o abierto, déjalo anotado en su comprobante y avísanos lo antes
        posible, idealmente con fotos.
      </li>
      <li>
        Si falta un producto o llegó uno distinto, escríbenos. Lo solucionamos según tu{' '}
        <Link to="/cambios-devoluciones-y-garantia">garantía legal</Link>.
      </li>
    </ul>

    <h2>Si tu pedido se atrasa</h2>
    <p>
      Si no llega en el plazo informado, escríbenos. Lo revisamos con el transportista y te mantenemos al tanto. Si no podemos
      cumplir, eliges entre esperar un nuevo plazo y la devolución de lo que pagaste.
    </p>
  </LegalLayout>
);

export default DespachoPage;
