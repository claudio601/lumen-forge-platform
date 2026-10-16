// useConsentFields (Etapa 2 · PR 13): las casillas de privacidad y novedades que comparten
// los cinco formularios. Textos exactos de api/_lib/forms/consent.ts, enlaces en otra
// pestaña, novedades sin marcar, error junto a la casilla con el foco en ella, payload()
// con el estado real (nunca un true fijo) y el mismo HTML en el servidor y en el navegador.

import { describe, expect, it, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { useConsentFields, type ConsentFieldsApi, type ConsentFieldsOptions } from './ConsentFields';
import {
  CONSENT_ERRORS,
  CONSENT_TEXTS,
  LEGAL_VERSION,
  consentTextPlain,
  parseConsent,
  type ConsentKind,
} from '../../../api/_lib/forms/consent';

let api: ConsentFieldsApi;

function Harness({ kind, opts }: { kind: ConsentKind; opts?: ConsentFieldsOptions }) {
  const consent = useConsentFields(kind, opts);
  api = consent;
  return (
    <form>
      <input name="antes" aria-label="Campo anterior" />
      {consent.fields}
    </form>
  );
}

const page = (kind: ConsentKind, opts?: ConsentFieldsOptions) => (
  <MemoryRouter>
    <Harness kind={kind} opts={opts} />
  </MemoryRouter>
);

const privacyBox = () => screen.getByRole('checkbox', { name: /autorizo a eLIGHTS a usar mis datos/ });
const marketingBox = () => screen.getByRole('checkbox', { name: /Quiero recibir novedades/ });

describe('useConsentFields', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it.each([
    ['solicitud', CONSENT_TEXTS.privacy, ['/politica-de-privacidad']],
    ['pedido', CONSENT_TEXTS.privacyWithTerms, ['/terminos-y-condiciones', '/politica-de-privacidad']],
  ] as const)('%s: textos exactos y enlaces en otra pestaña', (kind, text, hrefs) => {
    render(page(kind));
    const group = screen.getByRole('group', { name: 'Privacidad y novedades' });
    // Nombre accesible = el texto aprobado (sin el asterisco). jsdom no conoce el display de
    // los enlaces y les agrega espacios alrededor ("condiciones ,"): se quitan antes de comparar.
    const name = (n: string) => n.replace(/\s+([,.])/g, '$1');
    expect(screen.getByRole('checkbox', { name: (n) => name(n) === consentTextPlain(text) })).toBe(privacyBox());
    expect(marketingBox()).toHaveAccessibleName(
      'Quiero recibir novedades y ofertas de eLIGHTS por correo (opcional). Puedo darme de baja cuando quiera.',
    );
    const links = within(group).getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual(hrefs);
    for (const a of links) {
      expect(a).toHaveAttribute('target', '_blank');
      expect(a.getAttribute('rel')).toContain('noopener');
    }
    // El asterisco de la obligatoria se ve, pero no se lee
    const star = privacyBox().closest('label')!.querySelector('[aria-hidden="true"]')!;
    expect(star).toHaveTextContent('*');
    expect(privacyBox().closest('label')).toHaveTextContent(consentTextPlain(text) + ' *');
  });

  it('las dos casillas empiezan sin marcar, con sus nombres, y sin required nativo', () => {
    render(page('solicitud'));
    expect(privacyBox()).not.toBeChecked();
    expect(marketingBox()).not.toBeChecked();
    expect(privacyBox()).toHaveAttribute('name', 'consentPrivacy');
    expect(marketingBox()).toHaveAttribute('name', 'consentMarketing');
    expect(privacyBox()).not.toHaveAttribute('required');
    expect(privacyBox()).toHaveAttribute('aria-required', 'true');
    expect(privacyBox()).toHaveAttribute('aria-invalid', 'false');
    expect(privacyBox()).not.toHaveAttribute('aria-describedby');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(api.privacy).toBe(false);
    expect(api.marketing).toBe(false);
  });

  it.each(['solicitud', 'pedido'] as const)('%s: check() sin marcar → false, error junto a la casilla y foco en ella', (kind) => {
    render(page(kind));
    let result: boolean | undefined;
    act(() => { result = api.check(); });
    expect(result).toBe(false);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(CONSENT_ERRORS[kind]);
    expect(privacyBox()).toHaveFocus();
    expect(privacyBox()).toHaveAttribute('aria-invalid', 'true');
    expect(privacyBox()).toHaveAccessibleDescription(CONSENT_ERRORS[kind]);
    // El error queda debajo de la casilla, dentro del grupo
    expect(privacyBox().compareDocumentPosition(alert) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Privacidad y novedades' })).toContainElement(alert);
  });

  it('marcar la casilla borra el error y check() pasa a true', () => {
    render(page('solicitud'));
    act(() => { api.check(); });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.click(privacyBox());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(privacyBox()).toHaveAttribute('aria-invalid', 'false');
    let result: boolean | undefined;
    act(() => { result = api.check(); });
    expect(result).toBe(true);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('desmarcar no muestra el error hasta el próximo envío', () => {
    render(page('solicitud'));
    fireEvent.click(privacyBox());
    fireEvent.click(privacyBox());
    expect(privacyBox()).not.toBeChecked();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('flagMissing() (400 consent_required) muestra el error y da el foco', () => {
    render(page('pedido'));
    screen.getByLabelText('Campo anterior').focus();
    act(() => { api.flagMissing(); });
    expect(screen.getByRole('alert')).toHaveTextContent(CONSENT_ERRORS.pedido);
    expect(privacyBox()).toHaveFocus();
  });

  it('solicitud: payload() con el estado real; terms nunca viaja', () => {
    render(page('solicitud'));
    expect(api.payload()).toEqual({ privacy: false, marketing: false, version: LEGAL_VERSION });
    expect(parseConsent(api.payload(), { requireTerms: false }).ok).toBe(false);
    fireEvent.click(privacyBox());
    expect(api.payload()).toEqual({ privacy: true, marketing: false, version: LEGAL_VERSION });
    expect(api.payload()).not.toHaveProperty('terms');
    expect(parseConsent(api.payload(), { requireTerms: false }).ok).toBe(true);
    fireEvent.click(marketingBox());
    expect(api.payload()).toEqual({ privacy: true, marketing: true, version: LEGAL_VERSION });
    expect(api.marketing).toBe(true);
  });

  it('pedido: terms sigue a la casilla obligatoria (false sin marcar)', () => {
    render(page('pedido'));
    expect(api.payload()).toEqual({ privacy: false, terms: false, marketing: false, version: LEGAL_VERSION });
    expect(parseConsent(api.payload(), { requireTerms: true }).ok).toBe(false);
    fireEvent.click(privacyBox());
    expect(api.payload()).toEqual({ privacy: true, terms: true, marketing: false, version: LEGAL_VERSION });
    expect(parseConsent(api.payload(), { requireTerms: true }).ok).toBe(true);
  });

  it('la novedad es opcional: marcarla sola no autoriza nada', () => {
    render(page('solicitud'));
    fireEvent.click(marketingBox());
    expect(api.payload()).toEqual({ privacy: false, marketing: true, version: LEGAL_VERSION });
    let result: boolean | undefined;
    act(() => { result = api.check(); });
    expect(result).toBe(false);
  });

  it('reset() deja las dos casillas sin marcar y quita el error', () => {
    render(page('solicitud'));
    fireEvent.click(marketingBox());
    act(() => { api.check(); });
    act(() => { api.reset(); });
    expect(privacyBox()).not.toBeChecked();
    expect(marketingBox()).not.toBeChecked();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('className: por defecto mb-5; con opts.className, solo esa clase', () => {
    const { unmount } = render(page('solicitud'));
    expect(screen.getByRole('group', { name: 'Privacidad y novedades' })).toHaveClass('mb-5');
    unmount();
    render(page('solicitud', { className: 'sm:col-span-2' }));
    const group = screen.getByRole('group', { name: 'Privacidad y novedades' });
    expect(group.tagName).toBe('FIELDSET');
    expect(group).toHaveClass('sm:col-span-2');
    expect(group).not.toHaveClass('mb-5');
  });

  it('la nota aparece solo con opts.note, bajo la obligatoria, y la describe', () => {
    const { container, unmount } = render(page('solicitud'));
    expect(container).not.toHaveTextContent(CONSENT_TEXTS.installationNote);
    unmount();
    render(page('solicitud', { note: CONSENT_TEXTS.installationNote }));
    expect(privacyBox()).toHaveAccessibleDescription(CONSENT_TEXTS.installationNote);
    const note = document.getElementById(privacyBox().getAttribute('aria-describedby')!)!;
    expect(note).toHaveTextContent(CONSENT_TEXTS.installationNote);
    expect(note).toHaveClass('text-gray-600');
    // Con el error, la casilla se describe con los dos
    act(() => { api.check(); });
    expect(privacyBox()).toHaveAccessibleDescription(CONSENT_ERRORS.solicitud + ' ' + CONSENT_TEXTS.installationNote);
  });
});

describe('useConsentFields: el mismo HTML en el servidor y en el navegador', () => {
  afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); });

  it.each([
    ['solicitud', undefined],
    ['pedido', undefined],
    ['solicitud', { note: CONSENT_TEXTS.installationNote, className: 'sm:col-span-2' }],
  ] as const)('%s %#: renderToString es igual al primer render del cliente', async (kind, opts) => {
    // En jsdom, MemoryRouter usa useLayoutEffect en el render del servidor y React avisa
    const consoleErrors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const html = renderToString(page(kind, opts));
    expect(html).not.toContain('checked');
    expect(html).not.toContain('role="alert"');
    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.appendChild(container);
    const before = container.innerHTML;
    const serverBox = container.querySelector('input[name="consentPrivacy"]');
    consoleErrors.mockClear();
    const errors: unknown[] = [];
    let root: ReturnType<typeof hydrateRoot> | undefined;
    await act(async () => {
      root = hydrateRoot(container, page(kind, opts), { onRecoverableError: (e) => errors.push(e) });
    });
    expect(errors).toEqual([]);
    expect(consoleErrors.mock.calls.map((args) => args.map(String).join(' ')).filter((m) => /did not match|server HTML|hydrat/i.test(m))).toEqual([]);
    expect(container.innerHTML).toBe(before);
    expect(container.contains(serverBox)).toBe(true); // React reutilizó el nodo
    act(() => root?.unmount());
  });
});
