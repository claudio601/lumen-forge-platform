// src/components/layout/ScrollToTop.tsx
// Auditoría UX, B-01: una página que se abre con un enlace empieza arriba. Antes, una ficha
// abierta desde la última fila de un listado abría a media descripción (el scroll del listado).
//
// Solo reacciona a un cambio de pathname en una navegación PUSH (un enlace, navigate()):
// - Atrás y Adelante (POP): el navegador devuelve al punto donde estaba el visitante.
// - REPLACE: las redirecciones (/carro, ids renombrados) y los filtros del catálogo, que
//   reescriben ?page sin agregar una entrada al historial.
// - Mismo pathname con otro ?search o #: la paginación del catálogo sube a la grilla por su
//   cuenta (CatalogPage) y la búsqueda se queda donde está.
// Con #ancla, la página va al ancla si ya está dibujada; si no, arriba.
// Corre antes de pintar (sin un cuadro con el scroll anterior) y no hace nada en el servidor.

import { useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';
import { useIsomorphicLayoutEffect } from '@/lib/ssr';

function anchorTarget(hash: string): HTMLElement | null {
  if (hash.length < 2) return null;
  try {
    return document.getElementById(decodeURIComponent(hash.slice(1)));
  } catch {
    return null; // "#%E0": no es un id válido
  }
}

export default function ScrollToTop() {
  const { pathname, hash } = useLocation();
  const navigationType = useNavigationType();
  const shownPath = useRef(pathname);

  useIsomorphicLayoutEffect(() => {
    if (shownPath.current === pathname) return; // primera carga, o solo cambió ?search / #
    shownPath.current = pathname;
    if (navigationType !== 'PUSH') return;
    const target = anchorTarget(hash);
    if (target) target.scrollIntoView();
    else window.scrollTo(0, 0);
  }, [pathname, hash, navigationType]);

  return null;
}
