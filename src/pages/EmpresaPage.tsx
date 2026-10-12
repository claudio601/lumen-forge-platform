// /empresa: quiénes somos, datos de la empresa y cómo se compra (PR 12).
// Las secciones de proveedores y de postulaciones no se publican (decisión del dueño del
// 2026-10-05: /quieres-ser-nuestro-proveedor y /trabaja-con-nosotros siguen en 404).

import { Link } from 'react-router-dom';
import LegalLayout from '@/components/legal/LegalLayout';
import { CompanyFacts } from '@/components/legal/CompanyFacts';
import { organizationJsonLd } from '@/lib/seo/jsonld';
import { LEGAL_COMUNA, LEGAL_NAME, LEGAL_RUT } from '@/config/site';

const EmpresaPage = () => (
  <LegalLayout
    path="/empresa"
    description={`${LEGAL_NAME} (RUT ${LEGAL_RUT}), ${LEGAL_COMUNA}: iluminación LED industrial, comercial y solar para proyectos, empresas y hogares. Contacto y horario.`}
    jsonLd={[organizationJsonLd()]}
  >
    <p>
      eLIGHTS.cl es una empresa chilena dedicada a la iluminación LED para proyectos, empresas y hogares. Vendemos iluminación
      industrial, comercial, vial, solar y de emergencia, y ayudamos a elegirla a quienes la especifican e instalan: constructoras,
      ingenieros, arquitectos, instaladores eléctricos, empresas, instituciones y particulares.
    </p>

    <h2>Datos de la empresa</h2>
    <CompanyFacts />
    <p>Te contactamos por el correo, el teléfono o el WhatsApp que nos indiques en tu solicitud.</p>

    <h2>Cómo trabajamos</h2>
    <ol>
      <li>
        <strong>Eliges productos</strong> en el <Link to="/catalogo">catálogo</Link> y nos envías una solicitud de pedido o de
        cotización. Enviarla no te obliga a comprar ni genera ningún cobro.
      </li>
      <li>
        <strong>Revisamos tu solicitud</strong>, confirmamos disponibilidad y te respondemos con una cotización y un link de pago.
      </li>
      <li>
        <strong>La compra se concreta cuando pagas.</strong> Despacho en hasta 2 días hábiles, y a veces el mismo día.
      </li>
    </ol>
    <p>
      No mostramos disponibilidad en línea porque parte de los productos los conseguimos a pedido para cada cliente. Por eso
      confirmamos cada solicitud antes de que pagues.
    </p>
    <p>
      Los precios del sitio incluyen IVA. Si compras para una empresa, puedes ver los precios netos (sin IVA) con el selector
      "B2C / B2B" de la parte superior; la cotización y el link de pago siempre muestran el total con IVA.
    </p>

    <h2>Servicios</h2>
    <ul>
      <li>
        <strong>Estudio lumínico DIALux:</strong> calculamos la iluminación de tu proyecto antes de comprar. Conoce el servicio en{' '}
        <Link to="/estudio-luminico">Estudio lumínico</Link>.
      </li>
      <li>
        <strong>Instalación en la Región Metropolitana:</strong> revisa el servicio en <Link to="/instalacion">Instalación</Link>.
      </li>
      <li>
        <strong>Cotización de proyectos:</strong> para obras, licitaciones o compras de volumen, cuéntanos tu proyecto en el{' '}
        <Link to="/cotizador">Cotizador de proyectos</Link>.
      </li>
    </ul>
  </LegalLayout>
);

export default EmpresaPage;
