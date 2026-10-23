// src/components/guides/GuideFinalBox.tsx
// Recuadro final de una guía (plan del blog, §1.3, bloque 8, y §5.4 GuideCta): un título, una
// oración y un botón hacia /cotizador o /estudio-luminico, y debajo el correo de ventas con el
// plazo de respuesta en una oración aparte. El clic en el botón se mide como guia_cta_click
// (link_type guia_recuadro); el del correo, como contact_email_click (todo el sitio).
// El título no es un H2: el recuadro no es una sección de la guía.

import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { contactEmail, responseTimePromise } from '@/config/business';
import { trackGuideCta } from '@/lib/analytics';
import type { GuideFinalBox as Box } from '@/data/guides/types';
import { mailHref } from './links';

const GuideFinalBox = ({ box, pagePath }: { box: Box; pagePath: string }) => (
  <aside aria-label={box.title} className="my-10 rounded-xl border border-primary/20 bg-primary/5 p-5 md:p-6">
    <p className="text-lg md:text-xl font-semibold mb-2">{box.title}</p>
    <p className="text-sm md:text-base text-muted-foreground leading-relaxed mb-4">{box.text}</p>
    <Button asChild className="h-auto min-h-10 whitespace-normal">
      <Link to={box.button.route} onClick={() => trackGuideCta('guia_recuadro', box.button.route, pagePath)}>
        {box.button.label}
      </Link>
    </Button>
    <p className="mt-4 text-sm text-muted-foreground">
      O escríbenos a{' '}
      <a href={mailHref()} className="text-primary underline underline-offset-2 hover:no-underline">
        {contactEmail}
      </a>
      . {responseTimePromise}
    </p>
  </aside>
);

export default GuideFinalBox;
