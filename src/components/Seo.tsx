// src/components/Seo.tsx
// Etiquetas para buscadores y vistas previas de enlaces (WhatsApp, Facebook, X) de
// una página: título, descripción, canonical, robots, Open Graph, Twitter y JSON-LD.
// Las páginas noindex no llevan canonical.
//
// En el navegador, <Helmet> se dibuja recién después de que el componente se monta.
// Helmet registra cada <Helmet> durante el render, y si React descarta ese render queda
// registrado para siempre: sus etiquetas aparecían en las páginas siguientes. Pasa al
// hidratar una página estática (React hidrata el contenido con baja prioridad y vuelve a
// empezar cuando llega otra actualización). El HTML estático ya trae las etiquetas.

import { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { absoluteUrl, SITE_NAME } from '@/config/site';
import { serializeJsonLd, type JsonLd } from '@/lib/seo/jsonld';
import { DEFAULT_OG, ogImageUrl, type OgImage } from '@/lib/seo/ogImage';

export interface SeoProps {
  title: string;
  description: string;
  /** Ruta canónica ('/catalogo/paneles-led', con ?page=N solo si N > 1). Se ignora con noindex. */
  path?: string;
  noindex?: boolean;
  /**
   * Imagen para compartir (solo la ficha de producto la pasa: productOgImage). Por defecto,
   * el JPEG de la marca (DEFAULT_OG), con sus medidas.
   */
  image?: OgImage;
  type?: 'website' | 'product';
  jsonLd?: JsonLd[];
}

const isServer = typeof window === 'undefined';

/** En el servidor, siempre; en el navegador, desde que el componente se montó. */
function useMounted() {
  const [mounted, setMounted] = useState(isServer);
  useEffect(() => setMounted(true), []);
  return mounted;
}

const Seo = ({ title, description, path, noindex = false, image, type = 'website', jsonLd = [] }: SeoProps) => {
  const mounted = useMounted();
  if (!mounted) return null;
  const url = path && !noindex ? absoluteUrl(path) : undefined;
  const img = image ?? DEFAULT_OG;
  // Absoluta y codificada (una foto con tildes en el nombre): og:image y twitter:image iguales
  const ogImage = ogImageUrl(img);
  const sized = !!(img.width && img.height);
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
      {sized && <meta property="og:image:width" content={String(img.width)} />}
      {sized && <meta property="og:image:height" content={String(img.height)} />}
      <meta property="og:image:alt" content={img.alt} />
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
