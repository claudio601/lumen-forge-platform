import { Suspense, useEffect, type ReactNode } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BrowserRouter, useLocation } from "react-router-dom";
import { AppProvider } from "@/context/AppContext";
import { RequestCartProvider } from "@/context/RequestCartContext";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import WhatsAppButton from "@/components/WhatsAppButton";
import { sendPageView } from "@/lib/analytics";
import { AppRoutes } from "./routes";

// Componente interno que trackea cambios de ruta en la SPA.
// Debe estar dentro del router para usar useLocation.
function RouteTracker() {
  const location = useLocation();
  useEffect(() => {
    sendPageView(location.pathname + location.search);
  }, [location]);
  return null;
}

/** Proveedores de estado (fuera del router). Los comparten el navegador y el prerender. */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider>
      <AppProvider>
        <RequestCartProvider>
          <Toaster />
          {children}
        </RequestCartProvider>
      </AppProvider>
    </TooltipProvider>
  );
}

/**
 * Todo lo que va dentro del router. onMounted corre una vez, después del primer render
 * (en una página estática, después de hidratarla).
 */
export function AppLayout({ onMounted }: { onMounted?: () => void }) {
  useEffect(() => {
    onMounted?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <>
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
            <AppRoutes />
          </Suspense>
        </main>
        <Footer />
        <WhatsAppButton />
      </div>
    </>
  );
}

const App = ({ onMounted }: { onMounted?: () => void }) => (
  <AppProviders>
    <BrowserRouter>
      <AppLayout onMounted={onMounted} />
    </BrowserRouter>
  </AppProviders>
);

export default App;
