// src/pages/RequestOrderPage.tsx
// Página principal del flujo de Solicitud de Pedido.
// Muestra el carrito, el formulario de contacto y la confirmación.
// Referencia: QuoteCartPage.tsx + InstallationLeadForm.tsx
//
// Auditoría UX, entrega 2 (2026-10-17):
// - F-01: cada línea guarda su precio CON IVA; la tabla y el total van en el modo del
//   selector del encabezado, como /cotizacion: "Total con IVA $X" y, en modo empresa,
//   "(neto $Y)". Nunca se suman precios con IVA y netos. El servidor igual recalcula CON
//   IVA desde el catálogo (api/request-orders/create.ts).
// - F-02: cada campo obligatorio se revisa al salir de él y al enviar, con el mensaje debajo
//   (aria-invalid, aria-describedby) y el foco en el primero con error; el aviso general va
//   junto al botón (role="alert"), sin subir la página. El correo con la regla del servidor;
//   el RUT (opcional) con su dígito verificador, que el servidor no revisa.
// - F-03: la confirmación con el plazo de respuesta, 3 pasos y un resumen para imprimir.
// Entrega 3 (F-04): la franja de 3 pasos bajo el título, también con la solicitud vacía (la
// puerta «Pedido (n)» del encabezado se ve siempre).
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardList, ArrowLeft, Loader2, Minus, Plus, Trash2, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useApp } from '@/context/AppContext';
import { useRequestCart } from '@/context/RequestCartContext';
import {
  buildRequestRef,
  cartItemToOrderItem,
  formatCLP,
  netOfGross,
  reconcileRequestItems,
  requestLineKey,
  requestTotals,
  type PriceMode,
} from '@/lib/requestOrder';
import { products } from '@/data/products';
import { toast } from 'sonner';
import { sendEvent, trackLead } from '@/lib/analytics';
import { getAttribution } from '@/lib/attribution';
import type { RequestCartItem, RequestOrderPayload, RequestOrderSuccessResponse } from '@/types/request-order';
import Seo from '@/components/Seo';
import PreSubmitNotice from '@/components/legal/PreSubmitNotice';
import { useConsentFields } from '@/components/legal/ConsentFields';
import { CONSENT_ERROR_CODE } from '../../api/_lib/forms/consent';
import { contactEmail, responseTimeHours, responseTimePromise } from '@/config/business';
import { formatRut } from '@/lib/rut';
import { emailMessage, phoneDigitCount, requiredMessage, rutMessage } from '@/lib/formValidation';
import { useFieldErrors } from '@/hooks/useFieldErrors';
import FieldError from '@/components/forms/FieldError';
import FormErrorAlert from '@/components/forms/FormErrorAlert';
import RequestConfirmation from '@/components/forms/RequestConfirmation';
import ProcessSteps from '@/components/forms/ProcessSteps';
import { REGIONS } from '@/config/regions';

const SEO_TITLE = 'Solicitud de Pedido | eLIGHTS Chile';
const SEO_DESCRIPTION = 'Envía tu solicitud de pedido de iluminación LED. Revisamos disponibilidad y te contactamos con la cotización.';

// ── Formulario ──────────────────────────────────────────────────────────────
// Las regiones del selector (REGIONS) viven en src/config/regions.ts: la misma lista decide qué
// región guardada se acepta al recordar los datos (src/lib/savedContact.ts).

type FormState = 'idle' | 'sending' | 'success' | 'error';

interface FormValues {
  fullName: string;
  email: string;
  phone: string;
  customerType: 'empresa' | 'persona';
  companyName: string;
  rut: string;
  commune: string;
  region: string;
  notes: string;
}

const EMPTY_FORM: FormValues = {
  fullName: '',
  email: '',
  phone: '',
  customerType: 'persona',
  companyName: '',
  rut: '',
  commune: '',
  region: 'Región Metropolitana',
  notes: '',
};

/** Campos que se revisan, en el orden del formulario (el foco va al primero con error). */
type Field = 'fullName' | 'email' | 'phone' | 'companyName' | 'rut' | 'commune' | 'region';
const FIELD_ORDER: readonly Field[] = ['fullName', 'email', 'phone', 'companyName', 'rut', 'commune', 'region'];
const COMPANY_ONLY: readonly Field[] = ['companyName', 'rut'];
const isField = (name: string): name is Field => (FIELD_ORDER as readonly string[]).includes(name);
const activeFields = (v: FormValues) => (v.customerType === 'empresa' ? FIELD_ORDER : FIELD_ORDER.filter((f) => !COMPANY_ONLY.includes(f)));

/** La regla de cada campo: el mensaje que va debajo, o null si está bien. */
function validateField(name: Field, v: FormValues): string | null {
  switch (name) {
    case 'fullName':
      return requiredMessage(v.fullName, 'Escribe tu nombre completo.');
    case 'email':
      return emailMessage(v.email, 'Escribe tu correo electrónico.');
    case 'phone':
      if (!v.phone.trim()) return 'Escribe tu teléfono.';
      return phoneDigitCount(v.phone) < 8 ? 'Ingresa un teléfono válido con al menos 8 dígitos.' : null;
    case 'companyName':
      return v.customerType === 'empresa' ? requiredMessage(v.companyName, 'Escribe el nombre de la empresa.') : null;
    case 'rut':
      // Opcional: vacío está bien; escrito, con su dígito verificador
      return v.customerType === 'empresa' ? rutMessage(v.rut, { required: false, emptyMessage: '' }) : null;
    case 'commune':
      return requiredMessage(v.commune, 'Escribe tu comuna.');
    case 'region':
      return requiredMessage(v.region, 'Elige tu región.');
  }
}

/** El servidor rechazó el correo (api/request-orders/create.ts: 'email has invalid format'). */
const EMAIL_REJECTED = `No pudimos validar tu correo. Revísalo; si sigue fallando, escríbenos a ${contactEmail}.`;

/** Franja de 3 pasos, antes de enviar (informe UX, 5.3). */
const ORDER_FLOW = ['Envías tu solicitud', 'Confirmamos disponibilidad', 'Pagas con el link y despachamos'] as const;

// ── Confirmación ────────────────────────────────────────────────────────────
const ORDER_STEPS = [
  'Confirmamos la disponibilidad de tus productos.',
  'Te enviamos por correo la cotización con el link de pago.',
  'Despachamos en hasta 2 días hábiles desde que tu pago está confirmado.',
] as const;

interface SentOrder {
  reference: string;
  lines: RequestCartItem[];
  mode: PriceMode;
}

/** Nombre de la fila en los botones: producto, variante (si la hay) y SKU, distinto en cada fila. */
const rowName = (l: RequestCartItem) => [l.name, l.attributes?.colorLuz, l.sku].filter(Boolean).join(', ');

/** Variante o código del producto, sin el código interno JS-… (es solo para Pipedrive). */
const lineDetail = (l: RequestCartItem) =>
  [l.attributes?.colorLuz, /^JS-/.test(l.sku) ? undefined : l.sku].filter(Boolean).join(' · ');

function OrderSummary({ lines, mode }: Omit<SentOrder, 'reference'>) {
  const { gross, net } = requestTotals(lines);
  return (
    <>
      <ul className="divide-y text-sm">
        {lines.map((l) => (
          <li key={requestLineKey(l)} className="py-2 flex justify-between gap-3">
            <span className="min-w-0">
              <span className="font-medium break-words">{l.name}</span>
              {lineDetail(l) && <span className="block text-xs text-muted-foreground">{lineDetail(l)}</span>}
            </span>
            <span className="text-right whitespace-nowrap">
              {l.quantity} × {formatCLP(mode === 'neto' ? netOfGross(l.unitPrice) : l.unitPrice)}
              {mode === 'neto' ? ' neto' : ''}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-sm text-right">
        Total con IVA: <strong>{formatCLP(gross)}</strong>
        {mode === 'neto' ? ` (neto ${formatCLP(net)})` : ''}
      </p>
    </>
  );
}

// ── Página principal ────────────────────────────────────────────────────────
const RequestOrderPage = () => {
  const { items, updateQty, removeItem, clearCart, replaceItems, subtotal, netSubtotal, loaded } = useRequestCart();
  // El modo del selector de precios del encabezado (empresa = neto), como en /cotizacion
  const { isB2B, displayPrice, priceLabel } = useApp();
  const [website, setWebsite] = useState(''); // honeypot: las personas no lo ven ni lo llenan
  // Casillas de privacidad (con los términos) y novedades: siempre sin marcar al entrar
  const consent = useConsentFields('pedido');
  const fe = useFieldErrors<Field, FormValues>('ro-', validateField, FIELD_ORDER);

  // Carritos guardados en la sesión pueden tener precios o productos de antes de la
  // última sincronización con Jumpseller: se ponen al día una vez, apenas se lee el
  // carrito guardado (después de montar; si esta es la primera página, eso ocurre
  // después del primer render).
  const reconciled = useRef(false);
  useEffect(() => {
    if (!loaded || reconciled.current) return;
    reconciled.current = true;
    const r = reconcileRequestItems(items, products);
    if (!r.changed) return;
    replaceItems(r.items);
    if (r.removed.length) toast.warning(`Quitamos de tu solicitud productos que ya no están disponibles: ${r.removed.join(', ')}`);
    else if (r.repriced) toast.info('Actualizamos los precios de tu solicitud según el catálogo vigente.');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);
  const [form, setForm] = useState<FormValues>(EMPTY_FORM);
  const [status, setStatus] = useState<FormState>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [sent, setSent] = useState<SentOrder | null>(null);

  const inputClass =
    'w-full border border-gray-200 rounded-xl px-4 py-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all placeholder:text-gray-400 aria-[invalid=true]:border-red-500';
  const labelClass = 'block text-sm font-semibold text-gray-700 mb-1.5';

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    const next = { ...form, [name]: value } as FormValues;
    setForm(next);
    if (isField(name)) fe.onChange(name, next);
    // Al pasar a persona, los datos de empresa dejan de revisarse
    if (name === 'customerType') COMPANY_ONLY.forEach((f) => fe.onChange(f, next));
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name } = e.target;
    if (!isField(name)) return;
    if (name === 'rut') {
      // Formato 12.345.678-9 al salir del campo
      const next = { ...form, rut: formatRut(form.rut) };
      if (next.rut !== form.rut) setForm(next);
      fe.onBlur('rut', next);
      return;
    }
    fe.onBlur(name, form);
  };

  // Carrito vacío
  if (items.length === 0 && status !== 'success') {
    return (
      <div className="container py-16 text-center">
        <Seo title={SEO_TITLE} description={SEO_DESCRIPTION} noindex />
        <ClipboardList className="h-16 w-16 text-muted-foreground/30 mx-auto mb-4" />
        <h1 className="text-2xl font-bold mb-2">Tu solicitud de pedido está vacía</h1>
        <p className="text-muted-foreground mb-6">Agrega productos desde el catálogo para solicitar un pedido.</p>
        <ProcessSteps label="Cómo funciona la solicitud de pedido" steps={ORDER_FLOW} className="max-w-3xl mx-auto mb-8" />
        <Button asChild className="gradient-primary text-primary-foreground">
          <Link to="/catalogo">Ver catálogo</Link>
        </Button>
      </div>
    );
  }

  // Confirmación
  if (status === 'success' && sent) {
    return (
      <RequestConfirmation
        form="solicitar-pedido"
        idPrefix="ro-sent"
        title="Solicitud enviada"
        reference={sent.reference}
        steps={ORDER_STEPS}
        summary={<OrderSummary lines={sent.lines} mode={sent.mode} />}
        seo={<Seo title={SEO_TITLE} description={SEO_DESCRIPTION} noindex />}
        back={{ to: '/catalogo', label: 'Seguir explorando' }}
      />
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (status === 'sending') return;
    setErrorMsg('');

    // El RUT se envía con formato aunque no se haya salido del campo
    const values = form.rut ? { ...form, rut: formatRut(form.rut) } : form;
    if (values !== form) setForm(values);

    // Cada campo con su mensaje; el foco va al primero con error
    if (!fe.checkAll(activeFields(values), values)) return;

    // La casilla se revisa al final: su error aparece junto a ella solo cuando el resto está bien
    if (!consent.check()) return;

    setStatus('sending');
    // Sin la comuna: a Google Analytics no va nada que ayude a identificar a la persona
    sendEvent('request_form_start', { customer_type: values.customerType });

    const requestReference = buildRequestRef(values.email, items);
    // Lo que veía el cliente al enviar, en el modo del selector; el servidor recalcula CON IVA
    const mode: PriceMode = isB2B ? 'neto' : 'iva';
    const orderItems = items.map((i) => cartItemToOrderItem(i, mode));
    const isEmpresa = values.customerType === 'empresa';

    const payload: RequestOrderPayload = {
      items: orderItems,
      subtotal: orderItems.reduce((s, i) => s + i.lineTotal, 0),
      fullName: values.fullName.trim(),
      email: values.email.trim(),
      phone: values.phone.trim(),
      customerType: values.customerType,
      companyName: isEmpresa ? values.companyName.trim() : undefined,
      rut: isEmpresa ? values.rut.trim() || undefined : undefined,
      commune: values.commune.trim(),
      region: values.region,
      notes: values.notes.trim() || undefined,
      requestReference,
      website,
      attribution: getAttribution(),
      consent: consent.payload(),
    };

    try {
      const res = await fetch('/api/request-orders/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        let code: string | undefined;
        let serverErrors: string[] = [];
        try {
          const body: unknown = await res.json();
          const obj = body && typeof body === 'object' ? (body as { code?: unknown; details?: { errors?: unknown } }) : undefined;
          if (typeof obj?.code === 'string') code = obj.code;
          const list = obj?.details?.errors;
          if (Array.isArray(list)) serverErrors = list.filter((x): x is string => typeof x === 'string');
        } catch { /* cuerpo no JSON */ }
        console.error('[RequestOrder] Endpoint error', { status: res.status, code });
        sendEvent('request_form_submit_error', { reason: 'api_error', http_status: res.status });
        // El servidor no recibió la casilla: el aviso va junto a ella, sin mensaje
        // general, y el botón vuelve a estar disponible
        if (res.status === 400 && code === CONSENT_ERROR_CODE) {
          setStatus('idle');
          consent.flagMissing();
          return;
        }
        // El servidor rechazó el correo: el aviso va junto al campo, con el foco en él
        if (res.status === 400 && serverErrors.some((m) => m.startsWith('email'))) {
          setStatus('idle');
          fe.setError('email', EMAIL_REJECTED);
          return;
        }
        throw new Error('Error al crear la solicitud en el servidor.');
      }

      const data = (await res.json()) as RequestOrderSuccessResponse;

      // Email enviado solo desde backend (fire-and-forget).

      // Conversión solo si la respuesta trae la referencia RC-: la trampa contra bots responde
      // { success: true } sin ella y sin crear nada. La referencia decide, pero no se envía:
      // uniría la medición con el negocio en Pipedrive (Política §10: sin datos de contacto).
      if (typeof data?.requestReference === 'string' && data.requestReference) {
        trackLead('solicitud_pedido', { item_count: items.length });
      }

      // Lo enviado queda para el resumen de la confirmación (el carrito se vacía)
      setSent({ reference: data.requestReference, lines: items, mode });
      clearCart();
      setStatus('success');
    } catch (err) {
      console.error('[RequestOrder] handleSubmit error:', err);
      sendEvent('request_form_submit_error', { reason: 'exception' });
      setStatus('error');
      // Por correo, no por WhatsApp: el aviso va junto al botón (dueño, 2026-10-17)
      setErrorMsg(`No pudimos enviar tu solicitud. Inténtalo de nuevo o escríbenos a ${contactEmail}.`);
    }
  };

  // data-elights-form (en el formulario y en la confirmación): la etiqueta de Google excluye
  // este bloque de la detección automática de datos. Es fijo: igual en el servidor y en el navegador.
  return (
    <div className="container py-8 max-w-3xl" data-elights-form="solicitar-pedido">
      <Seo title={SEO_TITLE} description={SEO_DESCRIPTION} noindex />
      <Link
        to="/catalogo"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary mb-6 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Seguir explorando
      </Link>

      <h1 className="text-2xl font-bold mb-1">Solicitud de pedido</h1>
      <p className="text-muted-foreground text-sm mb-4">
        Completa tus datos: confirmamos disponibilidad y te enviamos un link de pago seguro.
      </p>
      <ProcessSteps label="Cómo funciona la solicitud de pedido" steps={ORDER_FLOW} className="mb-8" />

      {/* ── Tabla de productos ──────────────────────────────────────── */}
      {/* En el teléfono (bajo sm) cada fila se apila: foto, nombre y SKU arriba; precio,
          cantidad y quitar abajo. Desde sm, las cuatro columnas. Los precios van en el modo
          del selector del encabezado (con IVA, o neto en modo empresa). */}
      <div className="border rounded-xl overflow-hidden mb-8">
        <div className="bg-surface px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider grid sm:grid-cols-[1fr_auto_auto_auto] gap-4">
          <span>Producto</span>
          <span className="hidden sm:block">Precio unit.</span>
          <span className="hidden sm:block">Cantidad</span>
          <span className="hidden sm:block" />
        </div>

        {items.map((item) => (
          <div
            key={requestLineKey(item)}
            className="px-4 py-3 border-t grid grid-cols-[1fr_auto_auto] sm:grid-cols-[1fr_auto_auto_auto] gap-x-4 gap-y-2 items-center"
          >
            <div className="col-span-3 sm:col-span-1 flex items-center gap-3 min-w-0">
              {item.image && (
                <img
                  src={item.image}
                  alt={item.name}
                  className="h-10 w-10 flex-shrink-0 object-contain rounded-lg bg-surface"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
              )}
              <div className="min-w-0">
                <p className="font-semibold text-sm break-words sm:line-clamp-1">{item.name}</p>
                {/* La variante elegida en la ficha: «Cálida 2700K» */}
                {item.attributes?.colorLuz && <p className="text-xs text-muted-foreground">{item.attributes.colorLuz}</p>}
                <p className="text-[10px] text-muted-foreground font-mono">{item.sku}</p>
              </div>
            </div>
            <div className="sm:text-right">
              <p className="text-sm font-medium">{formatCLP(displayPrice(item.unitPrice))}</p>
              <p className="text-[10px] text-muted-foreground normal-case">{priceLabel}</p>
            </div>
            <div className="flex items-center border rounded-lg">
              <button
                aria-label={`Restar una unidad de ${rowName(item)}`}
                className="p-2.5 sm:p-1.5 hover:bg-accent transition-colors"
                onClick={() => updateQty(requestLineKey(item), item.quantity - 1)}
              >
                <Minus className="h-3 w-3" />
              </button>
              <span className="px-3 text-sm font-semibold">{item.quantity}</span>
              <button
                aria-label={`Sumar una unidad de ${rowName(item)}`}
                className="p-2.5 sm:p-1.5 hover:bg-accent transition-colors"
                onClick={() => updateQty(requestLineKey(item), item.quantity + 1)}
              >
                <Plus className="h-3 w-3" />
              </button>
            </div>
            <button
              aria-label={`Quitar ${rowName(item)} de la solicitud`}
              onClick={() => removeItem(requestLineKey(item))}
              className="p-2 -mr-2 sm:p-0 sm:mr-0 text-muted-foreground hover:text-destructive transition-colors"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}

        {/* Un solo modo: el total CON IVA (el del link de pago) y, en modo empresa, el neto */}
        <div className="px-4 py-3 border-t bg-surface flex flex-wrap justify-end items-baseline gap-x-2 gap-y-1">
          <span className="text-sm text-muted-foreground">Total con IVA:</span>{' '}
          <span className="font-bold">{formatCLP(subtotal)}</span>
          {isB2B && (
            <>
              {' '}
              <span className="text-sm text-muted-foreground">(neto {formatCLP(netSubtotal)})</span>
            </>
          )}
        </div>
      </div>

      {/* ── Formulario de contacto ──────────────────────────────────── */}
      <form onSubmit={handleSubmit} noValidate>
        {/* Campo trampa para bots: invisible para personas y lectores de pantalla */}
        <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', width: 1, height: 1, overflow: 'hidden' }}>
          <label>
            No completar
            <input type="text" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
          </label>
        </div>
        <h2 className="text-lg font-bold mb-4">Datos de contacto</h2>

        <div className="grid sm:grid-cols-2 gap-5 mb-6">
          {/* Nombre */}
          <div className="sm:col-span-2">
            <label htmlFor="ro-fullName" className={labelClass}>
              Nombre completo <span className="text-red-500">*</span>
            </label>
            <input
              {...fe.fieldProps('fullName')}
              name="fullName"
              type="text"
              value={form.fullName}
              onChange={handleChange}
              onBlur={handleBlur}
              placeholder="Juan Pérez"
              className={inputClass}
              autoComplete="name"
              aria-required="true"
            />
            <FieldError id={fe.errorId('fullName')} message={fe.errors.fullName} />
          </div>

          {/* Email */}
          <div>
            <label htmlFor="ro-email" className={labelClass}>
              Correo electrónico <span className="text-red-500">*</span>
            </label>
            <input
              {...fe.fieldProps('email')}
              name="email"
              type="email"
              value={form.email}
              onChange={handleChange}
              onBlur={handleBlur}
              placeholder="correo@ejemplo.com"
              className={inputClass}
              autoComplete="email"
              aria-required="true"
            />
            <FieldError id={fe.errorId('email')} message={fe.errors.email} />
          </div>

          {/* Teléfono */}
          <div>
            <label htmlFor="ro-phone" className={labelClass}>
              Teléfono <span className="text-red-500">*</span>
            </label>
            <input
              {...fe.fieldProps('phone')}
              name="phone"
              type="tel"
              value={form.phone}
              onChange={handleChange}
              onBlur={handleBlur}
              placeholder="+56 9 XXXX XXXX"
              className={inputClass}
              autoComplete="tel"
              aria-required="true"
            />
            <FieldError id={fe.errorId('phone')} message={fe.errors.phone} />
          </div>

          {/* Tipo de cliente */}
          <div>
            <label htmlFor="ro-customerType" className={labelClass}>
              Tipo de cliente <span className="text-red-500">*</span>
            </label>
            <select
              id="ro-customerType"
              name="customerType"
              value={form.customerType}
              onChange={handleChange}
              className={inputClass}
            >
              <option value="persona">Persona natural</option>
              <option value="empresa">Empresa</option>
            </select>
          </div>

          {/* Empresa (condicional) */}
          {form.customerType === 'empresa' && (
            <div>
              <label htmlFor="ro-companyName" className={labelClass}>
                Nombre de empresa <span className="text-red-500">*</span>
              </label>
              <input
                {...fe.fieldProps('companyName')}
                name="companyName"
                type="text"
                value={form.companyName}
                onChange={handleChange}
                onBlur={handleBlur}
                placeholder="Empresa S.A."
                className={inputClass}
                autoComplete="organization"
                aria-required="true"
              />
              <FieldError id={fe.errorId('companyName')} message={fe.errors.companyName} />
            </div>
          )}

          {/* RUT (condicional empresa, opcional): formato y dígito verificador al salir del campo */}
          {form.customerType === 'empresa' && (
            <div>
              <label htmlFor="ro-rut" className={labelClass}>
                RUT empresa <span className="text-xs font-normal text-gray-400">(opcional)</span>
              </label>
              <input
                {...fe.fieldProps('rut')}
                name="rut"
                type="text"
                value={form.rut}
                onChange={handleChange}
                onBlur={handleBlur}
                placeholder="Ej.: 12.345.678-9"
                className={inputClass}
                autoComplete="off"
                maxLength={20}
              />
              <FieldError id={fe.errorId('rut')} message={fe.errors.rut} />
            </div>
          )}

          {/* Comuna */}
          <div>
            <label htmlFor="ro-commune" className={labelClass}>
              Comuna <span className="text-red-500">*</span>
            </label>
            <input
              {...fe.fieldProps('commune')}
              name="commune"
              type="text"
              value={form.commune}
              onChange={handleChange}
              onBlur={handleBlur}
              placeholder="Ej: Las Condes, Maipú..."
              className={inputClass}
              aria-required="true"
            />
            <FieldError id={fe.errorId('commune')} message={fe.errors.commune} />
          </div>

          {/* Región */}
          <div>
            <label htmlFor="ro-region" className={labelClass}>
              Región <span className="text-red-500">*</span>
            </label>
            <select
              {...fe.fieldProps('region')}
              name="region"
              value={form.region}
              onChange={handleChange}
              onBlur={handleBlur}
              className={inputClass}
              aria-required="true"
            >
              {REGIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <FieldError id={fe.errorId('region')} message={fe.errors.region} />
          </div>

          {/* Notas */}
          <div className="sm:col-span-2">
            <label htmlFor="ro-notes" className={labelClass}>
              Notas adicionales <span className="text-xs font-normal text-gray-400">(opcional)</span>
            </label>
            <textarea
              id="ro-notes"
              name="notes"
              value={form.notes}
              onChange={handleChange}
              rows={3}
              placeholder="Instrucciones especiales, despacho, proyecto..."
              className={inputClass + ' resize-none'}
            />
          </div>
        </div>
        <PreSubmitNotice kind="pedido" />
        {consent.fields}

        {/* Aviso general junto al botón, donde el visitante está mirando */}
        <FormErrorAlert summary={fe.summary} message={errorMsg} />

        <Button
          type="submit"
          size="lg"
          disabled={status === 'sending'}
          className="w-full h-14 text-base font-bold gap-2 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground transition-all"
        >
          {status === 'sending' ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" />
              Enviando solicitud...
            </>
          ) : (
            <>
              <Send className="h-5 w-5" />
              ENVIAR SOLICITUD DE PEDIDO
            </>
          )}
        </Button>

        <p className="text-center text-sm text-gray-600 mt-3">
          {responseTimePromise} Sin cobro automático.
        </p>
        <p className="text-center text-xs text-gray-500 mt-1">{responseTimeHours}</p>
      </form>
    </div>
  );
};

export default RequestOrderPage;
