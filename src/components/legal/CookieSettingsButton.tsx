// src/components/legal/CookieSettingsButton.tsx
// Botón «Configurar cookies» (Etapa 2 · PR 13): abre el diálogo del aviso de cookies
// (CookieConsent) en cualquier host. Revocar es tan fácil como aceptar. Está en el pie de
// cada página y en la Política de privacidad §10. Es estático: el prerender lo dibuja igual
// que el navegador y no lee nada al dibujar.

import type { ButtonHTMLAttributes } from 'react';
import { COOKIE_TEXTS, openCookieSettings } from '@/lib/cookieConsent';

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'onClick'>;

export default function CookieSettingsButton({ children, ...props }: Props) {
  return (
    <button type="button" {...props} onClick={() => openCookieSettings()}>
      {children ?? COOKIE_TEXTS.footerButton}
    </button>
  );
}
