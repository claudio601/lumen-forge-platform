// Ayudas de prueba de «Recordar mis datos en este dispositivo» (especificación del 23-10-2026,
// §5), comunes a las pruebas de los cinco formularios. Datos inventados: correos example.com y
// el RUT de prueba de los tests de /cotizacion (rango 44 millones, sin asignar).

import { screen } from '@testing-library/react';
import { expect } from 'vitest';
import { SAVED_CONTACT_STORAGE_KEY, type SavedContact } from '@/lib/savedContact';
import { REMEMBER_TEXTS } from '@/components/forms/RememberContact';

export const REMEMBER_KEY = SAVED_CONTACT_STORAGE_KEY;
/** El RUT de prueba que ya usan los tests de /cotizacion. */
export const TEST_RUT = '44.444.444-4';
/** Hora fija para comparar cuerpos (referencias por hora, fecha del estudio lumínico). */
export const FIXED_NOW = new Date('2026-10-23T15:00:00.000Z');

/** Siembra lo guardado como lo dejaría un envío anterior (por defecto, hace 30 días). */
export function seedSaved(data: SavedContact, at: Date = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)): void {
  localStorage.setItem(REMEMBER_KEY, JSON.stringify({ v: 1, at: at.toISOString(), data }));
}

/** Lo guardado tal cual, o null. */
export function storedContact(): { v: number; at: string; data: Record<string, unknown> } | null {
  const raw = localStorage.getItem(REMEMBER_KEY);
  return raw === null ? null : JSON.parse(raw);
}

/** La casilla, con cualquiera de sus dos etiquetas. */
export const rememberBox = () =>
  screen.getByRole('checkbox', { name: /^(Recordar|Seguir recordando) mis datos en este dispositivo$/ }) as HTMLInputElement;

/**
 * La casilla muestra la etiqueta y la nota de `shown`; el otro estado es una copia invisible
 * (aria-hidden) en la misma celda de la grilla, que solo reserva su altura: al cambiar de
 * estado no se mueve lo de abajo.
 */
function expectBoxState(shown: { label: string; hint: string }, other: { label: string; hint: string }): HTMLInputElement {
  const box = rememberBox();
  expect(box).toHaveAccessibleName(shown.label);
  expect(box).toHaveAccessibleDescription(shown.hint);
  expect(box.closest('label')!.textContent).toBe(shown.label);
  expect(screen.getByText(shown.label)).toBeVisible();
  expect(screen.getByText(shown.hint)).toBeVisible();
  const copy = screen.getByText(other.hint).closest('[aria-hidden="true"]') as HTMLElement;
  expect(copy).not.toBeNull();
  expect(copy).not.toBeVisible();
  expect(copy.textContent).toBe(other.label + other.hint);
  expect(screen.getByText(other.label)).not.toBeVisible();
  // En el mismo lugar: la casilla visible y la copia comparten la celda (gridArea 1 / 1)
  const cell = box.closest('label')!.parentElement!;
  expect(cell.parentElement).toBe(copy.parentElement);
  expect(cell.style.gridArea).toBe('1 / 1');
  expect(copy.style.gridArea).toBe('1 / 1');
  return box;
}

/** Casilla sin marcar, con la etiqueta y la nota de ayuda de un visitante sin datos guardados. */
export function expectFreshBox(): void {
  const box = expectBoxState(
    { label: REMEMBER_TEXTS.label, hint: REMEMBER_TEXTS.hint },
    { label: REMEMBER_TEXTS.labelSaved, hint: REMEMBER_TEXTS.hintSaved },
  );
  expect(box.checked).toBe(false);
}

/** Casilla marcada por lo guardado: «Seguir recordando…» y el aviso en lugar de la nota de ayuda. */
export function expectSavedBox(): void {
  const box = expectBoxState(
    { label: REMEMBER_TEXTS.labelSaved, hint: REMEMBER_TEXTS.hintSaved },
    { label: REMEMBER_TEXTS.label, hint: REMEMBER_TEXTS.hint },
  );
  expect(box.checked).toBe(true);
}

/** La región role="status" de la casilla (la que sigue a la grilla de la etiqueta y la nota). */
export function rememberStatus(): HTMLElement {
  const grid = rememberBox().closest('label')!.parentElement!.parentElement!;
  const status = grid.nextElementSibling as HTMLElement;
  expect(status).toHaveAttribute('role', 'status');
  return status;
}

/** Ningún texto que no sea de contacto llegó a lo guardado. */
export function expectNothingElseStored(forbidden: readonly string[]): void {
  const raw = localStorage.getItem(REMEMBER_KEY) ?? '';
  for (const text of forbidden) expect(raw, `«${text}» no se guarda`).not.toContain(text);
  expect(raw).not.toMatch(/website|consent|privacy|marketing|attribution|comentario|notas?\b|descripcion|archivos/i);
}
