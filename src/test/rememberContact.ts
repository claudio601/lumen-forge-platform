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

/** Casilla sin marcar, con la etiqueta y la nota de ayuda de un visitante sin datos guardados. */
export function expectFreshBox(): void {
  const box = rememberBox();
  expect(box.checked).toBe(false);
  expect(box).toHaveAccessibleName(REMEMBER_TEXTS.label);
  expect(box).toHaveAccessibleDescription(REMEMBER_TEXTS.hint);
  expect(screen.getByText(REMEMBER_TEXTS.hint)).toBeVisible();
  expect(screen.getByText(REMEMBER_TEXTS.hintSaved)).not.toBeVisible();
}

/** Casilla marcada por lo guardado: «Seguir recordando…» y el aviso en lugar de la nota de ayuda. */
export function expectSavedBox(): void {
  const box = rememberBox();
  expect(box.checked).toBe(true);
  expect(box).toHaveAccessibleName(REMEMBER_TEXTS.labelSaved);
  expect(box).toHaveAccessibleDescription(REMEMBER_TEXTS.hintSaved);
  expect(screen.getByText(REMEMBER_TEXTS.hintSaved)).toBeVisible();
  expect(screen.getByText(REMEMBER_TEXTS.hint)).not.toBeVisible();
  // En el mismo lugar: los dos textos en la misma celda del mismo párrafo
  expect(screen.getByText(REMEMBER_TEXTS.hint).parentElement).toBe(screen.getByText(REMEMBER_TEXTS.hintSaved).parentElement);
}

/** La región role="status" de la casilla (la que sigue a la nota de ayuda). */
export function rememberStatus(): HTMLElement {
  const hint = screen.getByText(REMEMBER_TEXTS.hint).parentElement!;
  const status = hint.nextElementSibling as HTMLElement;
  expect(status).toHaveAttribute('role', 'status');
  return status;
}

/** Ningún texto que no sea de contacto llegó a lo guardado. */
export function expectNothingElseStored(forbidden: readonly string[]): void {
  const raw = localStorage.getItem(REMEMBER_KEY) ?? '';
  for (const text of forbidden) expect(raw, `«${text}» no se guarda`).not.toContain(text);
  expect(raw).not.toMatch(/website|consent|privacy|marketing|attribution|comentario|notas?\b|descripcion|archivos/i);
}
