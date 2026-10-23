// src/components/legal/DeleteSavedContactButton.tsx
// Botón «Borrar mis datos guardados» de la Política de privacidad §10 (especificación
// «Recordar mis datos», decisión 4 del dueño): borra 'elights_contact' de este navegador, como
// «Configurar cookies» abre su diálogo. No envía nada. En los formularios no hay botón: basta
// desmarcar la casilla.
//
// Es estático: el prerender lo dibuja igual que el navegador y no lee nada al dibujar. El aviso
// «Listo: borramos tus datos de este dispositivo» va al final del mismo punto
// (SavedContactClearedNotice, role="status"), no junto al botón, que está a media frase. El
// aviso no entra al archivo de la versión (data-legal-archive="omit"): es una respuesta, no texto.

import { useEffect, useState, type ButtonHTMLAttributes } from 'react';
import { clearSavedContact } from '@/lib/savedContact';
import { REMEMBER_TEXTS } from '@/components/forms/RememberContact';

/** Lo emite el botón después de borrar; lo escucha el aviso. */
const CLEARED_EVENT = 'elights:saved-contact-cleared';

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'onClick' | 'children'>;

export default function DeleteSavedContactButton(props: Props) {
  return (
    <button
      type="button"
      {...props}
      onClick={() => {
        clearSavedContact();
        window.dispatchEvent(new Event(CLEARED_EVENT));
      }}
    >
      {REMEMBER_TEXTS.deleteButton}
    </button>
  );
}

/** El aviso del botón: vacío (y oculto) hasta el primer clic. */
export function SavedContactClearedNotice() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const onCleared = () => setShown(true);
    window.addEventListener(CLEARED_EVENT, onCleared);
    return () => window.removeEventListener(CLEARED_EVENT, onCleared);
  }, []);
  return (
    <span role="status" data-legal-archive="omit" className={shown ? 'mt-1 block font-medium' : 'sr-only'}>
      {shown ? REMEMBER_TEXTS.cleared : ''}
    </span>
  );
}
