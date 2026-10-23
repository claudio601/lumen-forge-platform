// src/components/guides/GuideLayout.tsx
// Marco de una guía (plan del blog, §1.3 y §5.4), sobre la base de LegalLayout: migas, un solo
// H1, autor y fechas, la respuesta corta, el índice de secciones (desde 4), el cuerpo con sus H2
// de id fijo, el recuadro final, las fuentes con su fecha, el historial, el autor, «Cómo hicimos
// esta guía» y las guías relacionadas que ya estén publicadas. Sin new Date(), Intl ni
// almacenamiento del navegador: se prerenderiza y se hidrata igual.

import { useEffect, type ReactNode } from 'react';
import { Link, useLocation, useNavigationType } from 'react-router-dom';
import { GUIDE_AUTHORS, guideCrumbs, isPublishedGuide } from '@/data/guides/index';
import { guidePath } from '@/data/guides/paths';
import { ds1ItemTail } from '@/data/guides/ds1-block';
import type { GuideBlock, GuideContent, GuideMeta, GuideSection } from '@/data/guides/types';
import GuideCrumbs from './GuideCrumbs';
import GuideFinalBox from './GuideFinalBox';
import GuideRich, { GuideLinkView } from './GuideRich';
import { isEmptyRich } from './links';

/** Desde cuántas secciones va el índice (plan §1.3, bloque 5). */
const TOC_MIN_SECTIONS = 4;

const proseClass =
  'prose prose-sm md:prose-base max-w-none text-foreground/90 prose-headings:text-foreground prose-strong:text-foreground prose-a:text-primary';

/** «2026-10-23T00:00:00-03:00» → «2026-10-23» (para <time>). */
const isoDate = (iso: string) => iso.slice(0, 10);

function Block({ block, pagePath }: { block: GuideBlock; pagePath: string }): ReactNode {
  switch (block.type) {
    case 'p': {
      if (isEmptyRich(block.content)) return null; // solo trozos de guías que aún no se publican
      const text = <GuideRich content={block.content} pagePath={pagePath} />;
      return <p>{block.strong ? <strong>{text}</strong> : text}</p>;
    }
    case 'list': {
      const items = block.items.map((item, i) => (
        <li key={i}>
          <GuideRich content={item} pagePath={pagePath} />
        </li>
      ));
      return block.ordered ? <ol>{items}</ol> : <ul>{items}</ul>;
    }
    case 'table':
      return (
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                {block.head.map(h => (
                  <th key={h} scope="col">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j}>
                      <GuideRich content={cell} pagePath={pagePath} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'ds1-lines':
      return (
        <ul data-ds1-lines="">
          {block.items.map(item => (
            <li key={item.name}>
              {item.noLink ? item.name : <GuideLinkView text={item.name} to={{ products: item.products }} pagePath={pagePath} />}
              {ds1ItemTail(item)}
            </li>
          ))}
        </ul>
      );
  }
}

function Section({ section, pagePath }: { section: GuideSection; pagePath: string }) {
  return (
    <section aria-labelledby={section.id}>
      <h2 id={section.id} className="scroll-mt-28">
        {section.title}
      </h2>
      {section.blocks.map((b, i) => (
        <Block key={i} block={b} pagePath={pagePath} />
      ))}
      {section.subsections?.map(sub => (
        <div key={sub.title}>
          <h3>{sub.title}</h3>
          {sub.blocks.map((b, i) => (
            <Block key={i} block={b} pagePath={pagePath} />
          ))}
        </div>
      ))}
    </section>
  );
}

/**
 * Al llegar a la guía desde otra página del sitio con un #ancla, el cuerpo puede dibujarse
 * después del primer cuadro (ScrollToTop ya subió la página): se baja al ancla al montar.
 * Desde un correo (carga completa) el navegador ya lo hace con el HTML estático.
 */
function useScrollToHashOnPush() {
  const { hash } = useLocation();
  const navigationType = useNavigationType();
  useEffect(() => {
    if (navigationType !== 'PUSH' || hash.length < 2) return;
    try {
      document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView();
    } catch {
      // «#%E0»: no es un id válido
    }
    // Solo al montar: cada guía se remonta al cambiar de slug (src/routes.tsx)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

const GuideLayout = ({ meta, content }: { meta: GuideMeta; content: GuideContent }) => {
  useScrollToHashOnPush();
  const pagePath = guidePath(meta.slug);
  const author = GUIDE_AUTHORS[meta.author];
  const related = content.related.filter(r => isPublishedGuide(r.guide));
  return (
    <div className="container py-8">
      <article className="max-w-3xl">
        <GuideCrumbs crumbs={guideCrumbs(meta)} />
        <h1 className="text-2xl md:text-4xl font-bold mb-3">{meta.h1}</h1>
        <p className="text-sm text-muted-foreground mb-6">
          Por {author.name} · Publicada el <time dateTime={isoDate(meta.datePublished)}>{meta.publishedLabel}</time>
          {meta.modifiedLabel && (
            <>
              {' '}
              · Actualizada el <time dateTime={isoDate(meta.dateModified)}>{meta.modifiedLabel}</time>
            </>
          )}
        </p>

        <div className={proseClass}>
          {content.answer.map((p, i) => (
            <p key={i} className="text-base md:text-lg">
              <GuideRich content={p} pagePath={pagePath} />
            </p>
          ))}

          {content.sections.length >= TOC_MIN_SECTIONS && (
            <nav aria-labelledby="en-esta-guia" className="not-prose my-6 rounded-lg border bg-muted/40 p-4">
              <p id="en-esta-guia" className="text-sm font-semibold mb-2">
                En esta guía
              </p>
              <ol className="list-decimal pl-5 space-y-1 text-sm">
                {content.sections.map(s => (
                  <li key={s.id}>
                    <a href={`#${s.id}`} className="text-primary hover:underline">
                      {s.title}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          )}

          {content.sections.map(s => (
            <Section key={s.id} section={s} pagePath={pagePath} />
          ))}
        </div>

        <GuideFinalBox box={content.finalBox} pagePath={pagePath} />

        <div className={proseClass}>
          <section aria-labelledby="fuentes">
            <h2 id="fuentes" className="scroll-mt-28">
              Fuentes
            </h2>
            <ol>
              {content.sources.map(s => (
                <li key={s.url}>
                  {s.label}:{' '}
                  <a href={s.url} target="_blank" rel="noopener noreferrer" className="break-all">
                    {s.url}
                  </a>{' '}
                  (revisada el {s.reviewed}).
                </li>
              ))}
            </ol>
            <p>Fuentes revisadas el {content.sourcesReviewed}.</p>

            {content.history.length > 0 && (
              <>
                <p>
                  <strong>Historial de cambios</strong>
                </p>
                <ul>
                  {content.history.map(h => (
                    <li key={`${h.date} ${h.change}`}>
                      {h.date}: {h.change}
                    </li>
                  ))}
                </ul>
              </>
            )}

            <p>
              <strong>Sobre el autor</strong>
            </p>
            <p>
              <strong>
                <Link to={author.path}>{author.name}</Link>
              </strong>
              , {author.bio}
            </p>
            <p>
              Redactamos esta guía con apoyo de herramientas de inteligencia artificial. Verificamos cada dato en las fuentes citadas y{' '}
              {author.name} la revisó y aprobó antes de publicarla.
            </p>
          </section>

          {related.length > 0 && (
            <section aria-labelledby="guias-relacionadas">
              <h2 id="guias-relacionadas" className="scroll-mt-28">
                Guías relacionadas
              </h2>
              <ul>
                {related.map(r => (
                  <li key={r.guide}>
                    <strong>
                      <Link to={guidePath(r.guide)}>{r.title}</Link>.
                    </strong>{' '}
                    {r.text}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </article>
    </div>
  );
};

export default GuideLayout;
