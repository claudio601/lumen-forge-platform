import { useState } from 'react';
import { Send, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { contactEmail } from '@/config/business';
import { sendEvent } from '@/lib/analytics';

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
  fecha: string;
  website?: string;
}

const GAS_URL = 'https://script.google.com/macros/s/AKfycbwn2Qv3nJsNrUfBvzdpB9X70NmQfAVXgBKVw8bdmG-CXMXGsL-2IUcJaKX0mpO4kNwfOw/exec';

async function sendLeadEmail(payload: InstallationLeadPayload): Promise<void> {
  const asunto = 'Nueva solicitud de instalacion - ' + payload.comuna + ' - ' + payload.tipoProyecto;
  const cuerpo = 'NUEVA SOLICITUD | ' + payload.nombre + ' | ' + payload.telefono + ' | ' + payload.email + ' | ' + payload.comuna + ' | ' + payload.tipoProyecto + ' | ' + payload.descripcion;
  const response = await fetch(GAS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({
      to_email: contactEmail,
      reply_to: payload.email,
      from_name: payload.nombre,
      subject_override: asunto,
      nombre: payload.nombre,
      telefono: payload.telefono,
      comuna: payload.comuna,
      tipo_proyecto: payload.tipoProyecto,
      tipo_cliente: payload.tipoCliente || '-',
      preferencia_contacto: payload.preferenciaContacto || '-',
      descripcion: payload.descripcion,
      items_lista: cuerpo,
      fecha: payload.fecha,
      total: '-',
    }),
  });
  const result = await response.json();
  if (result.status !== 'ok') throw new Error(result.message || 'Error enviando solicitud');
}

async function sendToPipedrive(payload: InstallationLeadPayload): Promise<void> {
  const res = await fetch('/api/installation-leads/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let errBody = '';
    try {
      const ct = res.headers.get('content-type') ?? '';
      errBody = ct.includes('json') ? JSON.stringify(await res.json()) : await res.text();
    } catch { /* ignored */ }
    console.warn('[Pipedrive] HTTP error', { status: res.status, email: payload.email, body: errBody });
    return;
  }
  try {
    const data = await res.json();
    if (data.success)
      console.log('[Pipedrive] Lead creado/actualizado:', { dealId: data.dealId, dealAction: data.dealAction, leadScore: data.leadScore, priorityTier: data.priorityTier });
    else console.warn('[Pipedrive] Respuesta no exitosa:', data);
  } catch {
    console.warn('[Pipedrive] No se pudo parsear respuesta del endpoint');
  }
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

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    const checked = type === 'checkbox' ? (e.target as HTMLInputElement).checked : undefined;
    setForm(prev => ({ ...prev, [name]: checked !== undefined ? checked : value }));
  };

  const buildPayload = (): InstallationLeadPayload => ({
    nombre: form.nombre.trim(), telefono: form.telefono.trim(), email: form.email.trim(),
    comuna: form.comuna.trim(), tipoProyecto: form.tipoProyecto, descripcion: form.descripcion.trim(),
    tipoCliente: form.tipoCliente, preferenciaContacto: form.preferenciaContacto,
    aceptaContacto: form.aceptaContacto, origen: 'instalacion_web',
    fecha: new Date().toLocaleDateString('es-CL', { dateStyle: 'long' }),
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.nombre || !form.telefono || !form.email || !form.comuna || !form.tipoProyecto || !form.descripcion) {
      setErrorMsg('Por favor completa todos los campos requeridos (*).');
      return;
    }
    if (!form.aceptaContacto) {
      setErrorMsg('Debes aceptar que te contactemos para continuar.');
      return;
    }
    setErrorMsg('');
    setStatus('sending');
    try {
      const payload = buildPayload();
      await sendLeadEmail(payload);
      sendToPipedrive(payload).catch(err => { console.warn('[Pipedrive] Error inesperado:', err); });
      sendEvent('instalacion_form_submit_success', { tipoProyecto: form.tipoProyecto, comuna: form.comuna.trim() });
      setStatus('success');
      setForm(EMPTY_FORM);
    } catch (err) {
      console.error('[InstallationLeadForm]', err);
      setStatus('error');
      setErrorMsg('No pudimos enviar tu solicitud. Por favor escribenos por WhatsApp o intentalo de nuevo.');
    }
  };

  const inputClass = 'w-full border border-gray-200 rounded-xl px-4 py-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-purple-400/40 focus:border-purple-500 transition-all placeholder:text-gray-400';
  const labelClass = 'block text-sm font-semibold text-gray-700 mb-1.5';

  if (status === 'success') {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
        <CheckCircle2 className="h-14 w-14 text-green-500" />
        <h3 className="text-xl font-bold text-gray-900">Solicitud recibida</h3>
        <p className="text-gray-500 max-w-sm text-sm leading-relaxed">Nuestro equipo revisara tu solicitud y te contactara en menos de 24 horas habiles con una propuesta personalizada.</p>
        <button onClick={() => setStatus('idle')} className="mt-2 text-sm text-purple-600 underline underline-offset-2 hover:text-purple-800 transition-colors">Enviar otra solicitud</button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <input type="text" name="website" style={{ display: 'none' }} tabIndex={-1} autoComplete="off" aria-hidden="true" />
      {errorMsg && (<div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 mb-6 text-sm text-red-700"><AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />{errorMsg}</div>)}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <div><label htmlFor="ilf-nombre" className={labelClass}>Nombre completo <span className="text-red-500">*</span></label><input id="ilf-nombre" name="nombre" type="text" value={form.nombre} onChange={handleChange} placeholder="Juan Perez" className={inputClass} autoComplete="name" /></div>
        <div><label htmlFor="ilf-telefono" className={labelClass}>Telefono <span className="text-red-500">*</span></label><input id="ilf-telefono" name="telefono" type="tel" value={form.telefono} onChange={handleChange} placeholder="+56 9 XXXX XXXX" className={inputClass} autoComplete="tel" /></div>
        <div><label htmlFor="ilf-email" className={labelClass}>Correo electronico <span className="text-red-500">*</span></label><input id="ilf-email" name="email" type="email" value={form.email} onChange={handleChange} placeholder="correo@ejemplo.com" className={inputClass} autoComplete="email" /></div>
        <div><label htmlFor="ilf-comuna" className={labelClass}>Comuna <span className="text-red-500">*</span></label><input id="ilf-comuna" name="comuna" type="text" value={form.comuna} onChange={handleChange} placeholder="Ej: Las Condes, Maipu, Quilicura..." className={inputClass} /></div>
        <div className="sm:col-span-2"><label htmlFor="ilf-tipoProyecto" className={labelClass}>Tipo de proyecto <span className="text-red-500">*</span></label><select id="ilf-tipoProyecto" name="tipoProyecto" value={form.tipoProyecto} onChange={handleChange} className={inputClass}><option value="">Selecciona el tipo de proyecto...</option>{TIPOS_PROYECTO.map(t => (<option key={t} value={t}>{t}</option>))}</select></div>
        <div className="sm:col-span-2"><label htmlFor="ilf-descripcion" className={labelClass}>Descripcion breve del proyecto <span className="text-red-500">*</span></label><textarea id="ilf-descripcion" name="descripcion" value={form.descripcion} onChange={handleChange} rows={3} placeholder="Cuentanos el espacio..." className={inputClass + ' resize-none'} /></div>
        <div><label htmlFor="ilf-tipoCliente" className={labelClass}>Tipo de cliente <span className="text-xs font-normal text-gray-400">(opcional)</span></label><select id="ilf-tipoCliente" name="tipoCliente" value={form.tipoCliente} onChange={handleChange} className={inputClass}>{TIPOS_CLIENTE.map(({ value, label }) => (<option key={value} value={value}>{label}</option>))}</select></div>
        <div><label htmlFor="ilf-preferenciaContacto" className={labelClass}>Preferencia de contacto <span className="text-xs font-normal text-gray-400">(opcional)</span></label><select id="ilf-preferenciaContacto" name="preferenciaContacto" value={form.preferenciaContacto} onChange={handleChange} className={inputClass}>{PREFS_CONTACTO.map(({ value, label }) => (<option key={value} value={value}>{label}</option>))}</select></div>
        <div className="sm:col-span-2"><label className="flex items-start gap-3 cursor-pointer select-none"><input type="checkbox" name="aceptaContacto" checked={form.aceptaContacto} onChange={handleChange} className="mt-0.5 h-4 w-4 flex-shrink-0 rounded border-gray-300 accent-purple-600 cursor-pointer" /><span className="text-sm text-gray-600 leading-snug">Acepto que eLIGHTS me contacte para responder a esta solicitud. No compartiremos tus datos con terceros. <span className="text-red-500">*</span></span></label></div>
      </div>
      <div className="mt-8">
        <Button type="submit" size="lg" disabled={status === 'sending'} className="w-full h-14 text-base font-bold gap-2 rounded-xl text-white transition-all" style={{ background: 'linear-gradient(135deg, #7C3AED, #F59E0B)' }}>
          {status === 'sending' ? (<><Loader2 className="h-5 w-5 animate-spin" /> Enviando solicitud...</>) : (<><Send className="h-5 w-5" /> SOLICITAR EVALUACION</>)}
        </Button>
        <p className="text-center text-xs text-gray-400 mt-3">Te respondemos en menos de 24 horas habiles - Sin compromiso</p>
      </div>
    </form>
  );
};

export default InstallationLeadForm;
