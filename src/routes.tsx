// src/routes.tsx
// Tabla única de rutas: la usan la app en el navegador (App.tsx) y las páginas estáticas
// (entry-server.tsx + scripts/prerender.ts). Cada página es un trozo de JS aparte. Antes
// de dibujar una página estática se precargan su trozo y sus datos (preloadRoute), así
// el render del servidor y el primer render del navegador no suspenden y salen iguales.

import { lazy, type ComponentType, type ReactElement } from 'react';
import { matchRoutes, Navigate, useLocation, useParams, useRoutes, type Params, type RouteObject } from 'react-router-dom';
import { NOT_FOUND_ATTR, NOT_FOUND_URL } from './lib/notFound';

type PageModule = { default: ComponentType };

export interface LazyPage {
  (): ReactElement;
  /** Descarga el trozo de la página; desde ahí se dibuja sin suspender. */
  preload(): Promise<void>;
  /** Archivo fuente, para precargar el trozo desde el HTML estático (modulepreload). */
  file: string;
}

/**
 * Página en su propio trozo de JS. Como React.lazy, pero si el trozo ya se precargó se
 * dibuja de inmediato (React.lazy suspende siempre en el primer render).
 */
function lazyPage(name: string, load: () => Promise<PageModule>): LazyPage {
  let Loaded: ComponentType | undefined;
  const keep = (m: PageModule) => {
    Loaded = m.default;
    return m;
  };
  const Lazy = lazy(() => load().then(keep));
  const Page = () => {
    const C = Loaded ?? Lazy;
    return <C />;
  };
  return Object.assign(Page, { preload: () => load().then(keep).then(() => undefined), file: `src/pages/${name}.tsx` });
}

const pages = {
  Index: lazyPage('Index', () => import('./pages/Index')),
  CatalogPage: lazyPage('CatalogPage', () => import('./pages/CatalogPage')),
  ProductDetail: lazyPage('ProductDetail', () => import('./pages/ProductDetail')),
  SearchPage: lazyPage('SearchPage', () => import('./pages/SearchPage')),
  QuoteCartPage: lazyPage('QuoteCartPage', () => import('./pages/QuoteCartPage')),
  SmartQuotePage: lazyPage('SmartQuotePage', () => import('./pages/SmartQuotePage')),
  InstallerAreaPage: lazyPage('InstallerAreaPage', () => import('./pages/InstallerAreaPage')),
  InstalacionPage: lazyPage('InstalacionPage', () => import('./pages/InstalacionPage')),
  EstudioLuminicoPage: lazyPage('EstudioLuminicoPage', () => import('./pages/EstudioLuminicoPage')),
  RequestOrderPage: lazyPage('RequestOrderPage', () => import('./pages/RequestOrderPage')),
  NotFound: lazyPage('NotFound', () => import('./pages/NotFound')),
};

// El estado de filtros de CatalogPage se inicializa desde la URL. Al navegar entre
// categorías (mismo componente, otra URL) hay que remontarlo para no arrastrar
// el filtro anterior. Lo mismo para la ficha de producto al saltar entre productos.
function CatalogRoute() {
  const { pathname } = useLocation();
  return <pages.CatalogPage key={pathname} />;
}

function ProductRoute() {
  const { id } = useParams();
  return <pages.ProductDetail key={id} />;
}

/** Contenido SEO de la ficha (un trozo por producto). Devuelve el archivo precargado. */
async function preloadProduct({ id }: Params): Promise<string[]> {
  const [{ products }, { hasProductContent, loadProductContent }] = await Promise.all([
    import('./data/products'),
    import('./data/catalog/content'),
  ]);
  const product = products.find(p => p.id === id);
  if (!product || !hasProductContent(product.jumpseller_id)) return [];
  await loadProductContent(product.jumpseller_id);
  return [`src/data/catalog/content/${product.jumpseller_id}.json`];
}

export interface AppRoute {
  path: string;
  element: ReactElement;
  /** Página que dibuja la ruta (no hay en las redirecciones). */
  page?: LazyPage;
  /** Datos que la página lee de forma síncrona en su primer render. Devuelve los archivos fuente cargados. */
  preload?: (params: Params) => Promise<string[]>;
}

const appRoutes: AppRoute[] = [
  { path: '/', element: <pages.Index />, page: pages.Index },
  { path: '/catalogo', element: <CatalogRoute />, page: pages.CatalogPage },
  { path: '/catalogo/:categorySlug', element: <CatalogRoute />, page: pages.CatalogPage },
  { path: '/producto/:id', element: <ProductRoute />, page: pages.ProductDetail, preload: preloadProduct },
  { path: '/buscar', element: <pages.SearchPage />, page: pages.SearchPage },
  // Modelo cotización → link de pago: el carro con checkout ya no existe
  { path: '/carro', element: <Navigate to="/solicitar-pedido" replace /> },
  { path: '/cotizacion', element: <pages.QuoteCartPage />, page: pages.QuoteCartPage },
  { path: '/cotizador', element: <pages.SmartQuotePage />, page: pages.SmartQuotePage },
  { path: '/instaladores', element: <pages.InstallerAreaPage />, page: pages.InstallerAreaPage },
  { path: '/instalacion', element: <pages.InstalacionPage />, page: pages.InstalacionPage },
  { path: '/estudio-luminico', element: <pages.EstudioLuminicoPage />, page: pages.EstudioLuminicoPage },
  { path: '/solicitar-pedido', element: <pages.RequestOrderPage />, page: pages.RequestOrderPage },
  { path: '*', element: <pages.NotFound />, page: pages.NotFound },
];

const routeObjects: RouteObject[] = appRoutes.map(({ path, element }) => ({ path, element }));

/**
 * Las rutas de la app. notFoundPath: URL en la que el servidor respondió con 404.html
 * (ver lib/notFound.ts); ahí se dibuja la página "no encontrada" aunque la URL coincida
 * con una ruta, igual que el HTML que llegó. Al navegar a otra URL, rutas normales.
 */
export function AppRoutes({ notFoundPath }: { notFoundPath?: string }) {
  const { pathname } = useLocation();
  const element = useRoutes(routeObjects);
  return pathname === notFoundPath ? <pages.NotFound /> : element;
}

/** La ruta que atiende una URL (siempre hay una: '*' atiende las desconocidas). */
function matchAppRoute(pathname: string): { route: AppRoute; params: Params } {
  const match = matchRoutes(routeObjects, pathname)![0];
  return { route: appRoutes[routeObjects.indexOf(match.route)], params: match.params };
}

/**
 * Precarga el trozo de la página y sus datos. Devuelve los archivos fuente cargados
 * (el prerender los vuelve <link rel="modulepreload">).
 */
export async function preloadRoute(pathname: string): Promise<string[]> {
  const { route, params } = matchAppRoute(pathname);
  const [, data] = await Promise.all([route.page?.preload(), route.preload?.(params)]);
  return [...(route.page ? [route.page.file] : []), ...(data ?? [])];
}

/**
 * Qué hidratar en una página estática (src/main.tsx). Si el HTML es 404.html (#root con
 * NOT_FOUND_ATTR), la página "no encontrada" en esa URL; si no, la ruta de la URL.
 * preload: el trozo y los datos que el primer render necesita para no suspender.
 */
export function staticPage(root: Element, pathname: string): { notFoundPath?: string; preload: Promise<string[]> } {
  const notFoundPath = root.hasAttribute(NOT_FOUND_ATTR) ? pathname : undefined;
  return { notFoundPath, preload: preloadRoute(notFoundPath ? NOT_FOUND_URL : pathname) };
}
