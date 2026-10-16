// api/_lib/site.ts
// Dirección pública del sitio: una sola fuente para el sitio y las funciones de api/.
// src/config/site.ts la reexporta (canonical, og:url, sitemap, robots, JSON-LD) y el
// asistente de WhatsApp arma con ella el enlace a la política de privacidad
// (api/_lib/whatsapp/privacyNotice.ts). Mismo patrón que LEGAL_VERSION en
// api/_lib/forms/consent.ts: el código de api/ no importa nada desde src/.
//
// Hasta el cambio de dominio es nuevo.elights.cl, que está fuera de Google por la cabecera
// X-Robots-Tag (vercel.json). La PR del cambio de dominio (Etapa 3) la cambia aquí a
// https://elights.cl, solo cuando elights.cl ya se sirva desde Vercel (comprobarlo con
// `npm run smoke -- https://elights.cl`). Es una constante a propósito, para no depender de
// variables de entorno de Vercel. Sin imports; la carpeta _lib hace que Vercel no la
// despliegue como función.

export const SITE_URL: string = 'https://nuevo.elights.cl';
