// src/lib/cookieTexts.ts
// Textos del aviso de cookies y del diálogo «Configurar cookies» (Etapa 2 · PR 13). Módulo
// sin navegador (ni window ni import.meta.env): lo leen también los scripts de Node, como
// scripts/check-prerender.ts. src/lib/cookieConsent.ts los reexporta.

/**
 * Textos del aviso y del diálogo (aprobados en el diseño de la PR 13). Viven aquí y no en el
 * componente para que las pruebas los comparen con una sola fuente.
 */
export const COOKIE_TEXTS = Object.freeze({
  bannerLabel: 'Aviso de cookies',
  banner:
    'Con tu permiso usamos cookies de Google para medir visitas y anuncios. Puedes cambiarlo cuando quieras en «Configurar cookies», al pie de la página.',
  policyLink: 'Política de privacidad',
  policyPath: '/politica-de-privacidad',
  reject: 'Rechazar',
  configure: 'Configurar',
  accept: 'Aceptar',
  settingsTitle: 'Configurar cookies',
  settingsDescription:
    'Elige qué permites en este navegador. Guardamos tu decisión 12 meses y puedes cambiarla cuando quieras desde «Configurar cookies», al pie de cada página. Rechazar las cookies no desactiva el origen de la visita: para oponerte, usa su interruptor.',
  settingsDescriptionNoGoogle:
    'En esta dirección del sitio no usamos cookies, Google Analytics ni medición de anuncios. Si más adelante los usamos, te lo preguntaremos aquí.',
  necessaryTitle: 'Necesarias',
  necessaryStatus: 'Siempre activas',
  necessaryText:
    'Recuerdan tu lista de cotización y de pedido, si ves los precios con o sin IVA y esta decisión. Se guardan solo en tu navegador y no son cookies.',
  originTitle: 'Origen de la visita',
  originText:
    'Anotamos en tu navegador, mientras la pestaña esté abierta, de dónde llegaste: la página de entrada, el sitio anterior y los parámetros de campaña (como utm_source o gclid). Solo enviamos esta copia junto con tu solicitud, para saber qué canales funcionan, y no la enviamos a Google ni a Meta. No es una cookie. Si lo desactivas, lo borramos de este navegador y no lo volvemos a anotar aquí; para que dejemos de usar el que ya enviaste con una solicitud, escríbenos a ventas@elights.cl con el asunto «Datos personales».',
  analyticsTitle: 'Medición de visitas (Google Analytics)',
  analyticsText:
    'Cookies de Google Analytics (_ga y _ga_…, hasta 13 meses) para contar visitas y saber qué páginas y botones se usan (por ejemplo, agregar productos a la lista, enviar un formulario o abrir WhatsApp). Google registra por su cuenta la página por la que entraste, el sitio anterior y los parámetros de campaña, sin tus datos de contacto. Solo en elights.cl.',
  adsTitle: 'Medición de anuncios de Google',
  adsText:
    'Requiere la medición de visitas. Cookies de Google (_gcl_…, hasta 90 días) para que Google Ads sepa si una visita desde uno de nuestros anuncios terminó en una solicitud o en un contacto con nosotros (por ejemplo, un clic para escribirnos por WhatsApp). Desde nuestros formularios no enviamos a Google tu nombre ni tus datos de contacto, y no activa anuncios personalizados. Solo en elights.cl.',
  rejectAll: 'Rechazar cookies',
  save: 'Guardar mi elección',
  acceptAll: 'Aceptar cookies',
  close: 'Cerrar',
  closeWithoutDeciding: 'Cerrar sin cambiar tu decisión',
  footerButton: 'Configurar cookies',
});
