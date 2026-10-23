// src/components/guides/GuideRich.tsx
// Texto de una guía con sus enlaces (src/data/guides/types.ts). Cada destino (./links.ts) lleva a:
// - una categoría o una página fija: <Link>; los clics hacia /cotizador y /estudio-luminico se
//   miden como guia_cta_click (link_type guia_texto; plan del blog, §5.5);
// - otra guía: solo si está publicada (si no, el enlace no se muestra, plan §1.5);
// - fichas: la primera publicada de la lista; sin ninguna, queda el texto sin enlace;
// - un correo: mailto a ventas@elights.cl (contactEmail), con su asunto si lo tiene; esos clics
//   los mide contact_email_click, igual que en todo el sitio;
// - un ancla de la misma guía, o una fuente oficial en otra pestaña.
// Los trozos { ifGuide } se muestran solo si esa guía está publicada.

import { Fragment, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { trackGuideCta } from '@/lib/analytics';
import { isPublishedGuide } from '@/data/guides/index';
import type { GuideLink, Inline, Rich } from '@/data/guides/types';
import { MEASURED_ROUTES, resolveGuideLink } from './links';

const linkClass = 'text-primary underline underline-offset-2 hover:no-underline';

interface LinkProps {
  text: string;
  to: GuideLink;
  /** Ruta de la guía (page_path del evento). */
  pagePath: string;
}

export function GuideLinkView({ text, to, pagePath }: LinkProps): ReactNode {
  const r = resolveGuideLink(to);
  if (!r) return text;
  if (r.kind === 'route') {
    const measured = MEASURED_ROUTES.includes(r.href);
    return (
      <Link to={r.href} className={linkClass} onClick={measured ? () => trackGuideCta('guia_texto', r.href, pagePath) : undefined}>
        {text}
      </Link>
    );
  }
  if (r.kind === 'external') {
    return (
      <a href={r.href} target="_blank" rel="noopener noreferrer" className={linkClass}>
        {text}
      </a>
    );
  }
  return (
    <a href={r.href} className={linkClass}>
      {text}
    </a>
  );
}

function InlineView({ part, pagePath }: { part: Inline; pagePath: string }): ReactNode {
  if (typeof part === 'string') return part;
  if ('b' in part) return <strong>{part.b}</strong>;
  if ('ifGuide' in part) return isPublishedGuide(part.ifGuide) ? <GuideRich content={part.parts} pagePath={pagePath} /> : null;
  return <GuideLinkView text={part.text} to={part.to} pagePath={pagePath} />;
}

const GuideRich = ({ content, pagePath }: { content: Rich; pagePath: string }) => (
  <>
    {content.map((part, i) => (
      <Fragment key={i}>
        <InlineView part={part} pagePath={pagePath} />
      </Fragment>
    ))}
  </>
);

export default GuideRich;
