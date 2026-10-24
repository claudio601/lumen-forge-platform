import { useEffect, useState } from 'react';
import { Send, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { contactEmail, whatsappDisplayNumber } from '@/config/business';
import { sendEvent, trackLead } from '@/lib/analytics';
import { getAttribution, type Attribution } from '@/lib/attribution';
import { useConsentFields } from '@/components/legal/ConsentFields';
import { CONSENT_ERRORS, CONSENT_ERROR_CODE, CONSENT_TEXTS, type ConsentInput } from '../../../api/_lib/forms/consent';

export interface InstallationLeadPayload {
  nombre: string;
  telefono: string;
  email: string;
  comuna: string;
  tipoProyecto: string;
  descripcion: string;
  tipoCliente?: 'hogar' | 'empresa' | 'condominio' | '';
  preferenciaContacto?: 'whatsapp' | 'llamada' | 'email' | '';
  /** Igual a la casilla de privacidad (el servidor lo sigue exigiendo en true). */
  aceptaContacto: boolean;
  origen: 'instalacion_web';
  website: string;
  /** Origen de la visita (src/lib/attribution.ts); sin origen la clave no viaja. */
  attribution?: Attribution;
  /** Casillas de privacidad y novedades (useConsentFields('solicitud').payload()). */
  consent: ConsentInput;
}

/**
 * Envío no confirmado por el servidor. httpStatus 0 = sin respuesta (red caída). code: el
 * `code` del cuerpo de error ('consent_required' si faltó la casilla de privacidad).
 */
class SubmitError extends Error {
  httpStatus: number;
  code?: string;
  constructor(httpStatus: number, code?: string) {
    super('HTTP ' + httpStatus);
    this.httpStatus = httpStatus;
    this.code = code;
  }
}

/**
 * El servidor envía el correo a ventas y crea el negocio en Pipedrive.
 * Solo es éxito un 2xx con { success: true }; cualquier otra respuesta lanza SubmitError.
 * Devuelve la referencia (leadRef) que confirma el servidor ('' si no viene: la trampa contra
 * bots responde { success: true } sin ella).
 */
async function submitLead(payload: InstallationLeadPayload): Promise<string> {
  let res: Response;
  try {
    res = await fetch('/api/installation-leads/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new SubmitError(0);
  }
  // Una página de error de Vercel (504, 500) llega en HTML, no en JSON
  let data: { success?: unknown; code?: unknown; leadRef?: unknown } | null = null;
  try {
    data = JSON.parse(await res.text());
  } catch { /* cuerpo no JSON */ }
  if (!res.ok || data?.success !== true) throw new SubmitError(res.status, typeof data?.code === 'string' ? data.code : undefined);
  return typeof data.leadRef === 'string' ? data.leadRef : '';
}

// Topes: los mismos que api/_lib/forms/installationLeadValidation.ts (MAX_LENGTHS)
const MAX_LENGTHS = { nombre: 120, email: 254, telefono: 30, comuna: 80, descripcion: 2000 } as const;
const FIELD_NAMES: Record<keyof typeof MAX_LENGTHS, string> = { nombre: 'El nombre', email: 'El correo', telefono: 'El teléfono', comuna: 'La comuna', descripcion: 'La descripción' };

/** Mensaje para el visitante según el estado HTTP y el code de la respuesta. */
function submitErrorMessage(httpStatus: number, code?: string): string {
  // Un 400 por la casilla nunca dice "teléfono de 8 a 12 dígitos"
  if (code === CONSENT_ERROR_CODE) return CONSENT_ERRORS.solicitud;
  if (httpStatus === 400) return 'Revisa los datos (teléfono de 8 a 12 dígitos y un correo válido) e inténtalo de nuevo.';
  if (httpStatus === 429) return 'Espera unos minutos o escríbenos por WhatsApp al ' + whatsappDisplayNumber + '.';
  return 'No pudimos registrar tu solicitud en este momento. Escríbenos por WhatsApp al ' + whatsappDisplayNumber + ' o a ' + contactEmail + ', o inténtalo de nuevo.';
}

const TIPOS_PROYECTO = ['Casa / departamento', 'Oficina', 'Local comercial', 'Bodega', 'Condominio / edificio', 'Proyecto industrial', 'Paneles solares', 'Otro'] as const;
const TIPOS_CLIENTE = [{ value: '', label: 'Selecciona...' }, { value: 'hogar', label: 'Hogar / Particular' }, { value: 'empresa', label: 'Empresa' }, { value: 'condominio', label: 'Condominio / Edificio' }] as const;
// El equipo de instalación responde por correo o por teléfono, no por WhatsApp (dueño, 2026-10-24).
// El servidor sigue aceptando 'whatsapp' de páginas abiertas antes del cambio.
const PREFS_CONTACTO = [{ value: '', label: 'Sin preferencia' }, { value: 'llamada', label: 'Llamada telefónica' }, { value: 'email', label: 'Correo electrónico' }] as const;

type FormState = 'idle' | 'sending' | 'success' | 'error';

const EMPTY_FORM = {
  nombre: '', telefono: '', email: '', comuna: '', tipoProyecto: '', descripcion: '',
  tipoCliente: '' as '' | 'hogar' | 'empresa' | 'condominio',
  preferenciaContacto: '' as '' | 'llamada' | 'email',
};

type FormValues = typeof EMPTY_FORM;

const InstallationLeadForm = () => {
  const [form, setForm] = useState<FormValues>(EMPTY_FORM);
  const [status, setStatus] = useState<FormState>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [website, setWebsite] = useState(''); // honeypot: las personas no lo ven ni lo llenan
  // Casillas de privacidad y novedades, siempre sin marcar. La nota aprobada por el dueño
  // (Vercel, Google y Pipedrive) sigue bajo la obligatoria; el bloque ocupa las dos columnas.
  const consent = useConsentFields('solicitud', { note: CONSENT_TEXTS.installationNote, className: 'sm:col-span-2' });
  // false en el HTML estático (prerender) y en el primer render del navegador; true cuando
  // React ya tomó el formulario. Mientras sea false, todo queda deshabilitado.
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    sendEvent('instalacion_form_view');
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
  };

  const buildPayload = (): InstallationLeadPayload => ({
    nombre: form.nombre.trim(), telefono: form.telefono.trim(), email: form.email.trim(),
    comuna: form.comuna.trim(), tipoProyecto: form.tipoProyecto, descripcion: form.descripcion.trim(),
    tipoCliente: form.tipoCliente, preferenciaContacto: form.preferenciaContacto,
    aceptaContacto: consent.privacy, origen: 'instalacion_web', website,
    attribution: getAttribution(),
    consent: consent.payload(),
  });

  const validateForm = (): string | null => {
    if (!form.nombre.trim() || !form.telefono.trim() || !form.email.trim() || !form.comuna.trim() || !form.tipoProyecto || !form.descripcion.trim())
      return 'Por favor completa todos los campos requeridos (*).';
    // Mismas reglas que el servidor (api/_lib/forms/installationLeadValidation.ts)
    const phoneDigits = form.telefono.replace(/\D/g, '').length;
    if (phoneDigits < 8 || phoneDigits > 12) return 'El teléfono debe tener entre 8 y 12 dígitos.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return 'Ingresa un correo electrónico válido.';
    for (const field of Object.keys(MAX_LENGTHS) as (keyof typeof MAX_LENGTHS)[]) {
      if (form[field].trim().length > MAX_LENGTHS[field]) return FIELD_NAMES[field] + ' admite hasta ' + MAX_LENGTHS[field] + ' caracteres.';
    }
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Sin la comuna: a Google Analytics no va nada que ayude a identificar a la persona
    const tipoProyecto = form.tipoProyecto;
    sendEvent('instalacion_form_submit_attempt', { tipo_proyecto: tipoProyecto });
    const invalid = validateForm();
    if (invalid) {
      setErrorMsg(invalid);
      return;
    }
    // La casilla se revisa al final: su error aparece junto a ella solo cuando el resto está bien
    if (!consent.check()) {
      setErrorMsg('');
      setStatus('idle');
      return;
    }
    setErrorMsg('');
    setStatus('sending');
    try {
      const ref = await submitLead(buildPayload());
      // Conversión solo si el servidor confirmó la solicitud con su referencia (no se envía)
      if (ref) trackLead('instalacion', { tipo_proyecto: tipoProyecto });
      setStatus('success');
      setForm(EMPTY_FORM);
      consent.reset(); // "Enviar otra solicitud" vuelve a pedir las casillas
    } catch (err) {
      // Los datos quedan en el formulario para reintentar
      console.error('[InstallationLeadForm]', err);
      const httpStatus = err instanceof SubmitError ? err.httpStatus : 0;
      const code = err instanceof SubmitError ? err.code : undefined;
      sendEvent('instalacion_form_submit_failure', {
        tipo_proyecto: tipoProyecto,
        error_message: 'http_' + httpStatus,
      });
      if (code === CONSENT_ERROR_CODE) {
        // El servidor no recibió la casilla: el aviso va junto a ella, sin mensaje general
        setStatus('idle');
        setErrorMsg('');
        consent.flagMissing();
        return;
      }
      setStatus('error');
      setErrorMsg(submitErrorMessage(httpStatus, code));
    }
  };

  const inputClass = 'w-full border border-gray-200 rounded-xl px-4 py-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all placeholder:text-gray-400';
  const labelClass = 'block text-sm font-semibold text-gray-700 mb-1.5';

  // data-elights-form (en el formulario y en la confirmación): la etiqueta de Google excluye
  // este bloque de la detección automática de datos. Es fijo: igual en el servidor y en el navegador.
  if (status === 'success') {
    return (
      <div data-elights-form="instalacion" className="flex flex-col items-center justify-center gap-4 py-16 text-center">
        <CheckCircle2 className="h-14 w-14 text-green-500" />
        <h3 className="text-xl font-bold text-gray-900">Solicitud recibida</h3>
        <p className="text-gray-500 max-w-sm text-sm leading-relaxed">Nuestro equipo revisará tu solicitud y te contactará por correo o por teléfono con una propuesta personalizada.</p>
        <button onClick={() => setStatus('idle')} className="mt-2 text-sm text-primary underline underline-offset-2 hover:text-primary/80 transition-colors">Enviar otra solicitud</button>
      </div>
    );
  }

  return (
    <div data-elights-form="instalacion">
    {/* Sin JavaScript, o con la página a medio cargar, el navegador enviaría el formulario por su
        cuenta: la solicitud se perdería y, con GET, nombre, teléfono y correo quedarían en la URL
        (historial, registros de Vercel, Analytics). method="post" saca los datos de la URL y el
        fieldset deshabilitado impide escribir y enviar hasta que React toma el formulario. */}
    <form method="post" onSubmit={handleSubmit} noValidate>
      <fieldset disabled={!hydrated} className="min-w-0">
        {/* Campo trampa para bots: invisible para personas y lectores de pantalla */}
        <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', width: 1, height: 1, overflow: 'hidden' }}>
          <label>
            No completar
            <input type="text" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
          </label>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div><label htmlFor="ilf-nombre" className={labelClass}>Nombre completo <span className="text-red-500">*</span></label><input id="ilf-nombre" name="nombre" type="text" value={form.nombre} onChange={handleChange} placeholder="Juan Pérez" maxLength={MAX_LENGTHS.nombre} className={inputClass} autoComplete="name" /></div>
          <div><label htmlFor="ilf-telefono" className={labelClass}>Teléfono <span className="text-red-500">*</span></label><input id="ilf-telefono" name="telefono" type="tel" value={form.telefono} onChange={handleChange} placeholder="+56 9 XXXX XXXX" maxLength={MAX_LENGTHS.telefono} className={inputClass} autoComplete="tel" /></div>
          <div><label htmlFor="ilf-email" className={labelClass}>Correo electrónico <span className="text-red-500">*</span></label><input id="ilf-email" name="email" type="email" value={form.email} onChange={handleChange} placeholder="correo@ejemplo.com" maxLength={MAX_LENGTHS.email} className={inputClass} autoComplete="email" /></div>
          <div><label htmlFor="ilf-comuna" className={labelClass}>Comuna <span className="text-red-500">*</span></label><input id="ilf-comuna" name="comuna" type="text" value={form.comuna} onChange={handleChange} placeholder="Ej: Las Condes, Maipú, Quilicura..." maxLength={MAX_LENGTHS.comuna} className={inputClass} /></div>
          <div className="sm:col-span-2"><label htmlFor="ilf-tipoProyecto" className={labelClass}>Tipo de proyecto <span className="text-red-500">*</span></label><select id="ilf-tipoProyecto" name="tipoProyecto" value={form.tipoProyecto} onChange={handleChange} className={inputClass}><option value="">Selecciona el tipo de proyecto...</option>{TIPOS_PROYECTO.map(t => (<option key={t} value={t}>{t}</option>))}</select></div>
          <div className="sm:col-span-2"><label htmlFor="ilf-descripcion" className={labelClass}>Descripción breve del proyecto <span className="text-red-500">*</span></label><textarea id="ilf-descripcion" name="descripcion" value={form.descripcion} onChange={handleChange} rows={3} maxLength={MAX_LENGTHS.descripcion} placeholder="Cuéntanos el espacio..." className={inputClass + ' resize-none'} /></div>
          <div><label htmlFor="ilf-tipoCliente" className={labelClass}>Tipo de cliente <span className="text-xs font-normal text-gray-400">(opcional)</span></label><select id="ilf-tipoCliente" name="tipoCliente" value={form.tipoCliente} onChange={handleChange} className={inputClass}>{TIPOS_CLIENTE.map(({ value, label }) => (<option key={value} value={value}>{label}</option>))}</select></div>
          <div><label htmlFor="ilf-preferenciaContacto" className={labelClass}>Preferencia de contacto <span className="text-xs font-normal text-gray-400">(opcional)</span></label><select id="ilf-preferenciaContacto" name="preferenciaContacto" value={form.preferenciaContacto} onChange={handleChange} className={inputClass}>{PREFS_CONTACTO.map(({ value, label }) => (<option key={value} value={value}>{label}</option>))}</select></div>
          {consent.fields}
        </div>
        <div className="mt-8">
          {/* Error junto al botón, donde el visitante está mirando */}
          {errorMsg && (<div role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 mb-4 text-sm text-red-700"><AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" /><span>{errorMsg}</span></div>)}
          <Button type="submit" size="lg" disabled={!hydrated || status === 'sending'} className="w-full h-14 text-base font-bold gap-2 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground transition-all">
            {status === 'sending' ? (<><Loader2 className="h-5 w-5 animate-spin" /> Enviando solicitud...</>) : (<><Send className="h-5 w-5" /> SOLICITAR EVALUACIÓN</>)}
          </Button>
        </div>
      </fieldset>
    </form>
    </div>
  );
};

export default InstallationLeadForm;
