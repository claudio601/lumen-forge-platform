// src/components/estudio-luminico/EstudioLuminicoLeadForm.tsx
import { useState } from 'react';
import { Send, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { contactEmail } from '@/config/business';
import { sendEvent } from '@/lib/analytics';

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

// ── Envio a Pipedrive via endpoint dedicado ───────────────────────────────────

async function sendToPipedrive(payload: EstudioLuminicoFormPayload): Promise<void> {
  const res = await fetch('/api/estudio-luminico/create', {
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
    // 502 = Pipedrive fallo — lanzar error para que el usuario vea el mensaje
    if (res.status === 502) {
      throw new Error('CRM_FAIL: ' + errBody);
    }
    // Otros errores HTTP no bloquean al usuario (log y continuar)
    console.warn('[EstudioForm] HTTP error', { status: res.status, body: errBody });
    return;
  }

  try {
    const data = await res.json();
    if (data.success) {
      console.log('[EstudioForm] Deal creado/actualizado:', {
        dealId: data.dealId,
        dealAction: data.dealAction,
      });
    } else {
      console.warn('[EstudioForm] Respuesta no exitosa:', data);
    }
  } catch {
    console.warn('[EstudioForm] No se pudo parsear respuesta del endpoint');
  }
}

// ── Componente principal ──────────────────────────────────────────────────────

const EstudioLuminicoLeadForm = () => {
  const [form, setForm] = useState<FormValues>(EMPTY_FORM);
  const [status, setStatus] = useState<FormState>('idle');
  const [errorMsg, setErrorMsg] = useState('');

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
  });

  const validateForm = (): string | null => {
    if (!form.nombreCompleto.trim()) return 'El nombre completo es requerido.';
    if (!form.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email))
      return 'Ingresa un correo electronico valido.';
    if (!form.telefono.trim()) return 'El teléfono es requerido.';
    if (!form.tipoProyecto) return 'Selecciona el tipo de proyecto.';
    if (!form.comunaCiudad.trim()) return 'La comuna o ciudad es requerida.';
    if (!form.tienePlanos) return 'Indica si tienes planos disponibles.';
    if (!form.dimensionesAproximadas.trim()) return 'Las dimensiones aproximadas son requeridas.';
    if (!form.alturaMontaje.trim()) return 'La altura de montaje es requerida.';
    if (!form.objetivoProyecto) return 'Selecciona el objetivo del proyecto.';
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
      await sendToPipedrive(payload);

      // GA4: form_submit_success
      sendEvent('estudio_luminico_form_submit_success', {
        tipoProyecto: form.tipoProyecto,
        tienePlanos: form.tienePlanos,
        objetivoProyecto: form.objetivoProyecto,
        normativaObjetivo: form.normativaObjetivo || 'no_seguro',
        urgenciaProyecto: form.urgenciaProyecto || 'sin_definir',
      });

      setStatus('success');
      setForm(EMPTY_FORM);
    } catch (err) {
      console.error('[EstudioLuminicoLeadForm]', err);
      setStatus('error');
      const isCrmFail = err instanceof Error && err.message.startsWith('CRM_FAIL');
      setErrorMsg(
        isCrmFail
          ? 'No pudimos registrar tu solicitud en este momento. Por favor escribenos directamente por WhatsApp o intentalo de nuevo.'
          : 'Ocurrio un error inesperado. Por favor intentalo de nuevo o escribenos por WhatsApp.'
      );
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
      {/* Honeypot anti-bot */}
      <input
        type="text"
        name="website"
        style={{ display: 'none' }}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
      />

      {/* Error banner */}
      {(status === 'error' || errorMsg) && (
        <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 mb-6 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <span>{errorMsg || 'Ocurrio un error. Intentalo de nuevo.'}</span>
        </div>
      )}

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
            placeholder="Describa brevemente su proyecto, contexto o requerimientos adicionales..."
            className={inputClass + ' resize-none'}
          />
        </div>
      </div>

      {/* Submit */}
      <div className="mt-8">
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
