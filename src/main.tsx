import { HelmetProvider } from 'react-helmet-async';
import { createRoot, hydrateRoot } from "react-dom/client";
import "@fontsource/space-grotesk/400.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/600.css";
import "@fontsource/space-grotesk/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import App from "./App.tsx";
import { staticPage } from "./routes";
import { retryBrokenImages } from "./lib/brokenImages";
import "./index.css";

const container = document.getElementById("root")!;

if (container.firstElementChild) {
  // Página estática (scripts/prerender.ts): se precargan el trozo de la página y sus datos
  // para que el primer render sea igual al HTML, y React lo reutiliza en vez de redibujarlo.
  // Si el HTML es 404.html, se hidrata la página "no encontrada" en esta URL.
  const { notFoundPath, preload } = staticPage(container, window.location.pathname);
  preload
    .catch(() => undefined) // sin red, la página suspende y se hidrata cuando llegue
    .then(() => {
      hydrateRoot(
        container,
        <HelmetProvider>
          <App onMounted={() => retryBrokenImages(container)} notFoundPath={notFoundPath} />
        </HelmetProvider>,
      );
    });
} else {
  // Páginas que dependen de la sesión o de la búsqueda (spa.html) y el servidor de desarrollo
  createRoot(container).render(
    <HelmetProvider>
      <App />
    </HelmetProvider>,
  );
}
