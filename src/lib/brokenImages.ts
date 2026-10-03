// src/lib/brokenImages.ts
// En una página estática las fotos empiezan a cargar antes que el JS. Si una falla antes
// de que React hidrate la página, React todavía no escuchaba su evento "error" y el
// respaldo a la foto original (fallbackToOriginal) nunca corre. Después de hidratar se
// les vuelve a enviar el evento.

const CDN = 'https://cdnx.jumpseller.com/';

/** Reenvía "error" a las fotos del CDN que ya terminaron sin poder dibujarse. */
export function retryBrokenImages(root: ParentNode = document): number {
  let retried = 0;
  for (const img of root.querySelectorAll<HTMLImageElement>(`img[src^="${CDN}"]`)) {
    if (img.complete && img.naturalWidth === 0) {
      img.dispatchEvent(new Event('error'));
      retried++;
    }
  }
  return retried;
}
