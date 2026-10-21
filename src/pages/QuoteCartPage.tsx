// /cotizacion: la lista de cotización y el formulario (persona o empresa). Un solo envío a
// /api/quotes/create; el servidor manda el correo a ventas y crea el negocio en Pipedrive.
//
// Auditoría UX, entrega 2 (2026-10-17):
// - F-02: cada campo obligatorio se revisa al salir de él y al enviar, con el mensaje debajo
//   (aria-invalid, aria-describedby) y el foco en el primero con error; el aviso general va
//   junto al botón (role="alert"). El RUT de empresa toma formato al salir del campo y se
//   revisa su dígito verificador; el servidor no lo revisa (nunca rechaza un lead por él).
// - F-03: la confirmación con el plazo de respuesta, 3 pasos y un resumen para imprimir.
// Entrega 3 (F-04): la franja de 3 pasos bajo el título, también con la lista vacía (la puerta
// «Cotización (n)» del encabezado se ve siempre), y la lista vacía ofrece la asesoría técnica.
import { useEffect, useState } from 'react';
import { useApp, quoteLineKey } from '@/context/AppContext';
import { requestSku } from '@/lib/variantSku';
import { jsImage } from '@/lib/jumpsellerImage';
import { Link } from 'react-router-dom';
import { Minus, Plus, Trash2, FileText, Send, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { sendEvent, trackLead } from '@/lib/analytics';
import { getAttribution } from '@/lib/attribution';
import { contactEmail, responseTimeHours, responseTimePromise } from '@/config/business';
import Seo from '@/components/Seo';
import PreSubmitNotice from '@/components/legal/PreSubmitNotice';
import { useConsentFields } from '@/components/legal/ConsentFields';
import { CONSENT_ERRORS, CONSENT_ERROR_CODE } from '../../api/_lib/forms/consent';
import { formatRut } from '@/lib/rut';
import { emailMessage, phoneDigitCount, requiredMessage, rutMessage } from '@/lib/formValidation';
import { useFieldErrors } from '@/hooks/useFieldErrors';
import FieldError from '@/components/forms/FieldError';
import FormErrorAlert from '@/components/forms/FormErrorAlert';
import RequestConfirmation from '@/components/forms/RequestConfirmation';
import ProcessSteps from '@/components/forms/ProcessSteps';
import { ADVISORY_LINK } from '@/config/navigation';

type CustomerType = 'persona' | 'empresa';

// Mismas reglas que el servidor (api/quotes/create.ts y api/_lib/crm/validation.ts):
// el correo a ventas sale desde el servidor, así que un dato rechazado ahí no llega a nadie.
// El correo usa EMAIL_RE de src/lib/formValidation.ts (la misma expresión del servidor).
const MAX_COMENTARIOS = 2000;
const MAX_DATO_EMPRESA = 200;

const CONTACT_FIELDS = [
  { name: 'nombre',   label: 'Nombre y Apellido', autoComplete: 'name' },
  { name: 'email',    label: 'Email',             type: 'email', autoComplete: 'email' },
  { name: 'telefono', label: 'Teléfono',          type: 'tel',   autoComplete: 'tel' },
] as const;

// Solo para empresa: datos de facturación
const COMPANY_FIELDS = [
  { name: 'rutEmpresa',  label: 'RUT Empresa' },
  { name: 'razonSocial', label: 'Razón Social',        autoComplete: 'organization' },
  { name: 'giro',        label: 'Giro' },
  { name: 'direccion',   label: 'Dirección Comercial', autoComplete: 'street-address' },
] as const;

interface QuoteForm {
  nombre: string;
  email: string;
  telefono: string;
  rutEmpresa: string;
  razonSocial: string;
  giro: string;
  direccion: string;
  comentarios: string;
}
type QuoteField = keyof QuoteForm;
/** Lo que necesita la regla de cada campo: los valores y si es empresa. */
type QuoteValues = QuoteForm & { isEmpresa: boolean };

/** Campos en el orden del formulario (el foco va al primero con error). */
const FIELD_ORDER: readonly QuoteField[] = ['nombre', 'email', 'telefono', 'rutEmpresa', 'razonSocial', 'giro', 'direccion', 'comentarios'];
const COMPANY_NAMES: readonly QuoteField[] = COMPANY_FIELDS.map(f => f.name);
const activeFields = (isEmpresa: boolean) => (isEmpresa ? FIELD_ORDER : FIELD_ORDER.filter(f => !COMPANY_NAMES.includes(f)));

const companyText = (value: string, empty: string, label: string) =>
  requiredMessage(value, empty) ??
  (value.trim().length > MAX_DATO_EMPRESA ? `${label} admite hasta ${MAX_DATO_EMPRESA} caracteres.` : null);

/** La regla de cada campo: el mensaje que va debajo, o null si está bien. */
function validateField(name: QuoteField, v: QuoteValues): string | null {
  switch (name) {
    case 'nombre':
      return requiredMessage(v.nombre, 'Escribe tu nombre y apellido.');
    case 'email':
      return emailMessage(v.email, 'Escribe tu correo electrónico.');
    case 'telefono': {
      if (!v.telefono.trim()) return 'Escribe tu teléfono.';
      const digits = phoneDigitCount(v.telefono);
      return digits < 8 || digits > 12 ? 'El teléfono debe tener entre 8 y 12 dígitos.' : null;
    }
    case 'rutEmpresa':
      return v.isEmpresa ? rutMessage(v.rutEmpresa, { required: true, emptyMessage: 'Escribe el RUT de la empresa.' }) : null;
    case 'razonSocial':
      return v.isEmpresa ? companyText(v.razonSocial, 'Escribe la razón social.', 'La razón social') : null;
    case 'giro':
      return v.isEmpresa ? companyText(v.giro, 'Escribe el giro de la empresa.', 'El giro') : null;
    case 'direccion':
      return v.isEmpresa ? companyText(v.direccion, 'Escribe la dirección comercial.', 'La dirección comercial') : null;
    case 'comentarios':
      return v.comentarios.trim().length > MAX_COMENTARIOS ? `Los comentarios admiten hasta ${MAX_COMENTARIOS} caracteres.` : null;
  }
}

/** Franja de 3 pasos, antes de enviar (informe UX, 5.2). */
const QUOTE_FLOW = ['Envías tu lista', 'Confirmamos disponibilidad y precio', 'Recibes la cotización por correo'] as const;

const QUOTE_STEPS = [
  'Revisamos tu solicitud y confirmamos disponibilidad y precio.',
  'Te enviamos por correo la cotización formal, con el link de pago.',
  'Si la aceptas, pagas con el link de pago: la compra se hace solo cuando pagas.',
] as const;

/** Lo enviado, con los precios como los veía el cliente, para el resumen de la confirmación. */
interface SentQuote {
  reference: string;
  lines: { key: string; name: string; detail: string; quantity: number; unit: string }[];
  total: string;
  priceLabel: string;
}

function QuoteSummary({ quote }: { quote: SentQuote }) {
  return (
    <>
      <ul className="divide-y text-sm">
        {quote.lines.map(l => (
          <li key={l.key} className="py-2 flex justify-between gap-3">
            <span className="min-w-0">
              <span className="font-medium break-words">{l.name}</span>
              <span className="block text-xs text-muted-foreground">{l.detail}</span>
            </span>
            <span className="text-right whitespace-nowrap">{l.quantity} × {l.unit}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-sm text-right">
        Total referencial: <strong>{quote.total}</strong> <span className="text-xs text-muted-foreground">{quote.priceLabel}</span>
      </p>
    </>
  );
}

const djb2 = (s: string) => { let h = 5381; for (let i = 0; i < s.length; i++) h = (((h << 5) + h) ^ s.charCodeAt(i)) >>> 0; return h.toString(36); };

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

/** Solo es éxito un 2xx con { success: true }; cualquier otra respuesta lanza SubmitError. */
async function submitQuote(payload: object): Promise<void> {
  let res: Response;
  try {
    res = await fetch('/api/quotes/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new SubmitError('network', 0);
  }

  // Una página de error de Vercel (504, 500) llega en HTML, no en JSON
  let data: { success?: unknown; code?: unknown } | null = null;
  try {
    data = JSON.parse(await res.text());
  } catch { /* cuerpo no JSON */ }

  if (!res.ok) throw new SubmitError('api_error', res.status, typeof data?.code === 'string' ? data.code : undefined);
  if (!data) throw new SubmitError('invalid_body', res.status);
  if (data.success !== true) throw new SubmitError('not_success', res.status);
}

const SEO_TITLE = 'Solicitud de Cotización | eLIGHTS Chile';
const SEO_DESCRIPTION = 'Revisa los productos de tu cotización y envíanos tus datos: un asesor te responde con la cotización formal.';

/** Mensaje para el visitante según el estado HTTP y el code de la respuesta. */
function submitErrorMessage(httpStatus: number, code?: string): string {
  // Un 400 por la casilla nunca dice "teléfono de 8 a 12 dígitos"
  if (code === CONSENT_ERROR_CODE) return CONSENT_ERRORS.solicitud;
  if (httpStatus === 400) return 'Revisa los datos (teléfono de 8 a 12 dígitos) e inténtalo de nuevo.';
  if (httpStatus === 429) return 'Espera unos minutos o escríbenos a ' + contactEmail + '.';
  return (
    'No pudimos registrar tu solicitud en este momento. Inténtalo de nuevo o escríbenos a ' + contactEmail + '.'
  );
}

const QuoteCartPage = () => {
  const { quoteCart, updateQuoteQty, removeFromQuote, clearQuote, formatDisplayPrice, displayPrice, priceLabel, isB2B, loaded } = useApp();
  const [sending, setSending] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [sent, setSent] = useState<SentQuote | null>(null);
  const [website, setWebsite] = useState(''); // honeypot: las personas no lo ven ni lo llenan
  // Casillas de privacidad y novedades: siempre sin marcar al entrar
  const consent = useConsentFields('solicitud');
  // El modo empresa del encabezado solo PRESELECCIONA el tipo de cliente, una vez leída la
  // sesión; después solo lo cambia el selector. Si siguiera al encabezado, una empresa que
  // cambia a precios con IVA terminaría enviando como persona, sin sus datos de facturación.
  const [chosenType, setChosenType] = useState<CustomerType | null>(null);
  useEffect(() => {
    if (loaded) setChosenType(t => t ?? (isB2B ? 'empresa' : 'persona'));
  }, [loaded, isB2B]);
  const customerType: CustomerType = chosenType ?? (isB2B ? 'empresa' : 'persona');
  const isEmpresa = customerType === 'empresa';
  const [form, setForm] = useState<QuoteForm>({
    nombre: '', email: '', telefono: '', rutEmpresa: '',
    razonSocial: '', giro: '', direccion: '', comentarios: '',
  });
  const fe = useFieldErrors<QuoteField, QuoteValues>('qc-', validateField, FIELD_ORDER);

  const fmt = (n: number) => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', minimumFractionDigits: 0 }).format(n);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const name = e.target.name as QuoteField;
    const next = { ...form, [name]: e.target.value };
    setForm(next);
    fe.onChange(name, { ...next, isEmpresa });
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const name = e.target.name as QuoteField;
    if (name === 'rutEmpresa') {
      // Formato 12.345.678-9 al salir del campo
      const next = { ...form, rutEmpresa: formatRut(form.rutEmpresa) };
      if (next.rutEmpresa !== form.rutEmpresa) setForm(next);
      fe.onBlur(name, { ...next, isEmpresa });
      return;
    }
    fe.onBlur(name, { ...form, isEmpresa });
  };

  const changeCustomerType = (type: CustomerType) => {
    setChosenType(type);
    // Al pasar a persona, los datos de empresa dejan de revisarse
    for (const f of COMPANY_NAMES) fe.onChange(f, { ...form, isEmpresa: type === 'empresa' });
  };

  const totalDisplay = quoteCart.reduce((s, i) => s + displayPrice(i.unitPrice ?? i.product.price) * i.quantity, 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (sending) return;
    setErrorMsg('');
    // El RUT se envía con formato aunque no se haya salido del campo
    const values: QuoteForm = isEmpresa && form.rutEmpresa ? { ...form, rutEmpresa: formatRut(form.rutEmpresa) } : form;
    if (values !== form) setForm(values);
    // Cada campo con su mensaje; el foco va al primero con error
    if (!fe.checkAll(activeFields(isEmpresa), { ...values, isEmpresa })) return;
    // La casilla se revisa al final: su error aparece junto a ella solo cuando el resto está bien
    if (!consent.check()) return;
    setSending(true);

    // La misma lista, del mismo cliente y en la misma hora, lleva la misma referencia
    const skus = quoteCart.map(i => i.product.id + ':' + (i.variantSku ?? requestSku(i.product)) + 'x' + i.quantity).sort().join(',');
    const quoteRef = 'NE-' + djb2([values.email.trim().toLowerCase(), customerType, skus, Math.floor(Date.now() / 3_600_000)].join('|'));

    try {
      // Un solo envío: el servidor manda el correo a ventas y crea el negocio en Pipedrive
      await submitQuote({
        sourceSystem: 'nuevo_elights',
        quoteReference: quoteRef,
        customerType,
        leadType: isEmpresa ? 'B2B' : 'B2C',
        // Precios que veía el cliente; el servidor los recalcula CON IVA desde el catálogo
        priceMode: isB2B ? 'neto' : 'iva',
        customer: {
          name: values.nombre.trim(),
          email: values.email.trim(),
          phone: values.telefono.trim(),
          preferredChannel: 'Email',
        },
        organization: isEmpresa ? { name: values.razonSocial.trim() } : undefined,
        company: isEmpresa
          ? { rut: values.rutEmpresa.trim(), giro: values.giro.trim(), address: values.direccion.trim() }
          : undefined,
        products: quoteCart.map(i => ({
          jumpsellerId: i.product.jumpseller_id,
          variantId: (i.cct != null ? i.product.cctVariants?.find(v => v.kelvin === i.cct)?.jumpseller_variant_id : undefined) ?? i.product.jumpseller_variant_id,
          sku: i.variantSku ?? requestSku(i.product),
          name: i.product.name,
          quantity: i.quantity,
          unitPriceClp: displayPrice(i.unitPrice ?? i.product.price),
        })),
        quoteAmountClp: totalDisplay,
        notes: values.comentarios.trim() || undefined,
        website,
        attribution: getAttribution(),
        consent: consent.payload(),
      });

      // GA4: lead enviado (conversión), solo cuando el servidor lo confirmó
      trackLead('cotizacion', { lead_type: isEmpresa ? 'B2B' : 'B2C', item_count: quoteCart.length });
      // Lo enviado queda para el resumen de la confirmación (la lista se vacía)
      setSent({
        reference: quoteRef,
        lines: quoteCart.map(i => ({
          key: quoteLineKey(i.product.id, i.cct),
          name: i.product.name,
          detail: `${i.variantSku ?? requestSku(i.product)}${i.cct ? ` · ${i.cct}K` : ''}`,
          quantity: i.quantity,
          unit: formatDisplayPrice(i.unitPrice ?? i.product.price),
        })),
        total: fmt(totalDisplay),
        priceLabel,
      });
      clearQuote();
    } catch (err) {
      // La lista y los datos quedan para reintentar
      console.error('[QuoteCartPage]', err);
      const reason = err instanceof SubmitError ? err.reason : 'exception';
      const httpStatus = err instanceof SubmitError ? err.httpStatus : 0;
      const code = err instanceof SubmitError ? err.code : undefined;
      sendEvent('cotizacion_form_submit_error', { reason, httpStatus });
      if (code === CONSENT_ERROR_CODE) {
        // El servidor no recibió la casilla: el aviso va junto a ella, sin mensaje general
        setErrorMsg('');
        consent.flagMissing();
        return;
      }
      setErrorMsg(submitErrorMessage(httpStatus, code));
    } finally {
      setSending(false);
    }
  };

  if (sent) {
    return (
      <RequestConfirmation
        form="cotizacion"
        idPrefix="qc-sent"
        title="Solicitud enviada"
        reference={sent.reference}
        steps={QUOTE_STEPS}
        summary={<QuoteSummary quote={sent} />}
        seo={<Seo title={SEO_TITLE} description={SEO_DESCRIPTION} noindex />}
        back={{ to: '/catalogo', label: 'Seguir explorando' }}
      />
    );
  }

  if (quoteCart.length === 0) {
    return (
      <div className="container py-16 text-center">
        <Seo title={SEO_TITLE} description={SEO_DESCRIPTION} noindex />
        <FileText className="h-16 w-16 text-muted-foreground/30 mx-auto mb-4" />
        <h1 className="text-2xl font-bold mb-2">Tu lista de cotización está vacía</h1>
        <p className="text-muted-foreground mb-6">Agrega productos desde el catálogo o pídenos asesoría.</p>
        <ProcessSteps label="Cómo funciona la cotización" steps={QUOTE_FLOW} className="max-w-3xl mx-auto mb-8" />
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Button asChild className="gradient-primary text-primary-foreground">
            <Link to="/catalogo">Ver catálogo</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to={ADVISORY_LINK.to}>{ADVISORY_LINK.label}</Link>
          </Button>
        </div>
      </div>
    );
  }

  const inputClass = 'w-full border rounded-lg px-3 py-2.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all aria-[invalid=true]:border-red-500';

  return (
    // data-elights-form (en el formulario y en la confirmación): la etiqueta de Google excluye
    // este bloque de la detección automática de datos. Es fijo: igual en el servidor y en el navegador.
    <div className="container py-8" data-elights-form="cotizacion">
        <Seo title={SEO_TITLE} description={SEO_DESCRIPTION} noindex />
      <Link to="/catalogo" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary mb-6 transition-colors">
        <ArrowLeft className="h-4 w-4" /> Seguir explorando
      </Link>
      <h1 className="text-2xl font-bold mb-2">Solicitud de cotización</h1>
      <p className="text-muted-foreground text-sm mb-4">
        Un asesor comercial revisará tu solicitud y te enviará una cotización personalizada.
      </p>
      <ProcessSteps label="Cómo funciona la cotización" steps={QUOTE_FLOW} className="mb-8" />

      <div className="border rounded-xl overflow-hidden mb-8">
        {/* En el teléfono (bajo sm) cada fila se apila: foto, nombre y SKU arriba; precio,
            cantidad y quitar abajo. Desde sm, las cuatro columnas. */}
        <div className="bg-surface px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider grid sm:grid-cols-[1fr_auto_auto_auto] gap-4">
          <span>Producto</span><span className="hidden sm:block">Precio unit.</span><span className="hidden sm:block">Cantidad</span><span className="hidden sm:block"></span>
        </div>
        {quoteCart.map(item => {
          const key = quoteLineKey(item.product.id, item.cct);
          return (
          <div key={key} className="px-4 py-3 border-t grid grid-cols-[1fr_auto_auto] sm:grid-cols-[1fr_auto_auto_auto] gap-x-4 gap-y-2 items-center">
            <div className="col-span-3 sm:col-span-1 flex items-center gap-3 min-w-0">
              <img
                src={jsImage(item.product.imageRefs?.[0] ?? item.product.image, 200, 'thumb')}
                alt={item.product.name}
                className="h-10 w-10 flex-shrink-0 object-contain rounded-lg bg-surface"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
              <div className="min-w-0">
                <p className="font-semibold text-sm break-words sm:line-clamp-1">{item.product.name}</p>
                <p className="text-[10px] text-muted-foreground font-mono">
                  {item.variantSku ?? requestSku(item.product)}{item.cct ? ` · ${item.cct}K` : ''}
                </p>
              </div>
            </div>
            <div className="text-sm font-medium sm:text-right">
              <span>{formatDisplayPrice(item.unitPrice ?? item.product.price)}</span>
              <span className="block sm:inline sm:ml-1 text-[10px] text-muted-foreground">{priceLabel}</span>
            </div>
            <div className="flex items-center border rounded-lg">
              <button aria-label={`Restar una unidad de ${item.product.name}${item.cct ? `, ${item.cct}K` : ''}`} className="p-2.5 sm:p-1.5 hover:bg-accent transition-colors" onClick={() => updateQuoteQty(key, item.quantity - 1)}><Minus className="h-3 w-3" /></button>
              <span className="px-3 text-sm font-semibold">{item.quantity}</span>
              <button aria-label={`Sumar una unidad de ${item.product.name}${item.cct ? `, ${item.cct}K` : ''}`} className="p-2.5 sm:p-1.5 hover:bg-accent transition-colors" onClick={() => updateQuoteQty(key, item.quantity + 1)}><Plus className="h-3 w-3" /></button>
            </div>
            <button aria-label={`Quitar ${item.product.name}${item.cct ? `, ${item.cct}K` : ''} de la cotización`} onClick={() => removeFromQuote(key)} className="p-2 -mr-2 sm:p-0 sm:mr-0 text-muted-foreground hover:text-destructive transition-colors">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
          );
        })}
        <div className="px-4 py-3 border-t bg-surface flex flex-wrap justify-end items-center gap-2">
          <span className="text-sm text-muted-foreground">Total referencial:</span>
          <span className="font-bold">{fmt(totalDisplay)}</span>
          <span className="text-xs text-muted-foreground">{priceLabel}</span>
        </div>
      </div>

      {/* noValidate: los mensajes son los del sitio, bajo cada campo (la burbuja del navegador sale en inglés) */}
      <form onSubmit={handleSubmit} noValidate className="max-w-2xl">
        {/* Campo trampa para bots: invisible para personas y lectores de pantalla */}
        <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', width: 1, height: 1, overflow: 'hidden' }}>
          <label>
            No completar
            <input type="text" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
          </label>
        </div>
        <h2 className="text-lg font-bold mb-4">Datos de contacto</h2>
        <div className="grid sm:grid-cols-2 gap-4 mb-6">
          {CONTACT_FIELDS.map(field => (
            <div key={field.name}>
              <label htmlFor={`qc-${field.name}`} className="text-sm font-medium mb-1 block">
                {field.label} <span className="text-destructive">*</span>
              </label>
              <input
                {...fe.fieldProps(field.name)}
                name={field.name}
                type={'type' in field ? field.type : 'text'}
                autoComplete={field.autoComplete}
                value={form[field.name]}
                onChange={handleChange}
                onBlur={handleBlur}
                className={inputClass}
                required
              />
              <FieldError id={fe.errorId(field.name)} message={fe.errors[field.name]} />
            </div>
          ))}
          <div>
            <label htmlFor="qc-customerType" className="text-sm font-medium mb-1 block">
              Tipo de cliente <span className="text-destructive">*</span>
            </label>
            <select
              id="qc-customerType"
              name="customerType"
              value={customerType}
              onChange={(e) => changeCustomerType(e.target.value as CustomerType)}
              className={inputClass}
            >
              <option value="persona">Persona natural</option>
              <option value="empresa">Empresa</option>
            </select>
          </div>
          {isEmpresa && COMPANY_FIELDS.map(field => (
            <div key={field.name}>
              <label htmlFor={`qc-${field.name}`} className="text-sm font-medium mb-1 block">
                {field.label} <span className="text-destructive">*</span>
              </label>
              <input
                {...fe.fieldProps(field.name)}
                name={field.name}
                type="text"
                autoComplete={'autoComplete' in field ? field.autoComplete : 'off'}
                maxLength={MAX_DATO_EMPRESA}
                placeholder={field.name === 'rutEmpresa' ? 'Ej.: 12.345.678-9' : undefined}
                value={form[field.name]}
                onChange={handleChange}
                onBlur={handleBlur}
                className={inputClass}
                required
              />
              <FieldError id={fe.errorId(field.name)} message={fe.errors[field.name]} />
            </div>
          ))}
          <div className="sm:col-span-2">
            <label htmlFor="qc-comentarios" className="text-sm font-medium mb-1 block">Comentarios del proyecto / requerimiento</label>
            <textarea {...fe.fieldProps('comentarios')} name="comentarios" value={form.comentarios} onChange={handleChange} onBlur={handleBlur} rows={3} maxLength={MAX_COMENTARIOS} className={inputClass + ' resize-none'} />
            <FieldError id={fe.errorId('comentarios')} message={fe.errors.comentarios} />
          </div>
        </div>
        <PreSubmitNotice kind="cotizacion" />
        {consent.fields}
        {/* Error junto al botón, donde el visitante está mirando */}
        <FormErrorAlert summary={fe.summary} message={errorMsg} />
        <Button type="submit" size="lg" disabled={sending} className="w-full gradient-primary text-primary-foreground h-14 text-base font-bold gap-2">
          {sending
            ? <><span className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" /> Enviando...</>
            : <><Send className="h-5 w-5" /> ENVIAR SOLICITUD DE PRESUPUESTO</>
          }
        </Button>
        <p className="text-center text-sm text-muted-foreground mt-3">{responseTimePromise}</p>
        <p className="text-center text-xs text-muted-foreground mt-1">{responseTimeHours}</p>
      </form>
    </div>
  );
};

export default QuoteCartPage;
