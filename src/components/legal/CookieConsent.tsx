// src/components/legal/CookieConsent.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Aviso de cookies y diálogo «Configurar cookies» (Etapa 2 · PR 13; PR 14: «Publicidad en
// Meta»). Se monta una vez, en AppLayout (App.tsx). Los textos y la decisión vienen de
// src/lib/cookieConsent.ts.
//
// Dónde se abre solo: en los dominios que miden (elights.cl y www, ver analytics.ts), en el
// modo de prueba de GTM (host de VITE_GTM_TEST_HOSTS con gtm_debug, solo en esa pestaña) y en
// los hosts de prueba de VITE_COOKIE_BANNER_HOSTS (solo Preview de Vercel; ahí muestra las
// categorías de Google y de Meta pero GTM no se carga). En los demás (nuevo.elights.cl,
// localhost) no se abre solo y el botón del pie abre un panel informativo: Necesarias, el
// interruptor del origen de la visita y «En esta dirección del sitio no usamos cookies…».
//
// Categorías: medición de visitas, medición de anuncios de Google y Publicidad en Meta. Las dos
// últimas requieren la primera (apagarla las apaga). «Aceptar» y «Aceptar cookies» encienden
// las tres; «Rechazar» y «Rechazar cookies» las apagan.
//
// Hidratación: devuelve null en el servidor y en el primer render del navegador. El modo se
// decide en un useEffect, nunca en un inicializador de useState (en el navegador React
// descartaría el HTML del servidor en la página de llegada).
//
// Sin overlay, sin bloquear el scroll, sin muro y sin X: cerrar no es decidir. No roba el
// foco. Rechazar y Aceptar son el mismo botón; Configurar es outline del mismo tamaño.
// En el teléfono va encima del botón de WhatsApp (fixed bottom-6 right-6 z-50); desde sm,
// abajo a la izquierda. Nada en el flujo de la página (sin CLS).
//
// Efectos de una decisión (de esta pestaña o de otra): si el visitante se opuso al origen de la
// visita, clearAttribution() (Rechazar no lo borra), y analytics.applyCookieChoice(). Retirar un
// permiso con GTM cargado recarga esta pestaña; desde otra pestaña, no (analytics.ts).
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { DialogDescription, DialogOverlay, DialogPortal, DialogTitle } from '@/components/ui/dialog';
import { analyticsAvailable, applyCookieChoice } from '@/lib/analytics';
import { clearAttribution } from '@/lib/attribution';
import {
  COOKIE_TEXTS as T,
  OPEN_COOKIE_SETTINGS_EVENT,
  bannerTestHost,
  getCookieChoice,
  isOriginOptedOut,
  setCookieChoice,
  subscribe,
  type CookieChoice,
} from '@/lib/cookieConsent';
import { cn } from '@/lib/utils';

type Mode = 'hidden' | 'banner' | 'settings';

/** Donde puede cargarse Google (o en un host de prueba del aviso): el aviso se abre solo. */
const googleHost = () => analyticsAvailable() || bannerTestHost();

/** Los interruptores al abrir el diálogo: la decisión vigente; sin ella, todo apagado salvo el origen. */
function savedDraft(): CookieChoice {
  const c = getCookieChoice();
  return { analytics: c?.analytics ?? false, ads: c?.ads ?? false, meta: c?.meta ?? false, origin: !isOriginOptedOut() };
}

/** Lo que encienden «Aceptar» y «Aceptar cookies», y lo que apagan los dos «Rechazar». */
const ALL_ON = { analytics: true, ads: true, meta: true } as const;
const ALL_OFF = { analytics: false, ads: false, meta: false } as const;

/** Rechazar y Aceptar llevan exactamente las mismas clases (y la misma variante). */
const DECIDE_CLASS = 'flex-1';

interface RowProps {
  id: string;
  title: string;
  text: string;
  children: ReactNode;
}

function CategoryRow({ id, title, text, children }: RowProps) {
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-center justify-between gap-3">
        <h3 id={`${id}-title`} className="text-sm font-semibold">
          {title}
        </h3>
        {children}
      </div>
      <p id={`${id}-text`} className="mt-1.5 text-xs leading-snug text-muted-foreground">
        {text}
      </p>
    </div>
  );
}

export default function CookieConsent() {
  const [mode, setMode] = useState<Mode>('hidden');
  const [google, setGoogle] = useState(false);
  const [draft, setDraft] = useState<CookieChoice>({ ...ALL_OFF, origin: true });
  const titleRef = useRef<HTMLHeadingElement>(null);
  const uid = useId();

  useEffect(() => {
    const g = googleHost();
    setGoogle(g);
    if (g && getCookieChoice() === null) setMode('banner');

    const onOpen = () => {
      setDraft(savedDraft());
      setMode('settings');
    };
    window.addEventListener(OPEN_COOKIE_SETTINGS_EVENT, onOpen);
    const unsubscribe = subscribe((choice, source) => {
      if (!choice) return;
      if (choice.origin === false) clearAttribution();
      applyCookieChoice(choice, { otherTab: source === 'other-tab' });
      // Decidió en otra pestaña: el aviso de esta se va
      setMode(m => (m === 'banner' ? 'hidden' : m));
    });
    return () => {
      window.removeEventListener(OPEN_COOKIE_SETTINGS_EVENT, onOpen);
      unsubscribe();
    };
  }, []);

  if (mode === 'hidden') return null;

  const decide = (choice: CookieChoice) => {
    setCookieChoice(choice);
    setMode('hidden');
  };
  // Aceptar y Rechazar conservan la oposición al origen, si la hay; Rechazar no lo apaga.
  const accept = () => decide({ ...ALL_ON, origin: !isOriginOptedOut() });
  const reject = () => decide({ ...ALL_OFF, origin: !isOriginOptedOut() });
  const openSettings = () => {
    setDraft(savedDraft());
    setMode('settings');
  };
  // Cerrar sin decidir: si no había decisión y este host abre el aviso solo, el aviso vuelve.
  const closeSettings = () => setMode(google && getCookieChoice() === null ? 'banner' : 'hidden');

  if (mode === 'banner') {
    return (
      <section
        role="region"
        aria-label={T.bannerLabel}
        className={cn(
          'fixed inset-x-3 bottom-[5.5rem] z-[60] max-h-[45vh] overflow-y-auto rounded-xl border bg-background p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] text-foreground shadow-lg',
          'sm:inset-x-auto sm:bottom-6 sm:left-6 sm:max-w-[26rem] sm:pb-4',
          'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-300',
        )}
      >
        <p className="text-sm leading-snug">
          {T.banner}{' '}
          <Link to={T.policyPath} target="_blank" rel="noopener noreferrer" className="text-primary underline">
            {T.policyLink}
          </Link>
        </p>
        <div className="mt-3 flex gap-2">
          <Button type="button" size="sm" className={DECIDE_CLASS} onClick={reject}>
            {T.reject}
          </Button>
          <Button type="button" size="sm" variant="outline" className={DECIDE_CLASS} onClick={openSettings}>
            {T.configure}
          </Button>
          <Button type="button" size="sm" className={DECIDE_CLASS} onClick={accept}>
            {T.accept}
          </Button>
        </div>
      </section>
    );
  }

  const ids = {
    necessary: `${uid}-necessary`,
    origin: `${uid}-origin`,
    analytics: `${uid}-analytics`,
    ads: `${uid}-ads`,
    meta: `${uid}-meta`,
  };
  const originSwitch = (
    <Switch
      checked={draft.origin}
      onCheckedChange={origin => setDraft(d => ({ ...d, origin }))}
      aria-labelledby={`${ids.origin}-title`}
      aria-describedby={`${ids.origin}-text`}
    />
  );

  return (
    <DialogPrimitive.Root open onOpenChange={open => !open && closeSettings()}>
      <DialogPortal>
        <DialogOverlay className="z-[70]" />
        <DialogPrimitive.Content
          onOpenAutoFocus={e => {
            // Al abrir, el foco va al título (no al primer interruptor ni a un botón de decisión)
            e.preventDefault();
            titleRef.current?.focus();
          }}
          className="fixed left-[50%] top-[50%] z-[70] grid max-h-[90vh] w-[calc(100%-1.5rem)] max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 overflow-y-auto rounded-lg border bg-background p-5 shadow-lg sm:p-6"
        >
          <div className="space-y-2 pr-6">
            <DialogTitle ref={titleRef} tabIndex={-1} className="focus:outline-none">
              {T.settingsTitle}
            </DialogTitle>
            <DialogDescription className="leading-snug">
              {google ? T.settingsDescription : T.settingsDescriptionNoGoogle}
            </DialogDescription>
          </div>

          <div className="space-y-3">
            <CategoryRow id={ids.necessary} title={T.necessaryTitle} text={T.necessaryText}>
              <span className="shrink-0 text-xs font-medium text-muted-foreground">{T.necessaryStatus}</span>
            </CategoryRow>
            <CategoryRow id={ids.origin} title={T.originTitle} text={T.originText}>
              {originSwitch}
            </CategoryRow>
            {google && (
              <>
                <CategoryRow id={ids.analytics} title={T.analyticsTitle} text={T.analyticsText}>
                  <Switch
                    checked={draft.analytics}
                    // Apagar la medición de visitas apaga también la de anuncios y Meta
                    onCheckedChange={analytics => setDraft(d => ({ ...d, analytics, ads: analytics && d.ads, meta: analytics && d.meta }))}
                    aria-labelledby={`${ids.analytics}-title`}
                    aria-describedby={`${ids.analytics}-text`}
                  />
                </CategoryRow>
                <CategoryRow id={ids.ads} title={T.adsTitle} text={T.adsText}>
                  <Switch
                    checked={draft.analytics && draft.ads}
                    disabled={!draft.analytics}
                    onCheckedChange={ads => setDraft(d => ({ ...d, ads: d.analytics && ads }))}
                    aria-labelledby={`${ids.ads}-title`}
                    aria-describedby={`${ids.ads}-text`}
                  />
                </CategoryRow>
                <CategoryRow id={ids.meta} title={T.metaTitle} text={T.metaText}>
                  <Switch
                    checked={draft.analytics && draft.meta}
                    disabled={!draft.analytics}
                    onCheckedChange={meta => setDraft(d => ({ ...d, meta: d.analytics && meta }))}
                    aria-labelledby={`${ids.meta}-title`}
                    aria-describedby={`${ids.meta}-text`}
                  />
                </CategoryRow>
              </>
            )}
          </div>

          {google ? (
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button type="button" size="sm" className={DECIDE_CLASS} onClick={() => decide({ ...draft, ...ALL_OFF })}>
                {T.rejectAll}
              </Button>
              <Button type="button" size="sm" variant="outline" className={DECIDE_CLASS} onClick={() => decide(draft)}>
                {T.save}
              </Button>
              <Button type="button" size="sm" className={DECIDE_CLASS} onClick={() => decide({ ...draft, ...ALL_ON })}>
                {T.acceptAll}
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button type="button" size="sm" className={DECIDE_CLASS} onClick={() => decide({ ...ALL_OFF, origin: draft.origin })}>
                {T.save}
              </Button>
              <Button type="button" size="sm" variant="outline" className={DECIDE_CLASS} onClick={closeSettings}>
                {T.close}
              </Button>
            </div>
          )}

          <DialogPrimitive.Close
            aria-label={T.closeWithoutDeciding}
            className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPortal>
    </DialogPrimitive.Root>
  );
}
