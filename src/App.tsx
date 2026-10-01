import { lazy, Suspense, useEffect } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BrowserRouter, Routes, Route, Navigate, useLocation, useParams } from "react-router-dom";
import { AppProvider } from "@/context/AppContext";
import { RequestCartProvider } from "@/context/RequestCartContext";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import WhatsAppButton from "@/components/WhatsAppButton";
import { sendPageView } from "@/lib/analytics";

const Index = lazy(() => import("./pages/Index"));
const CatalogPage = lazy(() => import("./pages/CatalogPage"));
const ProductDetail = lazy(() => import("./pages/ProductDetail"));
const SearchPage = lazy(() => import("./pages/SearchPage"));
const QuoteCartPage = lazy(() => import("./pages/QuoteCartPage"));
const SmartQuotePage = lazy(() => import("./pages/SmartQuotePage"));
const InstallerAreaPage = lazy(() => import("./pages/InstallerAreaPage"));
const InstalacionPage = lazy(() => import("./pages/InstalacionPage"));
const EstudioLuminicoPage = lazy(() => import("./pages/EstudioLuminicoPage"));
const RequestOrderPage = lazy(() => import("./pages/RequestOrderPage"));
const NotFound = lazy(() => import("./pages/NotFound"));


// El estado de filtros de CatalogPage se inicializa desde la URL. Al navegar entre
// categorías (mismo componente, otra URL) hay que remontarlo para no arrastrar
// el filtro anterior. Lo mismo para la ficha de producto al saltar entre productos.
function CatalogRoute() {
  const { pathname } = useLocation();
  return <CatalogPage key={pathname} />;
}

function ProductRoute() {
  const { id } = useParams();
  return <ProductDetail key={id} />;
}

// Componente interno que trackea cambios de ruta en la SPA.
// Debe estar dentro de BrowserRouter para usar useLocation.
function RouteTracker() {
  const location = useLocation();
  useEffect(() => {
    sendPageView(location.pathname + location.search);
  }, [location]);
  return null;
}

const App = () => (
    <TooltipProvider>
      <AppProvider>
        <RequestCartProvider>
          <Toaster />
          <BrowserRouter>
            <RouteTracker />
            <div className="min-h-screen flex flex-col">
              <Header />
              <main className="flex-1">
                <Suspense
                  fallback={
                    <div className="min-h-screen flex items-center justify-center">
                      <div className="animate-spin h-8 w-8 border-4 border-violet-600 border-t-transparent rounded-full" />
                    </div>
                  }
                >
                  <Routes>
                    <Route path="/" element={<Index />} />
                    <Route path="/catalogo" element={<CatalogRoute />} />
                    <Route path="/catalogo/:categorySlug" element={<CatalogRoute />} />
                    <Route path="/producto/:id" element={<ProductRoute />} />
                    <Route path="/buscar" element={<SearchPage />} />
                    {/* Modelo cotización → link de pago: el carro con checkout ya no existe */}
                    <Route path="/carro" element={<Navigate to="/solicitar-pedido" replace />} />
                    <Route path="/cotizacion" element={<QuoteCartPage />} />
                    <Route path="/cotizador" element={<SmartQuotePage />} />
                    <Route path="/instaladores" element={<InstallerAreaPage />} />
                    <Route path="/instalacion" element={<InstalacionPage />} />
                    <Route path="/estudio-luminico" element={<EstudioLuminicoPage />} />
                    <Route path="/solicitar-pedido" element={<RequestOrderPage />} />
                    <Route path="*" element={<NotFound />} />
                  </Routes>
                </Suspense>
              </main>
              <Footer />
              <WhatsAppButton />
            </div>
          </BrowserRouter>
        </RequestCartProvider>
      </AppProvider>
    </TooltipProvider>
);

export default App;
