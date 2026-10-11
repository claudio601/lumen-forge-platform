import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Send, CheckCircle2, Upload, Zap, AlertCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { sendEvent, trackLead } from '@/lib/analytics';
import { waBase, contactEmail, whatsappDisplayNumber } from '@/config/business';
import Seo from '@/components/Seo';
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

/** Envío no confirmado por el servidor. httpStatus 0 = sin respuesta (red caída). */
class SubmitError extends Error {
  reason: string;
  httpStatus: number;
  constructor(reason: string, httpStatus: number) {
    super(reason + ' (HTTP ' + httpStatus + ')');
    this.reason = reason;
    this.httpStatus = httpStatus;
  }
}

/** Solo es éxito un 2xx con { success: true }. Devuelve la referencia PY- ('' si no viene). */
async function submitProjectQuote(payload: Record<string, unknown>): Promise<string> {
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
  let data: { success?: unknown; reference?: unknown } | null = null;
  try {
    data = JSON.parse(await res.text());
  } catch { /* cuerpo no JSON */ }

  if (!res.ok) throw new SubmitError('api_error', res.status);
  if (!data) throw new SubmitError('invalid_body', res.status);
  if (data.success !== true) throw new SubmitError('not_success', res.status);
  return typeof data.reference === 'string' ? data.reference : '';
}

/** Mensaje para el visitante según el estado HTTP de la respuesta. */
function submitErrorMessage(httpStatus: number): string {
  if (httpStatus === 400) return 'Revisa email y teléfono (8 a 12 dígitos) e inténtalo de nuevo.';
  if (httpStatus === 429) {
    return 'Hiciste varios envíos seguidos. Espera unos minutos o escríbenos por WhatsApp al ' + whatsappDisplayNumber + '.';
  }
  return (
    'No pudimos enviar tu solicitud. Inténtalo de nuevo o escríbenos por WhatsApp al ' +
    whatsappDisplayNumber + ' o a ' + contactEmail + '.'
  );
}

/** Texto opcional recortado; vacío no viaja en el JSON. */
const optional = (value: string) => value.trim() || undefined;

const inputClass = 'w-full border rounded-lg px-3 py-2.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30';

const SmartQuotePage = () => {
  const [submitted, setSubmitted] = useState(false);
  const [sending, setSending] = useState(false);
  const [reference, setReference] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [website, setWebsite] = useState(''); // honeypot: las personas no lo ven ni lo llenan
  // false en el HTML estático (prerender) y en el primer render del navegador; true cuando
  // React ya tomó el formulario. Mientras sea false, todo queda deshabilitado.
  const [hydrated, setHydrated] = useState(false);
  const successHeading = useRef<HTMLHeadingElement>(null);
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

  // El botón enfocado desaparece al confirmar: el foco pasa al título de la confirmación
  useEffect(() => {
    if (submitted) successHeading.current?.focus();
  }, [submitted]);

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
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sending) return;
    const invalid = validateForm();
    if (invalid) {
      setErrorMsg(invalid);
      toast.error(invalid);
      return;
    }
    setErrorMsg('');
    setSending(true);
    try {
      const ref = await submitProjectQuote(buildPayload());
      // Conversión solo cuando el servidor confirmó la solicitud
      trackLead('cotizador', { project_type: form.tipoProyecto });
      toast.success('Propuesta solicitada — te contactamos pronto');
      setReference(ref);
      setSubmitted(true);
    } catch (err) {
      // Los datos quedan en el formulario para reintentar
      console.error('[SmartQuotePage]', err);
      const reason = err instanceof SubmitError ? err.reason : 'exception';
      const httpStatus = err instanceof SubmitError ? err.httpStatus : 0;
      sendEvent('cotizador_submit_error', { reason, httpStatus });
      const message = submitErrorMessage(httpStatus);
      setErrorMsg(message);
      toast.error(message);
    } finally {
      setSending(false);
    }
  };

  if (submitted) {
    return (
      <div className="container py-16 text-center max-w-md mx-auto">
    <Seo title="Cotizar Iluminación LED | eLIGHTS Chile" description="Solicita una cotización de iluminación LED profesional. Productos técnicos para proyectos comerciales, industriales y residenciales." path="/cotizador" />

        <CheckCircle2 className="h-16 w-16 text-primary mx-auto mb-4" />
        <h1 ref={successHeading} tabIndex={-1} className="text-2xl font-bold mb-2 focus:outline-none">Propuesta solicitada!</h1>
        {reference && (
          <p className="text-sm font-medium mb-2">
            Tu referencia: <span className="font-mono">{reference}</span>
          </p>
        )}
        <p className="text-muted-foreground mb-2">
          Nuestro equipo técnico preparara una propuesta personalizada y te contactará en menos de 24 horas hábiles.
        </p>
        <p className="text-sm text-muted-foreground mb-8">
          También puedes escribirnos a{' '}
          <a href={'mailto:' + contactEmail} className="text-primary underline">{contactEmail}</a>
          {' '}o al{' '}
          <a href={waBase} className="text-primary underline">{whatsappDisplayNumber}</a>.
        </p>
        <Button asChild className="gradient-primary text-primary-foreground">
          <Link to="/">Volver al inicio</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="container py-8">
      <Seo title="Cotizar Iluminación LED | eLIGHTS Chile" description="Solicita una cotización de iluminación LED profesional. Productos técnicos para proyectos comerciales, industriales y residenciales." path="/cotizador" />
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 bg-accent text-accent-foreground text-xs font-semibold px-3 py-1.5 rounded-full mb-4">
            <Zap className="h-3.5 w-3.5" />
            Cotizador Inteligente
          </div>
          <h1 className="text-2xl md:text-3xl font-bold mb-2">Solicitar propuesta tecnica</h1>
          <p className="text-muted-foreground">
            Describe tu proyecto y nuestro equipo preparara una propuesta integral con productos, cantidades y precios especiales.
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
              <div className="border-2 border-dashed rounded-xl p-6 text-center text-muted-foreground">
                <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground/50" />
                <p className="text-sm">Adjuntar planos o especificaciones (proximamente)</p>
              </div>
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
            {/* Error junto al botón, donde el visitante está mirando */}
            {errorMsg && (
              <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}
            <Button type="submit" size="lg" disabled={!hydrated || sending} className="w-full gradient-primary text-primary-foreground h-14 text-base font-bold gap-2">
              {sending ? (
                <><span className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Enviando...</>
              ) : (
                <><Send className="h-5 w-5" /> Solicitar propuesta tecnica</>
              )}
            </Button>
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
