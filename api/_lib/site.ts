// api/_lib/site.ts
// Dirección pública del sitio: una sola fuente para el sitio y las funciones de api/.
// src/config/site.ts la reexporta (canonical, og:url, sitemap, robots, JSON-LD) y el
// asistente de WhatsApp arma con ella el enlace a la política de privacidad
// (api/_lib/whatsapp/privacyNotice.ts). Mismo patrón que LEGAL_VERSION en
// api/_lib/forms/consent.ts: el código de api/ no importa nada desde src/.
//
// Dominio público desde el cambio de dominio (Etapa 3). Esta PR se fusiona y despliega
// solo el día en que elights.cl y www pasen a Vercel, nunca antes: hasta entonces el
// dominio público sigue sirviendo la tienda anterior. nuevo.elights.cl conserva noindex
// por host (vercel.json) y sigue atendiendo formularios y webhooks. APP_BASE_URL sigue
// siendo la base de la firma de Twilio y no depende de esta constante.
// Es una constante a propósito, para no depender de variables de entorno de Vercel.
// Sin imports; la carpeta _lib hace que Vercel no la despliegue como función.

export const SITE_URL: string = 'https://elights.cl';
