// /cotizador: solicitud de propuesta técnica para un proyecto (sin productos). El servidor
// (/api/project-quotes/create) manda el correo a ventas y crea el negocio en Pipedrive.
// Auditoría UX, entrega 2 (F-03, 2026-10-17): la confirmación da el plazo de respuesta (por
// correo, el mismo día hábil), 3 pasos y un resumen para imprimir, sin derivar a WhatsApp.
// Adjuntos (especificación «Adjuntar archivos», 22-10-2026): el campo va después de los
// comentarios (FileAttachments). Los archivos se suben AL ENVIAR (decisión D1 del dueño):
// después de validateForm y de la casilla de privacidad, nunca si el campo trampa tiene texto,
// de a uno y directo a Vercel Blob (attachments.ts); luego viaja `archivos` con sus rutas.
// Si uno falla: «Reintentar» o «Enviar sin ese archivo»; con el tope del día (D2): «Enviar sin
// archivos». Lo ya subido no se vuelve a subir al reintentar.
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Send, Zap, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { sendEvent, trackLead } from '@/lib/analytics';
import { getAttribution } from '@/lib/attribution';
import { contactEmail, responseTimeHours, responseTimePromise } from '@/config/business';
import Seo from '@/components/Seo';
import { useConsentFields } from '@/components/legal/ConsentFields';
import RequestConfirmation from '@/components/forms/RequestConfirmation';
import FileAttachments from '@/components/forms/FileAttachments';
import { uploadPending, type AttachmentItem, type UploadProblem } from '@/components/forms/attachments';
import { CONSENT_ERRORS, CONSENT_ERROR_CODE } from '../../api/_lib/forms/consent';
// Las listas, los topes y la lectura de los m² son los mismos del servidor (api/project-quotes/create.ts)
import {
  ILLUMINATION_LEVELS,
  M2_FORMAT_MESSAGE,
  MAX_ALTURA,
  MAX_M2,
  PROJECT_TYPES,
  parseM2,
} from '../../api/_lib/forms/projectQuote';

const MAX_COMENTARIOS = 2000;

// ── Envío al endpoint (correo a ventas + Pipedrive en el servidor) ────────────

/**
 * Envío no confirmado por el servidor. httpStatus 0 = sin respuesta (red caída). code: el
 * `code` del cuerpo de error ('consent_required' si faltó la casilla de privacidad).
 */
class SubmitError extends Error {
  reason: string;
  httpStatus: number;
  code?: string;
  constructor(reason: string, httpStatus: number, code?: string) {
    super(reason + ' (HTTP ' + httpStatus + ')');
    this.reason = reason;
    this.httpStatus = httpStatus;
    this.code = code;
  }
}

/**
 * Solo es éxito un 2xx con { success: true }. Devuelve la referencia PY- ('' si no viene) y si
 * el negocio no quedó en Pipedrive (crm: 'failed'): entonces el servidor borra los adjuntos y
 * ventas se los pide al cliente por correo.
 */
async function submitProjectQuote(payload: Record<string, unknown>): Promise<{ reference: string; crmFailed: boolean }> {
  let res: Response;
  try {
    res = await fetch('/api/project-quotes/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new SubmitError('network', 0);
  }

  // Una página de error de Vercel (504, 500) llega en HTML, no en JSON
  let data: { success?: unknown; reference?: unknown; code?: unknown; crm?: unknown } | null = null;
  try {
    data = JSON.parse(await res.text());
  } catch { /* cuerpo no JSON */ }

  if (!res.ok) throw new SubmitError('api_error', res.status, typeof data?.code === 'string' ? data.code : undefined);
  if (!data) throw new SubmitError('invalid_body', res.status);
  if (data.success !== true) throw new SubmitError('not_success', res.status);
  return { reference: typeof data.reference === 'string' ? data.reference : '', crmFailed: data.crm === 'failed' };
}

/** Mensaje para el visitante según el estado HTTP y el code de la respuesta. */
function submitErrorMessage(httpStatus: number, code?: string): string {
  // Un 400 por la casilla nunca dice "teléfono (8 a 12 dígitos)"
  if (code === CONSENT_ERROR_CODE) return CONSENT_ERRORS.solicitud;
  if (httpStatus === 400) return 'Revisa email y teléfono (8 a 12 dígitos) e inténtalo de nuevo.';
  if (httpStatus === 429) {
    return 'Hiciste varios envíos seguidos. Espera unos minutos o escríbenos a ' + contactEmail + '.';
  }
  return (
    'No pudimos enviar tu solicitud. Inténtalo de nuevo o escríbenos a ' + contactEmail + '.'
  );
}

/** Texto opcional recortado; vacío no viaja en el JSON. */
const optional = (value: string) => value.trim() || undefined;

const inputClass = 'w-full border rounded-lg px-3 py-2.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30';

const PROJECT_STEPS = [
  'Revisamos los datos de tu proyecto.',
  'Te enviamos por correo la propuesta técnica, con la cotización formal.',
  'Si la aceptas, pagas con el link de pago: la compra se hace solo cuando pagas.',
] as const;

const SEO_TITLE = 'Cotizar Iluminación LED | eLIGHTS Chile';
const SEO_DESCRIPTION = 'Solicita una cotización de iluminación LED profesional. Productos técnicos para proyectos comerciales, industriales y residenciales.';

const SmartQuotePage = () => {
  const [submitted, setSubmitted] = useState(false);
  const [sending, setSending] = useState(false);
  const [reference, setReference] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [website, setWebsite] = useState(''); // honeypot: las personas no lo ven ni lo llenan
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [uploadProblem, setUploadProblem] = useState<UploadProblem | null>(null);
  /** Avance de la subida (0 a 100) mientras se suben los archivos; null el resto del tiempo. */
  const [progress, setProgress] = useState<number | null>(null);
  /** Archivos que llegaron con la solicitud (para la confirmación). */
  const [sentFiles, setSentFiles] = useState(0);
  // Casillas de privacidad y novedades: siempre sin marcar (también en el HTML del prerender).
  // Sin el mb-5 por defecto: el fieldset del formulario ya separa los bloques con space-y-6.
  const consent = useConsentFields('solicitud', { className: 'min-w-0' });
  // false en el HTML estático (prerender) y en el primer render del navegador; true cuando
  // React ya tomó el formulario. Mientras sea false, todo queda deshabilitado.
  const [hydrated, setHydrated] = useState(false);
  const [form, setForm] = useState({
    tipoProyecto: '',
    m2: '',
    altura: '',
    aplicacion: '',
    nivelIluminacion: '',
    ciudad: '',
    plazo: '',
    comentarios: '',
    nombre: '',
    email: '',
    telefono: '',
    rutEmpresa: '',
    razonSocial: '',
    giro: '',
    direccion: '',
  });

  useEffect(() => {
    setHydrated(true);
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  /** Las mismas reglas que el servidor; null si el formulario está bien. */
  const validateForm = (): string | null => {
    if (!form.tipoProyecto || !form.m2.trim() || !form.nombre.trim() || !form.email.trim() || !form.telefono.trim()) {
      return 'Completa todos los campos requeridos.';
    }
    // "12.000" son 12000: el punto separa miles. Lo ambiguo ("12,5", "1,200") se pide de nuevo.
    const m2 = parseM2(form.m2);
    if (Number.isNaN(m2)) return M2_FORMAT_MESSAGE;
    if (!(m2 > 0 && m2 <= MAX_M2)) return 'Indica los m2 aproximados con un número mayor que 0.';
    if (form.altura.trim()) {
      const altura = Number(form.altura);
      if (!(altura >= 0 && altura <= MAX_ALTURA)) return 'La altura debe estar entre 0 y ' + MAX_ALTURA + ' m.';
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return 'Ingresa un email válido.';
    const phoneDigits = form.telefono.replace(/\D/g, '').length;
    if (phoneDigits < 8 || phoneDigits > 12) return 'El teléfono debe tener entre 8 y 12 dígitos.';
    if (form.comentarios.trim().length > MAX_COMENTARIOS) {
      return 'Los comentarios admiten hasta ' + MAX_COMENTARIOS + ' caracteres.';
    }
    return null;
  };

  const buildPayload = () => ({
    tipoProyecto: form.tipoProyecto,
    m2: parseM2(form.m2),
    altura: form.altura.trim() ? Number(form.altura) : undefined,
    aplicacion: optional(form.aplicacion),
    nivelIluminacion: optional(form.nivelIluminacion),
    ciudad: optional(form.ciudad),
    plazo: optional(form.plazo),
    comentarios: optional(form.comentarios),
    nombre: form.nombre.trim(),
    email: form.email.trim(),
    telefono: form.telefono.trim(),
    rutEmpresa: optional(form.rutEmpresa),
    razonSocial: optional(form.razonSocial),
    giro: optional(form.giro),
    direccion: optional(form.direccion),
    website,
    attribution: getAttribution(),
    consent: consent.payload(),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void send(attachments);
  };

  /** Envía con estos archivos: los de la lista o, desde un aviso de la subida, menos alguno. */
  const send = async (files: AttachmentItem[]) => {
    if (sending) return;
    const invalid = validateForm();
    if (invalid) {
      setErrorMsg(invalid);
      toast.error(invalid);
      return;
    }
    // La casilla se revisa al final: su error aparece junto a ella solo cuando el resto está bien
    if (!consent.check()) {
      setErrorMsg('');
      return;
    }
    setErrorMsg('');
    setUploadProblem(null);
    setSending(true);
    try {
      let archivos: { pathname: string; nombre: string }[] = [];
      // D1: recién ahora (formulario válido y casilla marcada) y nunca si el campo trampa tiene texto
      if (files.length && !website) {
        if (files.some((item) => !item.pathname)) setProgress(0); // «Subiendo archivos… 0 %» desde la consulta previa
        const upload = await uploadPending(files, setProgress);
        setAttachments(upload.items);
        if (upload.ok === false) {
          // Los datos y la lista quedan: el aviso bajo el campo trae sus botones
          setUploadProblem(upload.reason === 'limit' ? { kind: 'limit' } : { kind: 'failed', id: upload.id });
          return;
        }
        archivos = upload.items.map((item) => ({ pathname: item.pathname as string, nombre: item.file.name }));
      }
      setProgress(null);
      const { reference: ref, crmFailed } = await submitProjectQuote({
        ...buildPayload(),
        ...(archivos.length ? { archivos } : {}),
      });
      // Conversión solo si el servidor confirmó la solicitud con su referencia PY- (la trampa
      // contra bots responde { success: true } sin ella). La referencia no se envía.
      if (ref) trackLead('cotizador', { project_type: form.tipoProyecto });
      toast.success('Propuesta solicitada', { description: responseTimePromise });
      setReference(ref);
      // Sin negocio en Pipedrive los adjuntos no quedan guardados: la confirmación no los cuenta
      setSentFiles(crmFailed ? 0 : archivos.length);
      setSubmitted(true);
    } catch (err) {
      // Los datos quedan en el formulario para reintentar
      console.error('[SmartQuotePage]', err);
      const reason = err instanceof SubmitError ? err.reason : 'exception';
      const httpStatus = err instanceof SubmitError ? err.httpStatus : 0;
      const code = err instanceof SubmitError ? err.code : undefined;
      sendEvent('cotizador_submit_error', { reason, http_status: httpStatus });
      if (code === CONSENT_ERROR_CODE) {
        // El servidor no recibió la casilla: el aviso va junto a ella, sin mensaje general
        setErrorMsg('');
        consent.flagMissing();
        return;
      }
      const message = submitErrorMessage(httpStatus, code);
      setErrorMsg(message);
      toast.error(message);
    } finally {
      setProgress(null);
      setSending(false);
    }
  };

  /** Lista nueva desde el campo: un aviso de la subida ya no corresponde. */
  const changeAttachments = (items: AttachmentItem[]) => {
    setAttachments(items);
    setUploadProblem(null);
  };

  const skipFailedFile = () => {
    if (uploadProblem?.kind !== 'failed') return;
    const failedId = uploadProblem.id;
    const next = attachments.filter((item) => item.id !== failedId);
    setAttachments(next);
    void send(next);
  };

  const sendWithoutFiles = () => {
    setAttachments([]);
    void send([]);
  };

  if (submitted) {
    // Los datos del proyecto (no los de contacto) van en el resumen para imprimir
    const projectData = [
      ['Tipo de proyecto', form.tipoProyecto],
      ['m2 aproximados', form.m2.trim()],
      ['Altura del espacio (m)', form.altura.trim()],
      ['Tipo de aplicación', form.aplicacion.trim()],
      ['Nivel de iluminación', form.nivelIluminacion],
      ['Ciudad / Región', form.ciudad.trim()],
      ['Plazo del proyecto', form.plazo.trim()],
    ].filter(([, value]) => value);
    return (
      // El foco pasa al título de la confirmación (el botón enfocado desaparece)
      <RequestConfirmation
        form="cotizador"
        idPrefix="sq-sent"
        title="Propuesta solicitada"
        reference={reference}
        attachments={sentFiles}
        steps={PROJECT_STEPS}
        summary={
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            {projectData.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="break-words">{value}</dd>
              </div>
            ))}
          </dl>
        }
        seo={<Seo title={SEO_TITLE} description={SEO_DESCRIPTION} path="/cotizador" />}
        back={{ to: '/', label: 'Volver al inicio' }}
      />
    );
  }

  return (
    <div className="container py-8">
      <Seo title={SEO_TITLE} description={SEO_DESCRIPTION} path="/cotizador" />
      {/* data-elights-form (en el formulario y en la confirmación): la etiqueta de Google excluye
          este bloque de la detección automática de datos. Es fijo: igual en el servidor y en el navegador. */}
      <div className="max-w-2xl mx-auto" data-elights-form="cotizador">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 bg-accent text-accent-foreground text-xs font-semibold px-3 py-1.5 rounded-full mb-4">
            <Zap className="h-3.5 w-3.5" />
            Cotización de proyectos
          </div>
          <h1 className="text-2xl md:text-3xl font-bold mb-2">Solicitar propuesta técnica</h1>
          <p className="text-muted-foreground">
            Describe tu proyecto y nuestro equipo preparará una propuesta integral con productos, cantidades y precios.
          </p>
        </div>
        {/* /cotizador es HTML estático (prerender) y es donde llegan /contact y /contactos (301).
            Sin JavaScript, o con la página a medio cargar, el navegador enviaría el formulario
            por su cuenta: la solicitud se perdería y, con GET, el nombre, el correo, el teléfono
            y el RUT quedarían en la URL (historial, registros de Vercel, Analytics).
            method="post" saca los datos de la URL y el fieldset deshabilitado impide escribir y
            enviar hasta que React toma el formulario. */}
        <form method="post" onSubmit={handleSubmit}>
          <fieldset disabled={!hydrated} className="min-w-0 space-y-6">
            <div className="border rounded-xl p-6 space-y-4">
              <h2 className="font-bold">Información del proyecto</h2>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="sq-tipoProyecto" className="text-sm font-medium mb-1 block">Tipo de proyecto <span className="text-destructive">*</span></label>
                  <select id="sq-tipoProyecto" name="tipoProyecto" value={form.tipoProyecto} onChange={handleChange} className={inputClass} required>
                    <option value="">Seleccionar...</option>
                    {PROJECT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="sq-m2" className="text-sm font-medium mb-1 block">m2 aproximados <span className="text-destructive">*</span></label>
                  {/* Texto y no type="number": el navegador leía "12.000" como 12 */}
                  <input id="sq-m2" name="m2" type="text" inputMode="numeric" maxLength={20} placeholder="Ej: 12000" autoComplete="off" value={form.m2} onChange={handleChange} className={inputClass} required />
                </div>
                <div>
                  <label htmlFor="sq-altura" className="text-sm font-medium mb-1 block">Altura del espacio (m)</label>
                  <input id="sq-altura" name="altura" type="number" step="0.1" min="0" max={MAX_ALTURA} value={form.altura} onChange={handleChange} className={inputClass} />
                </div>
                <div>
                  <label htmlFor="sq-aplicacion" className="text-sm font-medium mb-1 block">Tipo de aplicación</label>
                  <input id="sq-aplicacion" name="aplicacion" value={form.aplicacion} onChange={handleChange} maxLength={200} placeholder="Ej: iluminacion general, acento..." className={inputClass} />
                </div>
                <div>
                  <label htmlFor="sq-nivelIluminacion" className="text-sm font-medium mb-1 block">Nivel de iluminación</label>
                  <select id="sq-nivelIluminacion" name="nivelIluminacion" value={form.nivelIluminacion} onChange={handleChange} className={inputClass}>
                    <option value="">Seleccionar...</option>
                    {ILLUMINATION_LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="sq-ciudad" className="text-sm font-medium mb-1 block">Ciudad / Región</label>
                  <input id="sq-ciudad" name="ciudad" value={form.ciudad} onChange={handleChange} maxLength={200} autoComplete="address-level2" className={inputClass} />
                </div>
                <div>
                  <label htmlFor="sq-plazo" className="text-sm font-medium mb-1 block">Plazo del proyecto</label>
                  <input id="sq-plazo" name="plazo" value={form.plazo} onChange={handleChange} maxLength={200} placeholder="Ej: 3 meses" className={inputClass} />
                </div>
              </div>
              <div>
                <label htmlFor="sq-comentarios" className="text-sm font-medium mb-1 block">Comentarios adicionales</label>
                <textarea id="sq-comentarios" name="comentarios" value={form.comentarios} onChange={handleChange} rows={3} maxLength={MAX_COMENTARIOS} className={inputClass + ' resize-none'} />
              </div>
              <FileAttachments
                idPrefix="sq"
                items={attachments}
                onChange={changeAttachments}
                busy={sending}
                problem={uploadProblem}
                onRetry={() => void send(attachments)}
                onSkipFailed={skipFailedFile}
                onSendWithout={sendWithoutFiles}
              />
            </div>
            <div className="border rounded-xl p-6 space-y-4">
              <h2 className="font-bold">Datos de contacto</h2>
              <div className="grid sm:grid-cols-2 gap-4">
                {[
                  { name: 'nombre', label: 'Nombre y Apellido', required: true, maxLength: 120, autoComplete: 'name' },
                  { name: 'email', label: 'Email', type: 'email', required: true, maxLength: 254, autoComplete: 'email' },
                  { name: 'telefono', label: 'Teléfono', type: 'tel', required: true, maxLength: 30, autoComplete: 'tel' },
                  { name: 'rutEmpresa', label: 'RUT Empresa', maxLength: 20, autoComplete: 'off' },
                  { name: 'razonSocial', label: 'Razon Social', maxLength: 150, autoComplete: 'organization' },
                  { name: 'giro', label: 'Giro', maxLength: 150, autoComplete: 'off' },
                ].map(field => (
                  <div key={field.name}>
                    <label htmlFor={'sq-' + field.name} className="text-sm font-medium mb-1 block">
                      {field.label} {field.required && <span className="text-destructive">*</span>}
                    </label>
                    <input
                      id={'sq-' + field.name}
                      name={field.name}
                      type={field.type || 'text'}
                      value={form[field.name as keyof typeof form]}
                      onChange={handleChange}
                      maxLength={field.maxLength}
                      autoComplete={field.autoComplete}
                      className={inputClass}
                      required={field.required}
                    />
                  </div>
                ))}
                <div className="sm:col-span-2">
                  <label htmlFor="sq-direccion" className="text-sm font-medium mb-1 block">Dirección</label>
                  <input id="sq-direccion" name="direccion" value={form.direccion} onChange={handleChange} maxLength={200} autoComplete="street-address" className={inputClass} />
                </div>
              </div>
            </div>
            {/* Dentro del fieldset: antes de hidratar, las casillas también quedan deshabilitadas */}
            {consent.fields}
            {/* Error junto al botón, donde el visitante está mirando */}
            {errorMsg && (
              <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}
            <Button type="submit" size="lg" disabled={!hydrated || sending} className="w-full gradient-primary text-primary-foreground h-14 text-base font-bold gap-2">
              {sending ? (
                <>
                  <span className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />{' '}
                  {progress !== null ? `Subiendo archivos… ${progress}\u00a0%` : 'Enviando…'}
                </>
              ) : (
                <><Send className="h-5 w-5" /> Solicitar propuesta técnica</>
              )}
            </Button>
            {/* Junto al botón (el fieldset separa con space-y-6: !mt-3 lo acerca) */}
            <div className="text-center !mt-3">
              <p className="text-sm text-muted-foreground">{responseTimePromise}</p>
              <p className="text-xs text-muted-foreground mt-1">{responseTimeHours}</p>
            </div>
            {/* Campo trampa: fuera de la pantalla; si llega con texto, el servidor no crea nada.
                Va al final: como primer hijo, space-y-6 le daba al primer bloque un margen extra arriba. */}
            <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', width: 1, height: 1, overflow: 'hidden' }}>
              <label>
                No completar
                <input type="text" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
              </label>
            </div>
          </fieldset>
        </form>
      </div>
    </div>
  );
};

export default SmartQuotePage;
