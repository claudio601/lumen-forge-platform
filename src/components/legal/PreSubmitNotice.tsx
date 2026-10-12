// src/components/legal/PreSubmitNotice.tsx
// Aviso antes de enviar una solicitud (/solicitar-pedido y /cotizacion, PR 12): la
// solicitud no es una compra, el derecho a retracto y la garantía legal, con enlaces a los
// textos completos. La ley pide informar el retracto antes de contratar y de pagar, de
// forma destacada: su párrafo va en text-base, el tamaño del total de la página. Los enlaces
// abren en otra pestaña para no perder lo escrito. La PR 13 agrega aquí las casillas.

import { Link } from 'react-router-dom';
import { legalPage, type LegalPath } from '@/config/legal';

interface PreSubmitNoticeProps {
  kind: 'pedido' | 'cotizacion';
}

const FIRST_PARAGRAPH: Record<PreSubmitNoticeProps['kind'], string> = {
  pedido:
    'Esta solicitud no es una compra y no genera ningún cobro. Te confirmaremos disponibilidad y te mandaremos una cotización con el link de pago: la compra se hace solo cuando pagas.',
  cotizacion:
    'Esta solicitud de presupuesto no es una compra y no genera ningún cobro. Te mandaremos una cotización con el link de pago: la compra se hace solo cuando pagas.',
};

const NewTabLink = ({ path }: { path: LegalPath }) => (
  <Link to={path} target="_blank" rel="noopener noreferrer" className="text-primary underline">
    {legalPage(path).label}
  </Link>
);

const PreSubmitNotice = ({ kind }: PreSubmitNoticeProps) => (
  <div role="note" aria-label="Información antes de enviar" className="rounded-xl border bg-muted/40 p-4 mb-5 space-y-2">
    <p className="font-semibold">Antes de enviar</p>
    <p className="text-sm">{FIRST_PARAGRAPH[kind]}</p>
    <p className="text-base">
      <strong>Derecho a retracto:</strong> puedes arrepentirte de tu compra dentro de 10 días corridos desde que recibes el
      producto. No aplica a productos ya instalados o usados más allá de lo necesario para revisarlos, ni a los fabricados o
      adaptados según tus especificaciones; si tu pedido incluye alguno, la cotización lo indicará junto a su precio, antes de
      que pagues.
    </p>
    <p className="text-sm">
      Todos los productos tienen garantía legal de 6 meses. Revisa los <NewTabLink path="/terminos-y-condiciones" />,{' '}
      <NewTabLink path="/cambios-devoluciones-y-garantia" /> y la <NewTabLink path="/politica-de-privacidad" />.
    </p>
  </div>
);

export default PreSubmitNotice;
