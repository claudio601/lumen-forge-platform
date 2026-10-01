// src/components/Seo.tsx
// Etiquetas para buscadores y vistas previas de enlaces (WhatsApp, Facebook, X) de
// una página: título, descripción, canonical, robots, Open Graph, Twitter y JSON-LD.
// Las páginas noindex no llevan canonical.

import { Helmet } from 'react-helmet-async';
import { absoluteUrl, DEFAULT_OG_IMAGE, SITE_NAME } from '@/config/site';
import { serializeJsonLd, type JsonLd } from '@/lib/seo/jsonld';

export interface SeoProps {
  title: string;
  description: string;
  /** Ruta canónica ('/catalogo/paneles-led', con ?page=N solo si N > 1). Se ignora con noindex. */
  path?: string;
  noindex?: boolean;
  /** Imagen para compartir (ruta del sitio o URL absoluta). Por defecto, el PNG de la marca. */
  image?: string;
  type?: 'website' | 'product';
  jsonLd?: JsonLd[];
}

const Seo = ({ title, description, path, noindex = false, image, type = 'website', jsonLd = [] }: SeoProps) => {
  const url = path && !noindex ? absoluteUrl(path) : undefined;
  const ogImage = absoluteUrl(image || DEFAULT_OG_IMAGE);
  return (
    <Helmet>
      <title>{title}</title>
      <meta name="description" content={description} />
      {noindex && <meta name="robots" content="noindex, follow" />}
      {url && <link rel="canonical" href={url} />}
      <meta property="og:site_name" content={SITE_NAME} />
      <meta property="og:locale" content="es_CL" />
      <meta property="og:type" content={type} />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      {url && <meta property="og:url" content={url} />}
      <meta property="og:image" content={ogImage} />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={ogImage} />
      {jsonLd.map((data, i) => (
        <script key={i} type="application/ld+json">
          {serializeJsonLd(data)}
        </script>
      ))}
    </Helmet>
  );
};

export default Seo;
