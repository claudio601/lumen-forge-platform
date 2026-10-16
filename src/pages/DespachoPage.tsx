// /despacho: plazo, despacho sin costo, regiones, retiro y seguimiento (PR 12; despacho y
// retiro confirmados por el dueño el 2026-10-14, PR 12b). Todo sale de src/config/business.ts:
// - FREE_SHIPPING_THRESHOLD_CLP: sin costo si el total de la compra CON IVA es mayor que el
//   monto (estrictamente) y la entrega es en FREE_SHIPPING_AREA (Provincia de Santiago). La
//   página nombra las 20 comunas de la Región Metropolitana que no entran: las del dueño, con
//   sus palabras, y las 7 que su lista no nombra (freeShippingExcludedList), para que la lista
//   no parezca completa sin serlo. Con el monto o menos, o fuera de esa zona, el costo va en la
//   cotización o el despacho va por pagar.
// - REGION_CARRIERS: a regiones, por pagar; el tiempo de viaje se informa en la cotización.
// - PICKUP_PLACE: retiro en la bodega de Quinta Normal. La dirección exacta se da solo con el
//   pago acreditado: nunca se publica.
// El único plazo publicado es "hasta 2 días hábiles": check-prerender bloquea cualquier otro
// (scripts/jumpseller/descriptions.ts). Montos con clp(), sin Intl (hidratación).

import { Link } from 'react-router-dom';
import LegalLayout from '@/components/legal/LegalLayout';
import { EmailLink, WhatsAppLink } from '@/components/legal/CompanyFacts';
import { clp, FREE_SHIPPING_AREA, FREE_SHIPPING_THRESHOLD_CLP, freeShippingExcludedList, PICKUP_PLACE, REGION_CARRIERS } from '@/config/business';

const threshold = clp(FREE_SHIPPING_THRESHOLD_CLP);
const area = FREE_SHIPPING_AREA.name;

/** Despacho sin costo: la condición, la zona y todas las comunas de la RM que no entran (desde business.ts). */
const FreeShipping = () => (
  <>
    <ul>
      <li>
        <strong>Despacho sin costo</strong> si el total de tu compra, con IVA, es mayor a {threshold} y la entrega es en la {area}.
      </li>
      <li>
        <strong>No entran</strong> las comunas de otras provincias de la Región Metropolitana: {`${freeShippingExcludedList}.`}
      </li>
    </ul>
    <p>
      En compras de {threshold} o menos con IVA, o con entrega fuera de esta zona, el costo del despacho te lo informamos en la
      cotización, antes de que pagues, o la cotización indica que va por pagar. Si va por pagar, pagas el flete directamente al
      transportista cuando recibes.
    </p>
    <p>Si no sabes si tu comuna está en la {area}, te lo confirmamos en la cotización.</p>
    <p>
      El despacho sin costo es una condición permanente de venta, no una promoción con fecha de término. Si la cambiamos, lo
      publicaremos en esta página.
    </p>
  </>
);

const DespachoPage = () => (
  <LegalLayout
    path="/despacho"
    description={`Despacho en hasta 2 días hábiles desde que tu pago está confirmado. Sin costo sobre ${threshold} con IVA en la ${area}. También retiro en bodega.`}
  >
    <p>
      <strong>Despacho en hasta 2 días hábiles, y a veces el mismo día.</strong> El plazo corre desde que tu pago está
      confirmado. No se cuentan sábados, domingos ni festivos. En regiones, es el plazo para entregar tu pedido al transportista;
      a eso se suma el tiempo de viaje, que te informamos en la cotización antes de que pagues.
    </p>
    <p>Despachamos a todo Chile.</p>

    <h2>{area}</h2>
    <FreeShipping />

    <h2>Regiones</h2>
    <ul>
      <li>
        El despacho a regiones va por pagar, vía {REGION_CARRIERS}. También podemos despachar con el transportista que
        prefieras. Pagas el flete directamente al transportista cuando recibes.
      </li>
      <li>
        El tiempo de viaje hasta tu ciudad depende del transportista y del destino. Te lo informamos en la cotización, antes de que
        pagues.
      </li>
    </ul>

    <h2>Costo del despacho</h2>
    <p>
      El costo del despacho no está incluido en el precio de los productos. Antes de que pagues, la cotización y el link de pago
      lo muestran por separado, o indican que va sin costo o por pagar.
    </p>
    <p>
      Para pedidos grandes o de proyecto (por ejemplo, entregas en obra o en varias partes), acordamos las condiciones en la
      cotización.
    </p>

    <h2>Retiro en bodega</h2>
    <p>
      Si prefieres, retiras tu pedido en {PICKUP_PLACE}, sin pagar despacho. La dirección exacta te la damos solo cuando tu pago
      está acreditado, y ahí coordinamos contigo el retiro.
    </p>

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
