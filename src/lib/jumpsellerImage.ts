// src/lib/jumpsellerImage.ts
// Fotos de producto en tamaño reducido desde el CDN de imágenes de Jumpseller
// (mismo formato que usa el tema de elights.cl). Entrega WebP del tamaño pedido:
// una foto original de 9 MB baja a ~14 KB a 400 px.
//   resize: encaja la foto completa en un cuadrado (sin recortar) → tarjetas y ficha
//   thumb:  recorta para llenar el cuadrado → miniaturas
// La primera petición de cada tamaño tarda 2–6 s; luego queda en caché del CDN.
// Sin id de imagen (datos viejos en la sesión) se usa la URL original.

const CDN = 'https://cdnx.jumpseller.com/elights-cl/image';

export type ImageMode = 'resize' | 'thumb';
export type ImageRef = { id?: number; url: string } | string | undefined | null;

/** URL original. Corrige strings viejos con varias URLs unidas por comas. */
export function originalImage(ref: ImageRef): string {
  const url = typeof ref === 'string' ? ref : ref?.url ?? '';
  return url.split(/,(?=https?:\/\/)/)[0];
}

/** URL del CDN al ancho pedido (px); la original si no hay id de imagen. */
export function jsImage(ref: ImageRef, width: number, mode: ImageMode = 'resize'): string {
  const url = originalImage(ref);
  const id = typeof ref === 'object' && ref ? ref.id : undefined;
  if (!id) return url;
  const version = url.match(/\?(\d+)$/)?.[1];
  return `${CDN}/${id}/${mode}/${width}/${width}${version ? `?${version}` : ''}`;
}

/** srcSet con varios anchos (undefined si no hay id de imagen). */
export function jsSrcSet(ref: ImageRef, widths: number[], mode: ImageMode = 'resize'): string | undefined {
  if (!(typeof ref === 'object' && ref?.id)) return undefined;
  return widths.map(w => `${jsImage(ref, w, mode)} ${w}w`).join(', ');
}

/** Lo mínimo de un <img> que se necesita (sin depender de los tipos del DOM: lo usan scripts/). */
interface ImgLike {
  src: string;
  dataset: Record<string, string | undefined>;
  removeAttribute(name: string): void;
}

/**
 * onError para <img>: si falla el CDN, reintenta una vez con la foto original;
 * si también falla, llama a onFinalError.
 */
export function fallbackToOriginal(ref: ImageRef, onFinalError?: () => void) {
  return (e: { currentTarget: ImgLike }) => {
    const img = e.currentTarget;
    const original = originalImage(ref);
    if (img.dataset.fallback !== '1' && original && img.src !== original) {
      img.dataset.fallback = '1';
      img.removeAttribute('srcset');
      img.src = original;
      return;
    }
    onFinalError?.();
  };
}
