// src/components/legal/CompanyFacts.tsx
// Datos de la empresa y enlaces de contacto de las páginas legales (PR 12). Todo sale de
// src/config/site.ts y src/config/business.ts: nada escrito a mano. Los enlaces mailto:,
// tel: y wa.me cuentan como clics de contacto en analytics (src/lib/analytics.ts).

import type { ReactNode } from 'react';
import { LEGAL_COMUNA, LEGAL_NAME, LEGAL_REPRESENTATIVE, LEGAL_RUT } from '@/config/site';
import { businessClosedDays, businessHoursLong, contactEmail, waBase, whatsappDisplayNumber, whatsappNumber } from '@/config/business';

/** Correo de ventas; con subject, el asunto ya escrito (p. ej. "Datos personales"). */
export const EmailLink = ({ subject }: { subject?: string }) => (
  <a href={`mailto:${contactEmail}${subject ? `?subject=${encodeURIComponent(subject)}` : ''}`}>{contactEmail}</a>
);

/** WhatsApp de ventas en otra pestaña; por defecto muestra el número. */
export const WhatsAppLink = ({ children }: { children?: ReactNode }) => (
  <a href={waBase} target="_blank" rel="noopener noreferrer">
    {children ?? whatsappDisplayNumber}
  </a>
);

export const PhoneLink = () => <a href={`tel:+${whatsappNumber}`}>{whatsappDisplayNumber}</a>;

/** Identificación del vendedor (DS 6 art. 7): /empresa y términos y condiciones §1. */
export const CompanyFacts = () => (
  <ul>
    <li>
      <strong>Razón social:</strong> {LEGAL_NAME}
    </li>
    <li>
      <strong>RUT:</strong> {LEGAL_RUT}
    </li>
    <li>
      <strong>Domicilio:</strong> {LEGAL_COMUNA}, Región Metropolitana, Chile
    </li>
    {LEGAL_REPRESENTATIVE && (
      <li>
        <strong>Representante legal:</strong> {LEGAL_REPRESENTATIVE}
      </li>
    )}
    <li>
      <strong>Correo:</strong> <EmailLink />
    </li>
    <li>
      <strong>Teléfono y WhatsApp:</strong> <PhoneLink /> · <WhatsAppLink>escríbenos por WhatsApp</WhatsAppLink>
    </li>
    <li>
      <strong>Horario de atención:</strong> {businessHoursLong} {businessClosedDays}
    </li>
  </ul>
);
