// src/components/guides/GuideCrumbs.tsx
// Migas visibles de las guías (plan del blog, §1.3, bloque 1): las mismas que el BreadcrumbList
// del JSON-LD. La última es la página actual, sin enlace.

import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import type { Crumb } from '@/lib/seo/jsonld';

const GuideCrumbs = ({ crumbs }: { crumbs: readonly Crumb[] }) => (
  <nav aria-label="Migas" className="mb-4 text-sm text-muted-foreground">
    <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
      {crumbs.map((c, i) => (
        <Fragment key={c.path}>
          {i > 0 && (
            <li aria-hidden="true" className="select-none">
              ›
            </li>
          )}
          <li>
            {i === crumbs.length - 1 ? (
              <span aria-current="page" className="text-foreground">
                {c.name}
              </span>
            ) : (
              <Link to={c.path} className="hover:text-primary hover:underline">
                {c.name}
              </Link>
            )}
          </li>
        </Fragment>
      ))}
    </ol>
  </nav>
);

export default GuideCrumbs;
