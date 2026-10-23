// /guias: índice de las guías (plan del blog, §5.4), por pilar. El H1 es neutro a propósito, para
// no competir con la guía pilar por «norma lumínica». Solo muestra los pilares que tienen guías
// publicadas. Lleva las migas en JSON-LD; el ItemList queda fuera en la primera versión (§1.6).

import { Link } from 'react-router-dom';
import Seo from '@/components/Seo';
import GuideCrumbs from '@/components/guides/GuideCrumbs';
import { GUIDE_AUTHORS, GUIDE_PILLARS, GUIDES, GUIDES_INDEX, GUIDES_INDEX_CRUMBS, guideTitle } from '@/data/guides/index';
import { GUIDES_PATH, guidePath } from '@/data/guides/paths';
import { breadcrumbJsonLd } from '@/lib/seo/jsonld';

const GuidesIndexPage = () => {
  const pillars = GUIDE_PILLARS.map(p => ({ ...p, guides: GUIDES.filter(g => g.pillar === p.key) })).filter(p => p.guides.length > 0);
  return (
    <>
      <Seo
        title={guideTitle(GUIDES_INDEX)}
        description={GUIDES_INDEX.metaDescription}
        path={GUIDES_PATH}
        jsonLd={[breadcrumbJsonLd([...GUIDES_INDEX_CRUMBS])]}
      />
      <div className="container py-8">
        <div className="max-w-3xl">
          <GuideCrumbs crumbs={GUIDES_INDEX_CRUMBS} />
          <h1 className="text-2xl md:text-4xl font-bold mb-3">{GUIDES_INDEX.h1}</h1>
          <p className="text-base text-muted-foreground leading-relaxed mb-8">{GUIDES_INDEX.intro}</p>
          {pillars.map(p => (
            <section key={p.key} aria-labelledby={`pilar-${p.key}`} className="mb-10">
              <h2 id={`pilar-${p.key}`} className="text-lg md:text-xl font-semibold mb-4">
                {p.name}
              </h2>
              <ul className="space-y-4">
                {p.guides.map(g => (
                  <li key={g.slug} className="rounded-xl border p-4 md:p-5 hover:border-primary/40 transition-colors">
                    <h3 className="text-base md:text-lg font-semibold mb-1">
                      <Link to={guidePath(g.slug)} className="hover:text-primary hover:underline">
                        {g.h1}
                      </Link>
                    </h3>
                    <p className="text-sm text-muted-foreground leading-relaxed mb-2">{g.metaDescription}</p>
                    <p className="text-xs text-muted-foreground">
                      Por {GUIDE_AUTHORS[g.author].name} · Publicada el {g.publishedLabel}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </>
  );
};

export default GuidesIndexPage;
