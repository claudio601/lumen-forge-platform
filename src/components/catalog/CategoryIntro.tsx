// src/components/catalog/CategoryIntro.tsx
// Introducción de una categoría sobre la grilla (auditoría UX, E-01): párrafos cortos, botones
// hacia la ficha certificada, el correo y la asesoría, y el detalle en un <details> plegable,
// que queda en el HTML del prerender. Los textos viven en src/data/catalog/category-intros.ts.

import { Link } from 'react-router-dom';
import { Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { contactEmail, responseTimePromise } from '@/config/business';
import type { CategoryIntro as Intro } from '@/data/catalog/category-intros';

interface Props {
  intro: Intro;
  /** Ruta de la ficha de un producto por su id de Jumpseller; null si no está publicado (sin ninguno publicado, el botón no se muestra). */
  productHref: (jumpsellerId: number) => string | null;
}

const mailHref = (subject: string) => `mailto:${contactEmail}?subject=${encodeURIComponent(subject)}`;

interface ResolvedAction {
  label: string;
  hint?: string;
  href: string;
  /** 'route': enlace del sitio (<Link>); 'mail': correo a ventas (<a href="mailto:…">). */
  kind: 'route' | 'mail';
}

const CategoryIntro = ({ intro, productHref }: Props) => {
  const actions = intro.actions.flatMap((a): ResolvedAction[] => {
    if ('products' in a.to) {
      const href = a.to.products.map(productHref).find(h => h !== null);
      return href ? [{ ...a, href, kind: 'route' as const }] : [];
    }
    if ('path' in a.to) return [{ ...a, href: a.to.path, kind: 'route' as const }];
    return [{ ...a, href: mailHref(a.to.mailSubject), kind: 'mail' as const }];
  });

  return (
    <section aria-labelledby="category-intro-title" className="mb-6 rounded-xl border border-primary/20 bg-primary/5 p-4 md:p-5">
      <h2 id="category-intro-title" className="text-base md:text-lg font-semibold mb-2">
        {intro.title}
      </h2>
      {intro.paragraphs.map(p => (
        <p key={p} className="text-sm text-muted-foreground leading-relaxed mb-2 max-w-3xl">
          {p}
        </p>
      ))}

      <div className="mt-3 flex flex-col sm:flex-row sm:flex-wrap gap-2">
        {actions.map((a, i) => (
          <Button
            key={a.label}
            asChild
            size="sm"
            variant={i === 0 ? 'default' : 'outline'}
            className="h-auto min-h-9 py-2 whitespace-normal text-left justify-start sm:justify-center"
          >
            {a.kind === 'mail' ? (
              <a href={a.href}>
                <Mail className="h-4 w-4" />
                {a.label}
              </a>
            ) : (
              <Link to={a.href}>
                <span>
                  {a.label}
                  {a.hint && <span className="block text-xs font-normal opacity-80">{a.hint}</span>}
                </span>
              </Link>
            )}
          </Button>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{responseTimePromise}</p>

      <details className="mt-3">
        <summary className="cursor-pointer text-sm font-medium text-primary">{intro.details.summary}</summary>
        <dl className="mt-2 space-y-2 text-sm max-w-3xl">
          {intro.details.items.map(item => (
            <div key={item.label}>
              <dt className="font-medium">{item.label}</dt>
              <dd className="text-muted-foreground leading-relaxed">{item.text}</dd>
            </div>
          ))}
        </dl>
      </details>

      <p className="mt-3 text-xs text-muted-foreground">
        Fuentes:{' '}
        {intro.sources.links.map((s, i) => (
          <span key={s.href}>
            {i > 0 && ' y '}
            <a href={s.href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-primary">
              {s.label}
            </a>
          </span>
        ))}
        , revisadas el {intro.sources.reviewed}.
      </p>
    </section>
  );
};

export default CategoryIntro;
