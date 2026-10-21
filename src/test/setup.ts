import "@testing-library/jest-dom";

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});

// jsdom no implementa scrollIntoView (CatalogPage lo usa al cambiar de página).
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

// jsdom tampoco implementa window.scrollTo (solo avisa "Not implemented"). ScrollToTop lo
// llama al abrir una página con un enlace; las pruebas que lo revisan lo espían.
Object.defineProperty(window, "scrollTo", { value: () => {}, writable: true, configurable: true });
