// src/components/estudio-luminico/EstudioLuminicoLeadForm.tsx
import { useState } from 'react';
import { Send, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { contactEmail, whatsappDisplayNumber } from '@/config/business';
import { sendEvent, trackLead } from '@/lib/analytics';

// ── Tipos del formulario ──────────────────────────────────────────────────────

export interface EstudioLuminicoFormPayload {
  nombreCompleto: string;
  email: string;
  telefono: string;
  tipoProyecto: string;
  comunaCiudad: string;
  tienePlanos: string;
  dimensionesAproximadas: string;
  alturaMontaje: string;
  objetivoProyecto: string;
  empresa?: string;
  normativaObjetivo?: string;
  urgenciaProyecto?: string;
  descripcionProyecto?: string;
  origen: 'estudio_luminico_web';
  fecha: string;
  landingPath: '/estudio-luminico';
  website?: string;
}

// ── Opciones de selects ───────────────────────────────────────────────────────

const TIPOS_PROYECTO = [
  { value: 'cancha_deportiva', label: 'Estadio / Cancha deportiva' },
  { value: 'industria_bodega', label: 'Industria / Bodega' },
  { value: 'estacionamiento', label: 'Estacionamiento' },
  { value: 'edificio_comercial', label: 'Edificio comercial' },
  { value: 'vialidad_exterior', label: 'Vialidad / Exterior' },
  { value: 'proyecto_especial', label: 'Proyecto especial (otro)' },
] as const;

const TIENE_PLANOS = [
  { value: 'si_dwg_listo', label: 'Si, los tengo listos' },
  { value: 'si_preparar', label: 'Si, pero necesito prepararlos' },
  { value: 'no_tengo', label: 'No, necesito orientacion' },
] as const;

const OBJETIVOS = [
  { value: 'entrenamiento', label: 'Entrenamiento deportivo' },
  { value: 'competencia', label: 'Competencia / Partido oficial' },
  { value: 'operacion_industrial', label: 'Operacion industrial' },
  { value: 'seguridad', label: 'Seguridad / Vigilancia' },
  { value: 'licitacion', label: 'Licitación / Ingenieria' },
  { value: 'no_definido', label: 'No lo tengo claro' },
] as const;

const NORMATIVAS = [
  { value: '', label: 'No estoy seguro' },
  { value: 'criterios_fifa', label: 'Criterios FIFA aplicables' },
  { value: 'en_12193', label: 'EN 12193 (deportivo)' },
  { value: 'en_12464', label: 'EN 12464 (industria/comercial)' },
  { value: 'en_13201', label: 'EN 13201 (vialidad)' },
  { value: 'sec_chile', label: 'SEC / RIC Chile' },
] as const;

const URGENCIAS = [
  { value: '', label: 'Sin urgencia definida' },
  { value: 'urgente', label: 'Urgente (menos de 1 semana)' },
  { value: 'este_mes', label: 'Este mes' },
  { value: 'evaluando', label: 'Evaluando opciones' },
  { value: 'futura_licitacion', label: 'Licitación futura' },
] as const;

// ── Estado vacio del formulario ───────────────────────────────────────────────

const EMPTY_FORM = {
  nombreCompleto: '',
  email: '',
  telefono: '',
  tipoProyecto: '',
  comunaCiudad: '',
  tienePlanos: '',
  dimensionesAproximadas: '',
  alturaMontaje: '',
  objetivoProyecto: '',
  empresa: '',
  normativaObjetivo: '',
  urgenciaProyecto: '',
  descripcionProyecto: '',
};

type FormValues = typeof EMPTY_FORM;
type FormState = 'idle' | 'sending' | 'success' | 'error';

// ── Envio al endpoint (correo a ventas + Pipedrive en el servidor) ────────────

/** Envio no confirmado por el servidor. httpStatus 0 = sin respuesta (red caida). */
class SubmitError extends Error {
  reason: string;
  httpStatus: number;
  constructor(reason: string, httpStatus: number) {
    super(reason + ' (HTTP ' + httpStatus + ')');
    this.reason = reason;
    this.httpStatus = httpStatus;
  }
}

/** Solo es exito un 2xx con { success: true }; cualquier otra respuesta lanza SubmitError. */
async function submitEstudioLead(payload: EstudioLuminicoFormPayload): Promise<void> {
  let res: Response;
  try {
    res = await fetch('/api/estudio-luminico/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new SubmitError('network', 0);
  }

  // Una pagina de error de Vercel (504, 500) llega en HTML, no en JSON
  let data: { success?: unknown } | null = null;
  try {
    data = JSON.parse(await res.text());
  } catch { /* cuerpo no JSON */ }

  if (!res.ok) throw new SubmitError('api_error', res.status);
  if (!data) throw new SubmitError('invalid_body', res.status);
  if (data.success !== true) throw new SubmitError('not_success', res.status);
}

// Tope de la descripcion: el mismo que api/estudio-luminico/validation.ts
// (MAX_DESCRIPCION_PROYECTO), para que la nota completa quepa en el correo a ventas.
const MAX_DESCRIPCION = 2000;

/** Mensaje para el visitante segun el estado HTTP de la respuesta. */
function submitErrorMessage(httpStatus: number): string {
  if (httpStatus === 400) return 'Revisa los datos (teléfono de 8 a 15 dígitos) e inténtalo de nuevo.';
  if (httpStatus === 429) return 'Espera unos minutos o escríbenos por WhatsApp al ' + whatsappDisplayNumber + '.';
  return (
    'No pudimos registrar tu solicitud en este momento. Escríbenos por WhatsApp al ' +
    whatsappDisplayNumber + ' o a ' + contactEmail + ', o inténtalo de nuevo.'
  );
}

// ── Componente principal ──────────────────────────────────────────────────────

const EstudioLuminicoLeadForm = () => {
  const [form, setForm] = useState<FormValues>(EMPTY_FORM);
  const [status, setStatus] = useState<FormState>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [website, setWebsite] = useState(''); // honeypot: las personas no lo ven ni lo llenan

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const buildPayload = (): EstudioLuminicoFormPayload => ({
    nombreCompleto: form.nombreCompleto.trim(),
    email: form.email.trim(),
    telefono: form.telefono.trim(),
    tipoProyecto: form.tipoProyecto,
    comunaCiudad: form.comunaCiudad.trim(),
    tienePlanos: form.tienePlanos,
    dimensionesAproximadas: form.dimensionesAproximadas.trim(),
    alturaMontaje: form.alturaMontaje.trim(),
    objetivoProyecto: form.objetivoProyecto,
    empresa: form.empresa?.trim() || undefined,
    normativaObjetivo: form.normativaObjetivo || undefined,
    urgenciaProyecto: form.urgenciaProyecto || undefined,
    descripcionProyecto: form.descripcionProyecto?.trim() || undefined,
    origen: 'estudio_luminico_web',
    fecha: new Date().toLocaleDateString('es-CL', { dateStyle: 'long' }),
    landingPath: '/estudio-luminico',
    website,
  });

  const validateForm = (): string | null => {
    if (!form.nombreCompleto.trim()) return 'El nombre completo es requerido.';
    if (!form.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email))
      return 'Ingresa un correo electronico valido.';
    if (!form.telefono.trim()) return 'El teléfono es requerido.';
    // Misma regla que el servidor (api/estudio-luminico/validation.ts)
    const phoneDigits = form.telefono.replace(/\D/g, '').length;
    if (phoneDigits < 8 || phoneDigits > 15) return 'El teléfono debe tener entre 8 y 15 dígitos.';
    if (!form.tipoProyecto) return 'Selecciona el tipo de proyecto.';
    if (!form.comunaCiudad.trim()) return 'La comuna o ciudad es requerida.';
    if (!form.tienePlanos) return 'Indica si tienes planos disponibles.';
    if (!form.dimensionesAproximadas.trim()) return 'Las dimensiones aproximadas son requeridas.';
    if (!form.alturaMontaje.trim()) return 'La altura de montaje es requerida.';
    if (!form.objetivoProyecto) return 'Selecciona el objetivo del proyecto.';
    // Mismo tope que el servidor (MAX_DESCRIPCION_PROYECTO); el textarea ya lo impone
    if ((form.descripcionProyecto ?? '').trim().length > MAX_DESCRIPCION)
      return 'La descripción admite hasta ' + MAX_DESCRIPCION + ' caracteres.';
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const validationError = validateForm();
    if (validationError) {
      setErrorMsg(validationError);
      return;
    }

    setErrorMsg('');
    setStatus('sending');

    // GA4: form_submit
    sendEvent('estudio_luminico_form_submit', {
      tipoProyecto: form.tipoProyecto,
      tienePlanos: form.tienePlanos,
      objetivoProyecto: form.objetivoProyecto,
      normativaObjetivo: form.normativaObjetivo || 'no_seguro',
      urgenciaProyecto: form.urgenciaProyecto || 'sin_definir',
    });

    try {
      const payload = buildPayload();
      await submitEstudioLead(payload);

      // GA4: lead enviado (conversión), solo cuando el servidor lo confirmó
      trackLead('estudio_luminico', {
        tipo_proyecto: form.tipoProyecto,
        tiene_planos: form.tienePlanos,
        objetivo_proyecto: form.objetivoProyecto,
        normativa_objetivo: form.normativaObjetivo || 'no_seguro',
        urgencia_proyecto: form.urgenciaProyecto || 'sin_definir',
      });

      setStatus('success');
      setForm(EMPTY_FORM);
    } catch (err) {
      // Los datos quedan en el formulario para reintentar
      console.error('[EstudioLuminicoLeadForm]', err);
      const reason = err instanceof SubmitError ? err.reason : 'exception';
      const httpStatus = err instanceof SubmitError ? err.httpStatus : 0;
      sendEvent('estudio_luminico_form_submit_error', { reason, httpStatus });
      setStatus('error');
      setErrorMsg(submitErrorMessage(httpStatus));
    }
  };

  const inputClass =
    'w-full border border-gray-200 rounded-xl px-4 py-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-cyan-400/40 focus:border-cyan-500 transition-all placeholder:text-gray-400';
  const labelClass = 'block text-sm font-semibold text-gray-700 mb-1.5';
  const reqStar = <span className="text-red-500">*</span>;
  const optLabel = (
    <span className="text-xs font-normal text-gray-400">(opcional)</span>
  );

  // ── Estado de exito ───────────────────────────────────────────────────────

  if (status === 'success') {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
        <CheckCircle2 className="h-14 w-14 text-cyan-500" />
        <h3 className="text-xl font-bold text-gray-900">Solicitud recibida</h3>
        <p className="text-gray-500 max-w-sm text-sm leading-relaxed">
          Revisaremos tu proyecto y te enviaremos la cotización del estudio con propuesta de
          luminarias eLIGHTS. Entrega en 48 horas desde la recepción de todos los
          antecedentes.
        </p>
        <button
          onClick={() => setStatus('idle')}
          className="mt-2 text-sm text-cyan-600 underline underline-offset-2 hover:text-cyan-800 transition-colors"
        >
          Enviar otra solicitud
        </button>
      </div>
    );
  }

  // ── Formulario ────────────────────────────────────────────────────────────

  return (
    <form onSubmit={handleSubmit} noValidate>
      {/* Campo trampa para bots: invisible para personas y lectores de pantalla */}
      <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', width: 1, height: 1, overflow: 'hidden' }}>
        <label>
          No completar
          <input type="text" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
        </label>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        {/* Nombre completo */}
        <div>
          <label htmlFor="elf-nombre" className={labelClass}>
            Nombre completo {reqStar}
          </label>
          <input
            id="elf-nombre"
            name="nombreCompleto"
            type="text"
            value={form.nombreCompleto}
            onChange={handleChange}
            placeholder="Juan Perez"
            className={inputClass}
            autoComplete="name"
          />
        </div>

        {/* Email */}
        <div>
          <label htmlFor="elf-email" className={labelClass}>
            Correo electronico {reqStar}
          </label>
          <input
            id="elf-email"
            name="email"
            type="email"
            value={form.email}
            onChange={handleChange}
            placeholder="juan@empresa.cl"
            className={inputClass}
            autoComplete="email"
          />
        </div>

        {/* Telefono */}
        <div>
          <label htmlFor="elf-telefono" className={labelClass}>
            Teléfono {reqStar}
          </label>
          <input
            id="elf-telefono"
            name="telefono"
            type="tel"
            value={form.telefono}
            onChange={handleChange}
            placeholder="+56 9 1234 5678"
            className={inputClass}
            autoComplete="tel"
          />
        </div>

        {/* Empresa (opcional) */}
        <div>
          <label htmlFor="elf-empresa" className={labelClass}>
            Empresa {optLabel}
          </label>
          <input
            id="elf-empresa"
            name="empresa"
            type="text"
            value={form.empresa}
            onChange={handleChange}
            placeholder="Mi Empresa Ltda."
            className={inputClass}
            autoComplete="organization"
          />
        </div>

        {/* Tipo de proyecto */}
        <div className="sm:col-span-2">
          <label htmlFor="elf-tipo" className={labelClass}>
            Tipo de proyecto {reqStar}
          </label>
          <select
            id="elf-tipo"
            name="tipoProyecto"
            value={form.tipoProyecto}
            onChange={handleChange}
            className={inputClass}
          >
            <option value="">Selecciona el tipo de proyecto...</option>
            {TIPOS_PROYECTO.map(({ value, label }) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>

        {/* Comuna / Ciudad */}
        <div>
          <label htmlFor="elf-comuna" className={labelClass}>
            Comuna / Ciudad {reqStar}
          </label>
          <input
            id="elf-comuna"
            name="comunaCiudad"
            type="text"
            value={form.comunaCiudad}
            onChange={handleChange}
            placeholder="Tome, Region del Biobio"
            className={inputClass}
          />
        </div>

        {/* Tiene planos */}
        <div>
          <label htmlFor="elf-planos" className={labelClass}>
            Tienes planos .dwg o PDF? {reqStar}
          </label>
          <select
            id="elf-planos"
            name="tienePlanos"
            value={form.tienePlanos}
            onChange={handleChange}
            className={inputClass}
          >
            <option value="">Selecciona una opcion...</option>
            {TIENE_PLANOS.map(({ value, label }) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>

        {/* Dimensiones aproximadas */}
        <div>
          <label htmlFor="elf-dim" className={labelClass}>
            Dimensiones aproximadas {reqStar}
          </label>
          <input
            id="elf-dim"
            name="dimensionesAproximadas"
            type="text"
            value={form.dimensionesAproximadas}
            onChange={handleChange}
            placeholder="105 x 65 m, postes 25 m"
            className={inputClass}
          />
        </div>

        {/* Altura de montaje */}
        <div>
          <label htmlFor="elf-altura" className={labelClass}>
            Altura de montaje {reqStar}
          </label>
          <input
            id="elf-altura"
            name="alturaMontaje"
            type="text"
            value={form.alturaMontaje}
            onChange={handleChange}
            placeholder="25 metros (postes existentes)"
            className={inputClass}
          />
        </div>

        {/* Objetivo del proyecto */}
        <div className="sm:col-span-2">
          <label htmlFor="elf-objetivo" className={labelClass}>
            Objetivo del proyecto {reqStar}
          </label>
          <select
            id="elf-objetivo"
            name="objetivoProyecto"
            value={form.objetivoProyecto}
            onChange={handleChange}
            className={inputClass}
          >
            <option value="">Selecciona el objetivo principal...</option>
            {OBJETIVOS.map(({ value, label }) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>

        {/* Normativa objetivo (opcional) */}
        <div>
          <label htmlFor="elf-norma" className={labelClass}>
            Normativa objetivo {optLabel}
          </label>
          <select
            id="elf-norma"
            name="normativaObjetivo"
            value={form.normativaObjetivo}
            onChange={handleChange}
            className={inputClass}
          >
            {NORMATIVAS.map(({ value, label }) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>

        {/* Urgencia (opcional) */}
        <div>
          <label htmlFor="elf-urgencia" className={labelClass}>
            Urgencia {optLabel}
          </label>
          <select
            id="elf-urgencia"
            name="urgenciaProyecto"
            value={form.urgenciaProyecto}
            onChange={handleChange}
            className={inputClass}
          >
            {URGENCIAS.map(({ value, label }) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>

        {/* Descripcion (opcional) */}
        <div className="sm:col-span-2">
          <label htmlFor="elf-desc" className={labelClass}>
            Descripción del proyecto {optLabel}
          </label>
          <textarea
            id="elf-desc"
            name="descripcionProyecto"
            value={form.descripcionProyecto}
            onChange={handleChange}
            rows={3}
            maxLength={MAX_DESCRIPCION}
            placeholder="Describa brevemente su proyecto, contexto o requerimientos adicionales..."
            className={inputClass + ' resize-none'}
          />
        </div>
      </div>

      {/* Submit */}
      <div className="mt-8">
        {/* Error junto al boton, donde el visitante esta mirando */}
        {(status === 'error' || errorMsg) && (
          <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 mb-4 text-sm text-red-700">
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <span>{errorMsg || 'Ocurrio un error. Intentalo de nuevo.'}</span>
          </div>
        )}
        <Button
          type="submit"
          size="lg"
          disabled={status === 'sending'}
          className="w-full h-14 text-base font-bold gap-2 rounded-xl text-white transition-all"
          style={{ background: 'linear-gradient(135deg, #0891B2, #06B6D4)' }}
        >
          {status === 'sending' ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" /> Enviando solicitud...
            </>
          ) : (
            <>
              <Send className="h-5 w-5" /> SOLICITAR COTIZACION
            </>
          )}
        </Button>
        <p className="text-center text-xs text-gray-400 mt-3">
          Entrega en 48 horas desde la recepción de todos los antecedentes
        </p>
      </div>
    </form>
  );
};

export default EstudioLuminicoLeadForm;
