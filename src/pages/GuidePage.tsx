// /guias/<slug>: una guía (plan del blog, §5.3 y §5.4). Etiquetas para Google con el título
// «<metaTitle> | eLIGHTS», la imagen de la marca (DEFAULT_OG), og:type article y JSON-LD Article
// + BreadcrumbList (sin FAQPage). Una guía «publicada sin indexar» (index: false, §2.2) lleva
// noindex en su HTML. Un slug desconocido muestra la página "no encontrada"; en Vercel, sin
// archivo prerenderizado, esa URL recibe 404.html.

import { useParams } from 'react-router-dom';
import Seo from '@/components/Seo';
import GuideLayout from '@/components/guides/GuideLayout';
import { GUIDE_AUTHORS, guideCrumbs, guideMeta, guideTitle } from '@/data/guides/index';
import { guidePath } from '@/data/guides/paths';
import { readGuideContent } from '@/data/guides/content';
import { articleJsonLd, breadcrumbJsonLd } from '@/lib/seo/jsonld';
import { DEFAULT_OG, ogImageUrl } from '@/lib/seo/ogImage';
import NotFound from './NotFound';

const GuidePage = () => {
  const { slug = '' } = useParams();
  const meta = guideMeta(slug);
  // Suspende hasta que llega el cuerpo (en una página estática ya viene precargado)
  const content = readGuideContent(slug);
  if (!meta || !content) return <NotFound />;
  const path = guidePath(meta.slug);
  const author = GUIDE_AUTHORS[meta.author];
  return (
    <>
      <Seo
        title={guideTitle(meta)}
        description={meta.metaDescription}
        path={path}
        noindex={!meta.index}
        type="article"
        jsonLd={[
          breadcrumbJsonLd(guideCrumbs(meta)),
          articleJsonLd({
            headline: meta.h1,
            description: meta.metaDescription,
            path,
            datePublished: meta.datePublished,
            dateModified: meta.dateModified,
            author: { name: author.name, path: author.path },
            image: ogImageUrl(DEFAULT_OG),
          }),
        ]}
      />
      <GuideLayout meta={meta} content={content} />
    </>
  );
};

export default GuidePage;
