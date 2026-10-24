// src/components/estudio-luminico/EstudioLuminicoLeadForm.tsx
// «Recordar mis datos» (especificación del 23-10-2026): la casilla va después de la empresa (el
// último dato de contacto); al hidratar y en «Enviar otra solicitud» se completan los campos
// vacíos con lo guardado, y un envío confirmado con la casilla marcada guarda lo enviado
// (useRememberContact). Los datos del proyecto, la comuna o ciudad incluida, nunca se guardan.
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Send, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { contactEmail, whatsappDisplayNumber } from '@/config/business';
import { absoluteUrl } from '@/config/site';
import { studyPrefill } from '@/lib/studyLink';
import { sendEvent, trackLead } from '@/lib/analytics';
import { getAttribution, type Attribution } from '@/lib/attribution';
import { useConsentFields } from '@/components/legal/ConsentFields';
import { fillEmpty, useRememberContact } from '@/components/forms/RememberContact';
import type { SavedContact } from '@/lib/savedContact';
import { CONSENT_ERRORS, CONSENT_ERROR_CODE, type ConsentInput } from '../../../api/_lib/forms/consent';
// Topes de largo: los mismos del servidor (el correo a ventas lleva la nota completa); las
// respuestas al D.S. N°1/2022 son las claves que acepta el servidor
import { ESTUDIO_MAX_LENGTHS, isRequiereDs1, type RequiereDs1 } from '../../../api/_lib/forms/estudioLuminicoValidation';

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
  /** ¿Debe cumplir el D.S. N°1/2022? Opcional; sin respuesta la clave no viaja. */
  requiereDs1?: RequiereDs1;
  descripcionProyecto?: string;
  origen: 'estudio_luminico_web';
  fecha: string;
  landingPath: '/estudio-luminico';
  website?: string;
  /** Origen de la visita (src/lib/attribution.ts); sin origen la clave no viaja. */
  attribution?: Attribution;
  /** Casillas de privacidad y novedades (useConsentFields('solicitud').payload()). */
  consent: ConsentInput;
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
  { value: 'si_dwg_listo', label: 'Sí, los tengo listos' },
  { value: 'si_preparar', label: 'Sí, pero necesito prepararlos' },
  { value: 'no_tengo', label: 'No, necesito orientación' },
] as const;

const OBJETIVOS = [
  { value: 'entrenamiento', label: 'Entrenamiento deportivo' },
  { value: 'competencia', label: 'Competencia / Partido oficial' },
  { value: 'operacion_industrial', label: 'Operación industrial' },
  { value: 'seguridad', label: 'Seguridad / Vigilancia' },
  { value: 'licitacion', label: 'Licitación / Ingeniería' },
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

// D.S. N°1/2022 (auditoría UX, E-03): pregunta aparte de la normativa objetivo, porque se suma a
// cualquiera de ellas en un proyecto exterior. Un recinto techado sin muros (multicancha, galpón
// abierto) también es alumbrado exterior (art. 3 a del decreto): el "no" es solo el cerrado. El servidor la agrega a la nota y al correo
// (api/_lib/forms/estudioLuminicoValidation.ts); no pasa por el mapeo protegido de Pipedrive.
const REQUIERE_DS1: readonly { value: '' | RequiereDs1; label: string }[] = [
  { value: '', label: 'Sin indicar' },
  { value: 'si', label: 'Sí, me lo exigen (bases, mandante o municipio)' },
  { value: 'no_se', label: 'No lo sé: quiero asesoría' },
  { value: 'no', label: 'No, es un recinto cerrado con muros' },
];

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
  requiereDs1: '',
  descripcionProyecto: '',
};

type FormValues = typeof EMPTY_FORM;
type FormState = 'idle' | 'sending' | 'success' | 'error';

/** Los campos vacíos con lo guardado (los nombres de este formulario). */
const withSaved = (values: FormValues, saved: SavedContact | null): FormValues =>
  saved
    ? fillEmpty(values, { nombreCompleto: saved.nombre, email: saved.email, telefono: saved.telefono, empresa: saved.empresa })
    : values;

// ── Envio al endpoint (correo a ventas + Pipedrive en el servidor) ────────────

/**
 * Envio no confirmado por el servidor. httpStatus 0 = sin respuesta (red caida). code: el
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
 * Solo es exito un 2xx con { success: true }; cualquier otra respuesta lanza SubmitError.
 * Devuelve la referencia (leadRef) que confirma el servidor ('' si no viene: la trampa contra
 * bots responde { success: true } sin ella).
 */
async function submitEstudioLead(payload: EstudioLuminicoFormPayload): Promise<string> {
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
  let data: { success?: unknown; code?: unknown; leadRef?: unknown } | null = null;
  try {
    data = JSON.parse(await res.text());
  } catch { /* cuerpo no JSON */ }

  if (!res.ok) throw new SubmitError('api_error', res.status, typeof data?.code === 'string' ? data.code : undefined);
  if (!data) throw new SubmitError('invalid_body', res.status);
  if (data.success !== true) throw new SubmitError('not_success', res.status);
  return typeof data.leadRef === 'string' ? data.leadRef : '';
}

// Tope de la descripcion: el mismo que api/_lib/forms/estudioLuminicoValidation.ts
// (MAX_DESCRIPCION_PROYECTO), para que la nota completa quepa en el correo a ventas.
const MAX_DESCRIPCION = 2000;

/** Campos de texto con tope (ESTUDIO_MAX_LENGTHS) y su nombre en el mensaje de error. */
const TEXT_FIELDS = [
  ['nombreCompleto', 'El nombre'],
  ['email', 'El correo'],
  ['telefono', 'El teléfono'],
  ['empresa', 'La empresa'],
  ['comunaCiudad', 'La comuna o ciudad'],
  ['dimensionesAproximadas', 'Las dimensiones'],
  ['alturaMontaje', 'La altura de montaje'],
] as const;

/** Mensaje para el visitante segun el estado HTTP y el code de la respuesta. */
function submitErrorMessage(httpStatus: number, code?: string): string {
  // Un 400 por la casilla nunca dice "teléfono de 8 a 15 dígitos"
  if (code === CONSENT_ERROR_CODE) return CONSENT_ERRORS.solicitud;
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
  // Casillas de privacidad y novedades, siempre sin marcar; ocupan las dos columnas de la grilla
  const consent = useConsentFields('solicitud', { className: 'sm:col-span-2' });
  // «Recordar mis datos en este dispositivo», después de los datos de contacto
  const remember = useRememberContact('estudio-luminico', { className: 'sm:col-span-2' });
  // false en el HTML estático (prerender) y en el primer render del navegador; true cuando
  // React ya tomó el formulario. Mientras sea false, todo queda deshabilitado.
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
    // Lo guardado se lee recién ahora: el HTML del prerender y el primer render no cambian
    const saved = remember.prefill();
    if (saved) setForm((prev) => withSaved(prev, saved));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Desde la caja «Estudio DIALux» de una ficha (?tipo=…&producto=…, src/lib/studyLink.ts): el
  // tipo de proyecto y la ficha de referencia, después de hidratar (el HTML estático es uno solo)
  // y sin pisar lo que el visitante ya escribió.
  const { search } = useLocation();
  useEffect(() => {
    const prefill = studyPrefill(search, TIPOS_PROYECTO.map(t => t.value), absoluteUrl);
    if (!prefill.tipoProyecto && !prefill.descripcionProyecto) return;
    setForm(prev => ({
      ...prev,
      tipoProyecto: prev.tipoProyecto || prefill.tipoProyecto || '',
      descripcionProyecto: prev.descripcionProyecto || prefill.descripcionProyecto || '',
    }));
  }, [search]);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    if (name === 'email') remember.onEmailChange(value);
  };

  /** «Enviar otra solicitud»: el formulario vuelve vacío, con lo guardado y la casilla al día. */
  const startOver = () => {
    setStatus('idle');
    setForm(withSaved(EMPTY_FORM, remember.prefill()));
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
    requiereDs1: isRequiereDs1(form.requiereDs1) ? form.requiereDs1 : undefined,
    descripcionProyecto: form.descripcionProyecto?.trim() || undefined,
    origen: 'estudio_luminico_web',
    fecha: new Date().toLocaleDateString('es-CL', { dateStyle: 'long' }),
    landingPath: '/estudio-luminico',
    website,
    attribution: getAttribution(),
    consent: consent.payload(),
  });

  const validateForm = (): string | null => {
    if (!form.nombreCompleto.trim()) return 'El nombre completo es requerido.';
    if (!form.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email))
      return 'Ingresa un correo electrónico válido.';
    if (!form.telefono.trim()) return 'El teléfono es requerido.';
    // Misma regla que el servidor (api/_lib/forms/estudioLuminicoValidation.ts)
    const phoneDigits = form.telefono.replace(/\D/g, '').length;
    if (phoneDigits < 8 || phoneDigits > 15) return 'El teléfono debe tener entre 8 y 15 dígitos.';
    if (!form.tipoProyecto) return 'Selecciona el tipo de proyecto.';
    if (!form.comunaCiudad.trim()) return 'La comuna o ciudad es requerida.';
    if (!form.tienePlanos) return 'Indica si tienes planos disponibles.';
    if (!form.dimensionesAproximadas.trim()) return 'Las dimensiones aproximadas son requeridas.';
    if (!form.alturaMontaje.trim()) return 'La altura de montaje es requerida.';
    if (!form.objetivoProyecto) return 'Selecciona el objetivo del proyecto.';
    // Mismos topes que el servidor; los inputs ya los imponen al escribir
    for (const [field, label] of TEXT_FIELDS) {
      if (form[field].trim().length > ESTUDIO_MAX_LENGTHS[field])
        return label + ' admite hasta ' + ESTUDIO_MAX_LENGTHS[field] + ' caracteres.';
    }
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

    // La casilla se revisa al final: su error aparece junto a ella solo cuando el resto está bien
    if (!consent.check()) {
      setErrorMsg('');
      setStatus('idle');
      return;
    }

    setErrorMsg('');
    setStatus('sending');

    // GA4: form_submit
    sendEvent('estudio_luminico_form_submit', {
      tipo_proyecto: form.tipoProyecto,
      tiene_planos: form.tienePlanos,
      objetivo_proyecto: form.objetivoProyecto,
      normativa_objetivo: form.normativaObjetivo || 'no_seguro',
      urgencia_proyecto: form.urgenciaProyecto || 'sin_definir',
    });

    try {
      const payload = buildPayload();
      const ref = await submitEstudioLead(payload);

      // Conversión solo si el servidor confirmó la solicitud con su referencia (no se envía)
      if (ref) {
        trackLead('estudio_luminico', {
          tipo_proyecto: form.tipoProyecto,
          tiene_planos: form.tienePlanos,
          objetivo_proyecto: form.objetivoProyecto,
          normativa_objetivo: form.normativaObjetivo || 'no_seguro',
          urgencia_proyecto: form.urgenciaProyecto || 'sin_definir',
        });
      }
      // Con la misma condición y la casilla marcada, se guarda lo enviado (no el formulario)
      remember.afterSubmit(Boolean(ref), {
        nombre: payload.nombreCompleto, email: payload.email, telefono: payload.telefono, empresa: payload.empresa,
      });

      setStatus('success');
      setForm(EMPTY_FORM);
      consent.reset(); // "Enviar otra solicitud" vuelve a pedir las casillas
    } catch (err) {
      // Los datos quedan en el formulario para reintentar
      console.error('[EstudioLuminicoLeadForm]', err);
      const reason = err instanceof SubmitError ? err.reason : 'exception';
      const httpStatus = err instanceof SubmitError ? err.httpStatus : 0;
      const code = err instanceof SubmitError ? err.code : undefined;
      sendEvent('estudio_luminico_form_submit_error', { reason, http_status: httpStatus });
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

  const inputClass =
    'w-full border border-gray-200 rounded-xl px-4 py-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-cyan-400/40 focus:border-cyan-500 transition-all placeholder:text-gray-400';
  const labelClass = 'block text-sm font-semibold text-gray-700 mb-1.5';
  const reqStar = <span className="text-red-500">*</span>;
  const optLabel = (
    <span className="text-xs font-normal text-gray-400">(opcional)</span>
  );

  // data-elights-form (en el formulario y en la confirmación): la etiqueta de Google excluye
  // este bloque de la detección automática de datos. Es fijo: igual en el servidor y en el navegador.

  // ── Estado de exito ───────────────────────────────────────────────────────

  if (status === 'success') {
    return (
      <div data-elights-form="estudio-luminico" className="flex flex-col items-center justify-center gap-4 py-16 text-center">
        <CheckCircle2 className="h-14 w-14 text-cyan-500" />
        <h3 className="text-xl font-bold text-gray-900">Solicitud recibida</h3>
        <p className="text-gray-500 max-w-sm text-sm leading-relaxed">
          Revisaremos tu proyecto y te enviaremos la cotización del estudio con propuesta de
          luminarias eLIGHTS. El informe se entrega en 48 horas desde la recepción de todos
          los antecedentes.
        </p>
        <button
          onClick={startOver}
          className="mt-2 text-sm text-cyan-600 underline underline-offset-2 hover:text-cyan-800 transition-colors"
        >
          Enviar otra solicitud
        </button>
      </div>
    );
  }

  // ── Formulario ────────────────────────────────────────────────────────────

  return (
    <div data-elights-form="estudio-luminico">
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
              placeholder="Juan Pérez"
              maxLength={ESTUDIO_MAX_LENGTHS.nombreCompleto}
              className={inputClass}
              autoComplete="name"
            />
          </div>

          {/* Email */}
          <div>
            <label htmlFor="elf-email" className={labelClass}>
              Correo electrónico {reqStar}
            </label>
            <input
              id="elf-email"
              name="email"
              type="email"
              value={form.email}
              onChange={handleChange}
              placeholder="juan@empresa.cl"
              maxLength={ESTUDIO_MAX_LENGTHS.email}
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
              maxLength={ESTUDIO_MAX_LENGTHS.telefono}
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
              maxLength={ESTUDIO_MAX_LENGTHS.empresa}
              className={inputClass}
              autoComplete="organization"
            />
          </div>

          {/* Recordar mis datos: al final de los datos de contacto, lejos de las casillas de privacidad */}
          {remember.field}

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
              placeholder="Tomé, Región del Biobío"
              maxLength={ESTUDIO_MAX_LENGTHS.comunaCiudad}
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
              <option value="">Selecciona una opción...</option>
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
              maxLength={ESTUDIO_MAX_LENGTHS.dimensionesAproximadas}
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
              maxLength={ESTUDIO_MAX_LENGTHS.alturaMontaje}
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

          {/* D.S. N°1/2022 (opcional) */}
          <div className="sm:col-span-2">
            <label htmlFor="elf-ds1" className={labelClass}>
              ¿El proyecto debe cumplir el D.S. N°1/2022 (contaminación lumínica)? {optLabel}
            </label>
            <select
              id="elf-ds1"
              name="requiereDs1"
              value={form.requiereDs1}
              onChange={handleChange}
              aria-describedby="elf-ds1-ayuda"
              className={inputClass}
            >
              {REQUIERE_DS1.map(({ value, label }) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <p id="elf-ds1-ayuda" className="mt-1.5 text-xs text-gray-500">
              Rige para el alumbrado exterior nuevo desde el 19 de octubre de 2026, también en canchas y galpones techados sin muros.
            </p>
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

          {/* Casillas de privacidad y novedades (dentro del fieldset: antes de hidratar, deshabilitadas) */}
          {consent.fields}
        </div>

        {/* Submit */}
        <div className="mt-8">
          {/* Error junto al boton, donde el visitante esta mirando */}
          {(status === 'error' || errorMsg) && (
            <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 mb-4 text-sm text-red-700">
              <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <span>{errorMsg || 'Ocurrió un error. Inténtalo de nuevo.'}</span>
            </div>
          )}
          <Button
            type="submit"
            size="lg"
            disabled={!hydrated || status === 'sending'}
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
      </fieldset>
    </form>
    </div>
  );
};

export default EstudioLuminicoLeadForm;
