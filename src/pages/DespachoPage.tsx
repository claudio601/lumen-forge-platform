// /despacho: plazo, despacho sin costo, regiones, retiro y seguimiento (PR 12; despacho y
// retiro confirmados por el dueño el 2026-10-14, PR 12b). Todo sale de src/config/business.ts:
// - FREE_SHIPPING_THRESHOLD_CLP: sin costo si el total de la compra CON IVA es mayor que el
//   monto (estrictamente) y la entrega es en FREE_SHIPPING_AREA (Provincia de Santiago). La
//   página nombra las 20 comunas de la Región Metropolitana que no entran: las del dueño, con
//   sus palabras, y las 7 que su lista no nombra (freeShippingExcludedList), para que la lista
//   no parezca completa sin serlo.
// - Fuera de esa cobertura (con el monto o menos, o fuera de la zona), la regla es por pagar (con
//   el transportista) o retiro en bodega; el flete va incluido en la cotización solo cuando las
//   bases de una licitación o el proyecto lo exigen (decisión del dueño 4A, 2026-11-13).
// - REGION_CARRIERS: a regiones, por pagar; el tiempo de viaje se informa en la cotización.
// - Paneles de formato grande (regla del dueño A22, decisión 2A, 2026-11-13): van a regiones solo
//   desde su caja master; el slim 60x60, desde SLIM_60X60_MIN_UNITS; con menos, retiro en bodega o
//   la caja completa. Los paneles chicos, redondos y cuadrados, en cualquier cantidad. La página no
//   promete un número por panel: lo muestra la ficha (PANEL_MASTER_BOX), y la del 120x30 regulable
//   (2348922) dice «desde una caja completa», sin número, porque Jumpseller no trae su caja.
// - PICKUP_PLACE: retiro en la bodega de Quinta Normal. La dirección exacta se da solo con el
//   pago acreditado: nunca se publica (la página la nombra una sola vez, en «Retiro en bodega»).
// El único plazo publicado es "hasta 2 días hábiles": check-prerender bloquea cualquier otro
// (scripts/jumpseller/descriptions.ts). Montos con clp(), sin Intl (hidratación).

import { Link } from 'react-router-dom';
import LegalLayout from '@/components/legal/LegalLayout';
import { EmailLink } from '@/components/legal/CompanyFacts';
import {
  clp,
  FREE_SHIPPING_AREA,
  FREE_SHIPPING_THRESHOLD_CLP,
  freeShippingExcludedList,
  PICKUP_PLACE,
  REGION_CARRIERS,
  SLIM_60X60_MIN_UNITS,
} from '@/config/business';

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
      En compras de {threshold} o menos con IVA, o con entrega fuera de esta zona, el despacho va por pagar: pagas el flete
      directamente al transportista cuando recibes. Si prefieres, retiras tu pedido en la bodega, sin pagar despacho. Solo
      cuando las bases de una licitación o el proyecto lo exigen, incluimos el flete en la cotización.
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
      <li>
        <strong>Paneles de formato grande</strong> (60x60, 120x60, 120x30 y 120x15, backlight y slim): a regiones los
        despachamos solo desde una caja completa, porque fuera de su caja se pueden romper en el viaje. El panel slim de 60x60
        se despacha desde {SLIM_60X60_MIN_UNITS} unidades. Con menos unidades, retiras tu pedido en la bodega o te cotizamos la
        caja completa. Desde una caja, cotizamos la cantidad que pidas, sin redondear a cajas. La ficha de cada uno de estos
        paneles indica cómo se despacha a regiones.
      </li>
      <li>Los paneles chicos, redondos y cuadrados, se despachan en cualquier cantidad.</li>
    </ul>

    <h2>Costo del despacho</h2>
    <p>
      El costo del despacho no está incluido en el precio de los productos. Antes de que pagues, la cotización indica si tu
      despacho va sin costo o por pagar, o si retiras en bodega. El link de pago cobra el total de la cotización.
    </p>
    <p>
      Solo cuando las bases de una licitación o el proyecto lo exigen, la cotización incluye el flete, por separado. Para
      pedidos grandes o de proyecto (por ejemplo, entregas en obra o en varias partes), acordamos las condiciones en la
      cotización.
    </p>

    <h2>Retiro en bodega</h2>
    <p>
      Si prefieres, retiras tu pedido en {PICKUP_PLACE}, sin pagar despacho. La dirección exacta te la damos solo cuando tu pago
      está acreditado, y ahí coordinamos contigo el retiro.
    </p>

    <h2>Seguimiento</h2>
    <p>
      Cuando tu pedido sale, te mandamos por correo el nombre del transportista y el número de seguimiento. Si quieres saber en
      qué va tu pedido, escríbenos a <EmailLink /> con tu número de pedido o de cotización.
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
