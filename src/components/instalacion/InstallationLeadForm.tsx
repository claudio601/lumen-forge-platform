import { useEffect, useState } from 'react';
import { Send, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { contactEmail, whatsappDisplayNumber } from '@/config/business';
import { sendEvent, trackLead } from '@/lib/analytics';

export interface InstallationLeadPayload {
  nombre: string;
  telefono: string;
  email: string;
  comuna: string;
  tipoProyecto: string;
  descripcion: string;
  tipoCliente?: 'hogar' | 'empresa' | 'condominio' | '';
  preferenciaContacto?: 'whatsapp' | 'llamada' | 'email' | '';
  aceptaContacto: boolean;
  origen: 'instalacion_web';
  website: string;
}

/** Envío no confirmado por el servidor. httpStatus 0 = sin respuesta (red caída). */
class SubmitError extends Error {
  httpStatus: number;
  constructor(httpStatus: number) {
    super('HTTP ' + httpStatus);
    this.httpStatus = httpStatus;
  }
}

/**
 * El servidor envía el correo a ventas y crea el negocio en Pipedrive.
 * Solo es éxito un 2xx con { success: true }; cualquier otra respuesta lanza SubmitError.
 */
async function submitLead(payload: InstallationLeadPayload): Promise<void> {
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
  let data: { success?: unknown } | null = null;
  try {
    data = JSON.parse(await res.text());
  } catch { /* cuerpo no JSON */ }
  if (!res.ok || data?.success !== true) throw new SubmitError(res.status);
}

// Topes: los mismos que api/installation-leads/validation.ts (MAX_LENGTHS)
const MAX_LENGTHS = { nombre: 120, email: 254, telefono: 30, comuna: 80, descripcion: 2000 } as const;
const FIELD_NAMES: Record<keyof typeof MAX_LENGTHS, string> = { nombre: 'El nombre', email: 'El correo', telefono: 'El teléfono', comuna: 'La comuna', descripcion: 'La descripción' };

/** Mensaje para el visitante según el estado HTTP de la respuesta. */
function submitErrorMessage(httpStatus: number): string {
  if (httpStatus === 400) return 'Revisa los datos (teléfono de 8 a 12 dígitos y un correo válido) e inténtalo de nuevo.';
  if (httpStatus === 429) return 'Espera unos minutos o escríbenos por WhatsApp al ' + whatsappDisplayNumber + '.';
  return 'No pudimos registrar tu solicitud en este momento. Escríbenos por WhatsApp al ' + whatsappDisplayNumber + ' o a ' + contactEmail + ', o inténtalo de nuevo.';
}

const TIPOS_PROYECTO = ['Casa / departamento', 'Oficina', 'Local comercial', 'Bodega', 'Condominio / edificio', 'Proyecto industrial', 'Paneles solares', 'Otro'] as const;
const TIPOS_CLIENTE = [{ value: '', label: 'Selecciona...' }, { value: 'hogar', label: 'Hogar / Particular' }, { value: 'empresa', label: 'Empresa' }, { value: 'condominio', label: 'Condominio / Edificio' }] as const;
const PREFS_CONTACTO = [{ value: '', label: 'Sin preferencia' }, { value: 'whatsapp', label: 'WhatsApp' }, { value: 'llamada', label: 'Llamada telefonica' }, { value: 'email', label: 'Correo electronico' }] as const;

type FormState = 'idle' | 'sending' | 'success' | 'error';

const EMPTY_FORM = {
  nombre: '', telefono: '', email: '', comuna: '', tipoProyecto: '', descripcion: '',
  tipoCliente: '' as '' | 'hogar' | 'empresa' | 'condominio',
  preferenciaContacto: '' as '' | 'whatsapp' | 'llamada' | 'email',
  aceptaContacto: false,
};

type FormValues = typeof EMPTY_FORM;

const InstallationLeadForm = () => {
  const [form, setForm] = useState<FormValues>(EMPTY_FORM);
  const [status, setStatus] = useState<FormState>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [website, setWebsite] = useState(''); // honeypot: las personas no lo ven ni lo llenan
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
    const { name, value, type } = e.target;
    const checked = type === 'checkbox' ? (e.target as HTMLInputElement).checked : undefined;
    setForm(prev => ({ ...prev, [name]: checked !== undefined ? checked : value }));
  };

  const buildPayload = (): InstallationLeadPayload => ({
    nombre: form.nombre.trim(), telefono: form.telefono.trim(), email: form.email.trim(),
    comuna: form.comuna.trim(), tipoProyecto: form.tipoProyecto, descripcion: form.descripcion.trim(),
    tipoCliente: form.tipoCliente, preferenciaContacto: form.preferenciaContacto,
    aceptaContacto: form.aceptaContacto, origen: 'instalacion_web', website,
  });

  const validateForm = (): string | null => {
    if (!form.nombre.trim() || !form.telefono.trim() || !form.email.trim() || !form.comuna.trim() || !form.tipoProyecto || !form.descripcion.trim())
      return 'Por favor completa todos los campos requeridos (*).';
    // Mismas reglas que el servidor (api/installation-leads/validation.ts)
    const phoneDigits = form.telefono.replace(/\D/g, '').length;
    if (phoneDigits < 8 || phoneDigits > 12) return 'El teléfono debe tener entre 8 y 12 dígitos.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return 'Ingresa un correo electrónico válido.';
    for (const field of Object.keys(MAX_LENGTHS) as (keyof typeof MAX_LENGTHS)[]) {
      if (form[field].trim().length > MAX_LENGTHS[field]) return FIELD_NAMES[field] + ' admite hasta ' + MAX_LENGTHS[field] + ' caracteres.';
    }
    if (!form.aceptaContacto) return 'Debes aceptar que te contactemos para continuar.';
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const tipoProyecto = form.tipoProyecto;
    const comuna = form.comuna.trim();
    sendEvent('instalacion_form_submit_attempt', { tipoProyecto, comuna });
    const invalid = validateForm();
    if (invalid) {
      setErrorMsg(invalid);
      return;
    }
    setErrorMsg('');
    setStatus('sending');
    try {
      await submitLead(buildPayload());
      // GA4: conversión solo cuando el servidor confirmó la solicitud
      trackLead('instalacion', { tipo_proyecto: tipoProyecto, comuna });
      setStatus('success');
      setForm(EMPTY_FORM);
    } catch (err) {
      // Los datos quedan en el formulario para reintentar
      console.error('[InstallationLeadForm]', err);
      const httpStatus = err instanceof SubmitError ? err.httpStatus : 0;
      sendEvent('instalacion_form_submit_failure', {
        tipoProyecto,
        comuna,
        error_message: 'http_' + httpStatus,
      });
      setStatus('error');
      setErrorMsg(submitErrorMessage(httpStatus));
    }
  };

  const inputClass = 'w-full border border-gray-200 rounded-xl px-4 py-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all placeholder:text-gray-400';
  const labelClass = 'block text-sm font-semibold text-gray-700 mb-1.5';

  if (status === 'success') {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
        <CheckCircle2 className="h-14 w-14 text-green-500" />
        <h3 className="text-xl font-bold text-gray-900">Solicitud recibida</h3>
        <p className="text-gray-500 max-w-sm text-sm leading-relaxed">Nuestro equipo revisará tu solicitud y te contactará con una propuesta personalizada.</p>
        <button onClick={() => setStatus('idle')} className="mt-2 text-sm text-primary underline underline-offset-2 hover:text-primary/80 transition-colors">Enviar otra solicitud</button>
      </div>
    );
  }

  return (
    // Sin JavaScript, o con la página a medio cargar, el navegador enviaría el formulario por su
    // cuenta: la solicitud se perdería y, con GET, nombre, teléfono y correo quedarían en la URL
    // (historial, registros de Vercel, Analytics). method="post" saca los datos de la URL y el
    // fieldset deshabilitado impide escribir y enviar hasta que React toma el formulario.
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
          <div><label htmlFor="ilf-nombre" className={labelClass}>Nombre completo <span className="text-red-500">*</span></label><input id="ilf-nombre" name="nombre" type="text" value={form.nombre} onChange={handleChange} placeholder="Juan Perez" maxLength={MAX_LENGTHS.nombre} className={inputClass} autoComplete="name" /></div>
          <div><label htmlFor="ilf-telefono" className={labelClass}>Telefono <span className="text-red-500">*</span></label><input id="ilf-telefono" name="telefono" type="tel" value={form.telefono} onChange={handleChange} placeholder="+56 9 XXXX XXXX" maxLength={MAX_LENGTHS.telefono} className={inputClass} autoComplete="tel" /></div>
          <div><label htmlFor="ilf-email" className={labelClass}>Correo electronico <span className="text-red-500">*</span></label><input id="ilf-email" name="email" type="email" value={form.email} onChange={handleChange} placeholder="correo@ejemplo.com" maxLength={MAX_LENGTHS.email} className={inputClass} autoComplete="email" /></div>
          <div><label htmlFor="ilf-comuna" className={labelClass}>Comuna <span className="text-red-500">*</span></label><input id="ilf-comuna" name="comuna" type="text" value={form.comuna} onChange={handleChange} placeholder="Ej: Las Condes, Maipu, Quilicura..." maxLength={MAX_LENGTHS.comuna} className={inputClass} /></div>
          <div className="sm:col-span-2"><label htmlFor="ilf-tipoProyecto" className={labelClass}>Tipo de proyecto <span className="text-red-500">*</span></label><select id="ilf-tipoProyecto" name="tipoProyecto" value={form.tipoProyecto} onChange={handleChange} className={inputClass}><option value="">Selecciona el tipo de proyecto...</option>{TIPOS_PROYECTO.map(t => (<option key={t} value={t}>{t}</option>))}</select></div>
          <div className="sm:col-span-2"><label htmlFor="ilf-descripcion" className={labelClass}>Descripcion breve del proyecto <span className="text-red-500">*</span></label><textarea id="ilf-descripcion" name="descripcion" value={form.descripcion} onChange={handleChange} rows={3} maxLength={MAX_LENGTHS.descripcion} placeholder="Cuentanos el espacio..." className={inputClass + ' resize-none'} /></div>
          <div><label htmlFor="ilf-tipoCliente" className={labelClass}>Tipo de cliente <span className="text-xs font-normal text-gray-400">(opcional)</span></label><select id="ilf-tipoCliente" name="tipoCliente" value={form.tipoCliente} onChange={handleChange} className={inputClass}>{TIPOS_CLIENTE.map(({ value, label }) => (<option key={value} value={value}>{label}</option>))}</select></div>
          <div><label htmlFor="ilf-preferenciaContacto" className={labelClass}>Preferencia de contacto <span className="text-xs font-normal text-gray-400">(opcional)</span></label><select id="ilf-preferenciaContacto" name="preferenciaContacto" value={form.preferenciaContacto} onChange={handleChange} className={inputClass}>{PREFS_CONTACTO.map(({ value, label }) => (<option key={value} value={value}>{label}</option>))}</select></div>
          <div className="sm:col-span-2"><label className="flex items-start gap-3 cursor-pointer select-none"><input type="checkbox" name="aceptaContacto" checked={form.aceptaContacto} onChange={handleChange} aria-describedby="ilf-consent-note" className="mt-0.5 h-4 w-4 flex-shrink-0 rounded border-gray-300 accent-primary cursor-pointer" /><span className="text-sm text-gray-600 leading-snug">Acepto que eLIGHTS me contacte por teléfono, WhatsApp o correo para responder esta solicitud. <span className="text-red-500">*</span></span></label><p id="ilf-consent-note" className="mt-2 pl-7 text-xs text-gray-600 leading-snug">Usamos estos datos para responder y dar seguimiento a tu solicitud. Quedan registrados en los servicios con que trabajamos: Vercel (sitio web), Google (correo) y Pipedrive (gestión de clientes).</p></div>
        </div>
        <div className="mt-8">
          {/* Error junto al botón, donde el visitante está mirando */}
          {errorMsg && (<div role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 mb-4 text-sm text-red-700"><AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" /><span>{errorMsg}</span></div>)}
          <Button type="submit" size="lg" disabled={!hydrated || status === 'sending'} className="w-full h-14 text-base font-bold gap-2 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground transition-all">
            {status === 'sending' ? (<><Loader2 className="h-5 w-5 animate-spin" /> Enviando solicitud...</>) : (<><Send className="h-5 w-5" /> SOLICITAR EVALUACION</>)}
          </Button>
        </div>
      </fieldset>
    </form>
  );
};

export default InstallationLeadForm;
