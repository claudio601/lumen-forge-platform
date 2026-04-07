import { useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { AppProvider } from "@/context/AppContext";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import WhatsAppButton from "@/components/WhatsAppButton";
import Index from "./pages/Index";
import CatalogPage from "./pages/CatalogPage";
import ProductDetail from "./pages/ProductDetail";
import SearchPage from "./pages/SearchPage";
import CartPage from "./pages/CartPage";
import QuoteCartPage from "./pages/QuoteCartPage";
import SmartQuotePage from "./pages/SmartQuotePage";
import InstallerAreaPage from "./pages/InstallerAreaPage";
import InstalacionPage from "./pages/InstalacionPage";
import NotFound from "./pages/NotFound";
import { sendPageView } from "@/lib/analytics";

const queryClient = new QueryClient();

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
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <AppProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <RouteTracker />
          <div className="min-h-screen flex flex-col">
            <Header />
            <main className="flex-1">
              <Routes>
                <Route path="/" element={<Index />} />
                <Route path="/catalogo" element={<CatalogPage />} />
                <Route path="/catalogo/:categorySlug" element={<CatalogPage />} />
                <Route path="/catalogo/:categorySlug/:subSlug" element={<CatalogPage />} />
                <Route path="/producto/:id" element={<ProductDetail />} />
                <Route path="/buscar" element={<SearchPage />} />
                <Route path="/carro" element={<CartPage />} />
                <Route path="/cotizacion" element={<QuoteCartPage />} />
                <Route path="/cotizador" element={<SmartQuotePage />} />
                <Route path="/instaladores" element={<InstallerAreaPage />} />
                <Route path="/instalacion" element={<InstalacionPage />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </main>
            <Footer />
            <WhatsAppButton />
          </div>
        </BrowserRouter>
      </AppProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
