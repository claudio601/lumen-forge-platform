import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode, isSsrBuild }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  build: {
    // Mapa de archivos fuente → trozos de JS: scripts/prerender.ts lo usa para precargar
    // el trozo de cada página estática (y lo borra de dist/ al terminar).
    manifest: !isSsrBuild,
  },
  ssr: {
    // Solo trae CommonJS para Node (sin exportaciones con nombre): se incluye en el
    // build del servidor desde su versión ESM.
    noExternal: ["react-helmet-async"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
