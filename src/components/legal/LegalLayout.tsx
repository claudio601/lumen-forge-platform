// src/components/legal/LegalLayout.tsx
// Marco común de las páginas legales y de compra (PR 12): etiquetas para buscadores (con la
// imagen de la marca, DEFAULT_OG, como pide check-prerender), migas en JSON-LD, un único h1,
// la versión vigente cuando corresponde y, al final, enlaces a las demás páginas de
// LEGAL_PAGES. Sin new Date() ni sessionStorage: se prerenderiza y se hidrata igual.

import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import Seo from '@/components/Seo';
import { breadcrumbJsonLd, type JsonLd } from '@/lib/seo/jsonld';
import { LEGAL_UPDATED, LEGAL_UPDATED_LABEL, LEGAL_VERSION } from '@/config/site';
import { LEGAL_PAGES, legalPage, type LegalPath } from '@/config/legal';

interface LegalLayoutProps {
  path: LegalPath;
  /** Texto del h1; por defecto, el nombre de la página en LEGAL_PAGES. */
  title?: string;
  /** Meta description. */
  description: string;
  /** Muestra la versión y la fecha desde la que rige el texto (términos, cambios, privacidad). */
  updated?: boolean;
  jsonLd?: JsonLd[];
  children: ReactNode;
}

const LegalLayout = ({ path, title, description, updated = false, jsonLd = [], children }: LegalLayoutProps) => {
  const { label } = legalPage(path);
  return (
    <>
      <Seo
        title={`${label} | eLIGHTS Chile`}
        description={description}
        path={path}
        jsonLd={[breadcrumbJsonLd([{ name: 'Inicio', path: '/' }, { name: label, path }]), ...jsonLd]}
      />
      <div className="container py-8">
        <article className="max-w-3xl">
          <h1 className="text-2xl md:text-4xl font-bold mb-3">{title ?? label}</h1>
          {updated && (
            <p className="text-sm text-muted-foreground mb-6">
              Versión {LEGAL_VERSION}. Vigente desde el <time dateTime={LEGAL_UPDATED}>{LEGAL_UPDATED_LABEL}</time>.
            </p>
          )}
          <div className="prose prose-sm md:prose-base max-w-none text-foreground/90 prose-headings:text-foreground prose-strong:text-foreground prose-a:text-primary">
            {children}
          </div>
          <nav aria-label="Más información" className="mt-10 border-t pt-6">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">Más información</h2>
            <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
              {LEGAL_PAGES.filter(p => p.path !== path).map(p => (
                <li key={p.path}>
                  <Link to={p.path} className="text-primary hover:underline">
                    {p.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </article>
      </div>
    </>
  );
};

export default LegalLayout;
