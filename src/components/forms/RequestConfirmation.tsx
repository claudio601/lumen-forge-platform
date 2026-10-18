// src/components/forms/RequestConfirmation.tsx
// Confirmación de /cotizacion, /solicitar-pedido y /cotizador (auditoría UX, F-03): la
// referencia, el plazo de respuesta (por correo, el mismo día hábil; fuera del horario, el
// día hábil siguiente), 3 pasos numerados, "Revisa tu correo" y un resumen para imprimir o
// guardar.
//
// Reglas del dueño (2026-10-17): respondemos SIEMPRE por correo; aquí no se ofrecen llamadas
// ni WhatsApp (a quien ya tiene una referencia, un WhatsApp le abriría un segundo negocio),
// y el botón flotante de WhatsApp se esconde mientras se ve la confirmación.
// No se promete una copia por correo al cliente: el correo de la solicitud va solo a ventas.
//
// El botón de envío desaparece con el formulario: el foco pasa al título, que lee el plazo y
// la referencia. "Imprimir o guardar resumen" usa window.print(); la hoja de impresión
// (src/index.css, [data-print-summary]) deja solo esta confirmación.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { contactEmail, responseTimeOffHours, responseTimePromise } from '@/config/business';
import { useHideWhatsAppButton } from '@/hooks/useHideWhatsAppButton';

interface RequestConfirmationProps {
  /** Valor de data-elights-form (la etiqueta de Google excluye el bloque de la detección de datos). */
  form: string;
  /** Prefijo de los ids (aria-describedby del título). */
  idPrefix: string;
  title: string;
  /** Referencia de la solicitud (NE-, RC-, PY-); vacía si el servidor no la devolvió. */
  reference: string;
  /** Los 3 próximos pasos, en orden. */
  steps: readonly [string, string, string];
  /** Lo que se pidió (productos o datos del proyecto), para el resumen impreso. */
  summary?: ReactNode;
  /** El <Seo> de la página. */
  seo: ReactNode;
  back: { to: string; label: string };
}

const RequestConfirmation = ({ form, idPrefix, title, reference, steps, summary, seo, back }: RequestConfirmationProps) => {
  useHideWhatsAppButton();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  // La hora del envío para el resumen impreso. Solo en el navegador: la confirmación no se
  // genera en el servidor (aparece después de enviar).
  const [sentAt] = useState(() =>
    new Date().toLocaleString('es-CL', { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Santiago' }),
  );
  const ids = { detail: `${idPrefix}-detail`, ref: `${idPrefix}-ref`, steps: `${idPrefix}-steps`, summary: `${idPrefix}-summary` };
  const mailto = `mailto:${contactEmail}${reference ? `?subject=${encodeURIComponent(`Solicitud ${reference}`)}` : ''}`;

  return (
    <div className="container py-12 max-w-xl mx-auto" data-elights-form={form} data-print-summary="">
      {seo}
      <div className="text-center">
        <CheckCircle2 className="h-16 w-16 text-primary mx-auto mb-4 print:hidden" aria-hidden="true" />
        <h1
          ref={heading}
          tabIndex={-1}
          aria-describedby={reference ? `${ids.detail} ${ids.ref}` : ids.detail}
          className="text-2xl font-bold mb-3 focus:outline-none"
        >
          {title}
        </h1>
        <p id={ids.detail} className="font-medium mb-1">
          {responseTimePromise}
        </p>
        <p className="text-sm text-muted-foreground mb-4">{responseTimeOffHours}</p>
        {reference && (
          <p id={ids.ref} className="inline-block text-xs font-mono bg-muted px-3 py-1.5 rounded-lg text-muted-foreground">
            Referencia: <span className="font-bold text-foreground">{reference}</span>
          </p>
        )}
      </div>

      <section aria-labelledby={ids.steps} className="mt-8 rounded-xl border p-5">
        <h2 id={ids.steps} className="font-bold mb-3">
          Próximos pasos
        </h2>
        <ol className="list-decimal pl-5 space-y-2 text-sm">
          {steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <p className="mt-4 text-sm font-medium">Revisa tu correo, también la carpeta de spam: ahí te llega nuestra respuesta.</p>
      </section>

      {summary && (
        <section aria-labelledby={ids.summary} className="mt-6 rounded-xl border p-5">
          <h2 id={ids.summary} className="font-bold mb-1">
            Resumen de tu solicitud
          </h2>
          <p className="text-xs text-muted-foreground mb-3">Enviada el {sentAt}</p>
          {summary}
        </section>
      )}

      <p className="mt-6 text-sm text-muted-foreground text-center">
        ¿Quieres agregar algo? Escríbenos a{' '}
        <a href={mailto} className="text-primary underline">
          {contactEmail}
        </a>
        {reference ? (
          <>
            {' '}
            citando tu <span className="whitespace-nowrap">referencia {reference}</span>.
          </>
        ) : (
          '.'
        )}
      </p>

      <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center print:hidden">
        <Button type="button" variant="outline" className="gap-2" onClick={() => window.print()}>
          <Printer className="h-4 w-4" aria-hidden="true" />
          Imprimir o guardar resumen
        </Button>
        <Button asChild className="gradient-primary text-primary-foreground">
          <Link to={back.to}>{back.label}</Link>
        </Button>
      </div>
    </div>
  );
};

export default RequestConfirmation;
