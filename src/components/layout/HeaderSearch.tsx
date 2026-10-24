// src/components/layout/HeaderSearch.tsx
// Buscador del encabezado (desde md) con sugerencias mientras se escribe (pedido del dueño,
// 2026-10-24: «como la caja de búsqueda de Amazon»):
// - Desde 2 caracteres, bajo la caja, hasta 6 productos (foto, nombre con lo escrito en negrita,
//   SKU y precio según el modo B2C/B2B) y «Ver los N resultados», que abre /buscar. Sin
//   resultados, la última fila también lleva a /buscar, que ofrece el correo a ventas.
// - El catálogo y el índice se cargan aparte (headerSearchEngine, con import() al acercarse o
//   entrar a la caja): el encabezado va en todas las páginas y la primera carga no crece.
// - Patrón combobox de ARIA: flechas para recorrer, Enter para abrir la fila marcada (sin ninguna
//   marcada, /buscar como antes), Escape para cerrar. Las filas no son enlaces (dentro de un
//   option no va nada que reciba el foco): se abren con clic o Enter.
// - Medición (search, KPI 9): como en /buscar, una vez cuando el texto queda quieto, o antes si
//   se elige un producto. Si después se abre /buscar con la misma búsqueda, va con
//   HEADER_MEASURED_STATE y no se cuenta dos veces.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Search, Zap } from 'lucide-react';
import type { Product } from '@/data/catalog/types';
import { useApp } from '@/context/AppContext';
import { trackSearch } from '@/lib/analytics';
import { claimSearch, HEADER_MEASURED_STATE, SEARCH_SETTLE_MS } from '@/lib/searchTracking';
import { fallbackToOriginal, jsImage } from '@/lib/jumpsellerImage';
import { cn } from '@/lib/utils';

type Engine = typeof import('@/lib/headerSearchEngine');

/** Caracteres desde los que se sugiere. */
const MIN_CHARS = 2;
/** Productos que se muestran bajo la caja. */
const MAX_SUGGESTIONS = 6;
const LISTBOX_ID = 'header-search-suggestions';
const optionId = (i: number) => `${LISTBOX_ID}-${i}`;

let enginePromise: Promise<Engine> | undefined;
const loadEngine = () => (enginePromise ??= import('@/lib/headerSearchEngine'));

/** Miniatura de la fila: la foto en el tamaño de las miniaturas de la solicitud. */
const Thumb = ({ product }: { product: Product }) => {
  const [failed, setFailed] = useState(false);
  const ref = product.imageRefs?.[0] ?? product.images?.[0];
  const src = jsImage(ref, 200, 'thumb');
  return (
    <span className="h-11 w-11 shrink-0 rounded-md border bg-surface flex items-center justify-center overflow-hidden">
      {src && !failed ? (
        <img src={src} alt="" width={44} height={44} className="h-full w-full object-contain" onError={fallbackToOriginal(ref, () => setFailed(true))} />
      ) : (
        <Zap className="h-5 w-5 text-primary/30" aria-hidden="true" />
      )}
    </span>
  );
};

const HeaderSearch = () => {
  const { formatDisplayPrice, isB2B } = useApp();
  const navigate = useNavigate();
  const { key: navKey, pathname } = useLocation();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [engine, setEngine] = useState<Engine | null>(null);
  const [focused, setFocused] = useState(false);
  /** La búsqueda (sus palabras) que ya midieron las sugerencias. */
  const measured = useRef('');

  const warmUp = () => {
    if (!engine) loadEngine().then(setEngine, () => { enginePromise = undefined; });
  };

  // Otra página: la lista se cierra y la caja queda vacía (como al buscar con Enter)
  useEffect(() => {
    setOpen(false);
    setActive(-1);
    setQuery('');
    measured.current = '';
  }, [navKey]);

  const term = query.trim();
  const ready = engine !== null && term.length >= MIN_CHARS;
  const results = useMemo(() => (ready ? engine.searchProducts(engine.products, query) : []), [ready, engine, query]);
  const searchKey = useMemo(() => (ready ? engine.searchWords(query).join(' ') : ''), [ready, engine, query]);
  const shown = results.slice(0, MAX_SUGGESTIONS);
  const visible = open && ready;
  /** Las filas: los productos y, al final, la de /buscar. */
  const rows = shown.length + 1;

  const measure = () => {
    if (!searchKey || measured.current === searchKey) return;
    measured.current = searchKey;
    if (claimSearch(navKey, searchKey)) trackSearch(results.length, pathname);
  };

  // La fila marcada con las flechas, siempre a la vista (la lista se desplaza en pantallas bajas)
  useEffect(() => {
    if (visible && active >= 0) document.getElementById(optionId(active))?.scrollIntoView?.({ block: 'nearest' });
  }, [visible, active]);

  useEffect(() => {
    if (!visible || !searchKey) return;
    const timer = window.setTimeout(measure, SEARCH_SETTLE_MS);
    return () => window.clearTimeout(timer);
    // measure lee lo mismo que estas dependencias
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, searchKey, navKey, results.length, pathname]);

  const goToSearch = () => {
    if (!term) return;
    const state = searchKey && measured.current === searchKey ? HEADER_MEASURED_STATE : undefined;
    navigate(`/buscar?q=${encodeURIComponent(term)}`, state ? { state } : undefined);
    setQuery('');
    setOpen(false);
  };

  const choose = (i: number) => {
    if (i < shown.length) {
      measure();
      navigate(`/producto/${shown[i].id}`);
      setQuery('');
      setOpen(false);
    } else {
      goToSearch();
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!ready) return;
      e.preventDefault();
      if (!open) {
        setOpen(true);
        setActive(e.key === 'ArrowDown' ? 0 : rows - 1);
        return;
      }
      setActive(a => (e.key === 'ArrowDown' ? (a + 1) % rows : a <= 0 ? rows - 1 : a - 1));
    } else if (e.key === 'Enter' && visible && active >= 0) {
      e.preventDefault();
      choose(active);
    } else if (e.key === 'Escape') {
      if (visible) {
        e.preventDefault();
        setOpen(false);
        setActive(-1);
      } else if (query) {
        setQuery('');
      }
    }
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    goToSearch();
  };

  const n = results.length;
  const status = !visible ? '' : n ? `${n} resultado${n !== 1 ? 's' : ''}. Usa las flechas para recorrerlos.` : `No encontramos productos para «${term}».`;

  return (
    <form onSubmit={onSubmit} role="search" className="flex-1 min-w-[15rem] max-w-xl hidden md:flex">
      <div className="relative w-full">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <input
          type="text"
          role="combobox"
          aria-label="Buscar productos"
          aria-autocomplete="list"
          aria-expanded={visible}
          aria-controls={LISTBOX_ID}
          aria-activedescendant={visible && active >= 0 ? optionId(active) : undefined}
          autoComplete="off"
          value={query}
          onChange={e => {
            setQuery(e.target.value);
            setOpen(true);
            setActive(-1);
            warmUp();
          }}
          onFocus={() => {
            warmUp();
            setFocused(true);
            if (term) setOpen(true);
          }}
          onPointerEnter={warmUp}
          onBlur={() => {
            setFocused(false);
            setOpen(false);
          }}
          onKeyDown={onKeyDown}
          placeholder="Buscar por SKU, producto, watts, kelvin..."
          className="w-full pl-10 pr-4 py-2.5 border rounded-lg text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
        />
        {/* Cuántos resultados hay, para el lector de pantalla. Solo con la caja enfocada: el panel
            del menú del teléfono (Radix) deja visibles las regiones vivas de la página, y una en el
            encabezado le haría esconder cada botón por separado en vez del encabezado entero. */}
        {focused && <p role="status" className="sr-only">{status}</p>}
        {/* Siempre en el DOM (aria-controls apunta aquí); vacío y oculto mientras no hay sugerencias.
            mousedown sin efecto: el clic no le quita el foco a la caja antes de elegir. */}
        <ul
          id={LISTBOX_ID}
          role="listbox"
          aria-label="Sugerencias de búsqueda"
          hidden={!visible}
          onMouseDown={e => e.preventDefault()}
          className="absolute left-0 right-0 top-full mt-1 z-50 bg-background border rounded-lg shadow-xl pt-1 max-h-[70vh] overflow-y-auto"
        >
          {visible && shown.map((p, i) => {
            const from = engine.variantFromPrice(p);
            return (
              <li
                key={p.id}
                id={optionId(i)}
                role="option"
                aria-selected={active === i}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(i)}
                className={cn('flex items-center gap-3 px-3 py-2 cursor-pointer scroll-mb-12', active === i && 'bg-accent')}
              >
                <Thumb product={p} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm leading-snug line-clamp-2">
                    {engine.highlightMatches(p.name, query).map((part, k) =>
                      part.match ? <strong key={k} className="font-semibold text-foreground">{part.text}</strong> : <span key={k} className="text-foreground/80">{part.text}</span>,
                    )}
                  </span>
                  {p.sku && <span className="block text-[11px] font-mono text-muted-foreground">{p.sku}</span>}
                </span>
                <span className="shrink-0 text-right">
                  {from !== undefined && <span className="block text-[10px] text-muted-foreground">desde</span>}
                  <span className="block text-sm font-semibold tabular-nums">{formatDisplayPrice(from ?? p.price)}</span>
                  <span className="block text-[10px] text-muted-foreground">{isB2B ? 'neto' : 'c/IVA'}</span>
                </span>
              </li>
            );
          })}
          {visible && (
            <li
              id={optionId(shown.length)}
              role="option"
              aria-selected={active === shown.length}
              onMouseEnter={() => setActive(shown.length)}
              onClick={() => choose(shown.length)}
              // Pegada abajo: en pantallas bajas la lista se desplaza y esta fila queda siempre a la vista
              className={cn(
                'sticky bottom-0 px-3 py-2.5 text-sm cursor-pointer border-t',
                shown.length === 0 && 'border-t-0',
                active === shown.length ? 'bg-accent' : 'bg-background',
              )}
            >
              {n > 0 ? (
                <span className="font-semibold text-primary">
                  Ver {n === 1 ? 'el resultado' : `los ${n} resultados`} para «{term}»
                </span>
              ) : (
                <span>
                  No encontramos productos para «{term}». <span className="font-semibold text-primary">Ver otras opciones</span>
                </span>
              )}
            </li>
          )}
        </ul>
      </div>
    </form>
  );
};

export default HeaderSearch;
