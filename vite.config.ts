import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// Dev-only: forwards uncaught runtime errors and unhandled promise rejections
// to Vite's built-in error overlay.
function runtimeErrorOverlay(): Plugin {
  return {
    name: "local-runtime-error-overlay",
    apply: "serve",
    transformIndexHtml() {
      return [
        {
          tag: "script",
          attrs: { type: "module" },
          children: `
            function showErrorOverlay(err) {
              const ErrorOverlay = customElements.get("vite-error-overlay");
              if (!ErrorOverlay) return;
              const error = err instanceof Error ? err : new Error(String(err ?? "Unknown runtime error"));
              document.body.appendChild(new ErrorOverlay(error));
            }
            window.addEventListener("error", (e) => showErrorOverlay(e.error ?? e.message));
            window.addEventListener("unhandledrejection", (e) => showErrorOverlay(e.reason));
          `,
        },
      ];
    },
  };
}

export default defineConfig({
  plugins: [react(), runtimeErrorOverlay()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  // Keep one copy of maplibre-gl so setWorkerUrl() (map-demo.tsx) reaches the instance the Leaflet plugin uses.
  optimizeDeps: { exclude: ["maplibre-gl"] },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
