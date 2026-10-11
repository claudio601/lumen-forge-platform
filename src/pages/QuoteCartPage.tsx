import { useEffect, useRef, useState } from 'react';
import { useApp, quoteLineKey } from '@/context/AppContext';
import { requestSku } from '@/lib/variantSku';
import { jsImage } from '@/lib/jumpsellerImage';
import { Link } from 'react-router-dom';
import { Minus, Plus, Trash2, FileText, Send, ArrowLeft, CheckCircle2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { sendEvent, trackLead } from '@/lib/analytics';
import { contactEmail, whatsappDisplayNumber } from '@/config/business';
import Seo from '@/components/Seo';

type CustomerType = 'persona' | 'empresa';

// Mismas reglas que el servidor (api/quotes/create.ts y api/_lib/crm/validation.ts):
// el correo a ventas sale desde el servidor, así que un dato rechazado ahí no llega a nadie.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
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

const djb2 = (s: string) => { let h = 5381; for (let i = 0; i < s.length; i++) h = (((h << 5) + h) ^ s.charCodeAt(i)) >>> 0; return h.toString(36); };

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
  let data: { success?: unknown } | null = null;
  try {
    data = JSON.parse(await res.text());
  } catch { /* cuerpo no JSON */ }

  if (!res.ok) throw new SubmitError('api_error', res.status);
  if (!data) throw new SubmitError('invalid_body', res.status);
  if (data.success !== true) throw new SubmitError('not_success', res.status);
}

const SEO_TITLE = 'Solicitud de Cotización | eLIGHTS Chile';
const SEO_DESCRIPTION = 'Revisa los productos de tu cotización y envíanos tus datos: un asesor te responde con precios especiales.';

/** Mensaje para el visitante según el estado HTTP de la respuesta. */
function submitErrorMessage(httpStatus: number): string {
  if (httpStatus === 400) return 'Revisa los datos (teléfono de 8 a 12 dígitos) e inténtalo de nuevo.';
  if (httpStatus === 429) return 'Espera unos minutos o escríbenos por WhatsApp al ' + whatsappDisplayNumber + '.';
  return (
    'No pudimos registrar tu solicitud en este momento. Escríbenos por WhatsApp al ' +
    whatsappDisplayNumber + ' o a ' + contactEmail + ', o inténtalo de nuevo.'
  );
}

/**
 * Solicitud confirmada. El botón que tenía el foco desaparece con el formulario, así que el
 * foco pasa al título: un lector de pantalla lee "Solicitud enviada" y la referencia.
 */
function QuoteSent({ quoteRef }: { quoteRef: string }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  return (
    <div className="container py-16 text-center max-w-md mx-auto">
      <Seo title={SEO_TITLE} description={SEO_DESCRIPTION} noindex />
      <CheckCircle2 className="h-16 w-16 text-primary mx-auto mb-4" aria-hidden="true" />
      <h1 ref={heading} tabIndex={-1} aria-describedby="qc-sent-detail qc-sent-ref" className="text-2xl font-bold mb-2 focus:outline-none">
        Solicitud enviada
      </h1>
      <p id="qc-sent-detail" className="text-muted-foreground mb-4">
        Nuestro equipo comercial revisará tu solicitud y te contactará a la brevedad con tu cotización personalizada.
      </p>
      <p id="qc-sent-ref" className="inline-block text-xs font-mono bg-muted px-3 py-1.5 rounded-lg text-muted-foreground mb-6">
        Referencia: <span className="font-bold text-foreground">{quoteRef}</span>
      </p>
      <div>
        <Button asChild className="gradient-primary text-primary-foreground">
          <Link to="/catalogo">Seguir explorando</Link>
        </Button>
      </div>
    </div>
  );
}

const QuoteCartPage = () => {
  const { quoteCart, updateQuoteQty, removeFromQuote, clearQuote, formatDisplayPrice, displayPrice, priceLabel, isB2B, loaded } = useApp();
  const [submitted, setSubmitted] = useState(false);
  const [sending, setSending] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [confirmedRef, setConfirmedRef] = useState('');
  const [website, setWebsite] = useState(''); // honeypot: las personas no lo ven ni lo llenan
  // El modo empresa del encabezado solo PRESELECCIONA el tipo de cliente, una vez leída la
  // sesión; después solo lo cambia el selector. Si siguiera al encabezado, una empresa que
  // cambia a precios con IVA terminaría enviando como persona, sin sus datos de facturación.
  const [chosenType, setChosenType] = useState<CustomerType | null>(null);
  useEffect(() => {
    if (loaded) setChosenType(t => t ?? (isB2B ? 'empresa' : 'persona'));
  }, [loaded, isB2B]);
  const customerType: CustomerType = chosenType ?? (isB2B ? 'empresa' : 'persona');
  const isEmpresa = customerType === 'empresa';
  const [form, setForm] = useState({
    nombre: '', email: '', telefono: '', rutEmpresa: '',
    razonSocial: '', giro: '', direccion: '', comentarios: '',
  });

  const fmt = (n: number) => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', minimumFractionDigits: 0 }).format(n);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));

  const totalDisplay = quoteCart.reduce((s, i) => s + displayPrice(i.unitPrice ?? i.product.price) * i.quantity, 0);

  const validate = (): string | null => {
    const required: readonly { name: keyof typeof form }[] = isEmpresa ? [...CONTACT_FIELDS, ...COMPANY_FIELDS] : CONTACT_FIELDS;
    if (required.some(f => !form[f.name].trim())) return 'Completa todos los campos requeridos (*).';
    if (!EMAIL_RE.test(form.email.trim())) return 'Ingresa un correo electrónico válido.';
    const phoneDigits = form.telefono.replace(/\D/g, '').length;
    if (phoneDigits < 8 || phoneDigits > 12) return 'El teléfono debe tener entre 8 y 12 dígitos.';
    if (isEmpresa && COMPANY_FIELDS.some(f => form[f.name].trim().length > MAX_DATO_EMPRESA))
      return 'Los datos de la empresa admiten hasta ' + MAX_DATO_EMPRESA + ' caracteres cada uno.';
    if (form.comentarios.trim().length > MAX_COMENTARIOS)
      return 'Los comentarios admiten hasta ' + MAX_COMENTARIOS + ' caracteres.';
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const invalid = validate();
    if (invalid) { setErrorMsg(invalid); return; }
    setErrorMsg('');
    setSending(true);

    // La misma lista, del mismo cliente y en la misma hora, lleva la misma referencia
    const skus = quoteCart.map(i => i.product.id + ':' + (i.variantSku ?? requestSku(i.product)) + 'x' + i.quantity).sort().join(',');
    const quoteRef = 'NE-' + djb2([form.email.trim().toLowerCase(), customerType, skus, Math.floor(Date.now() / 3_600_000)].join('|'));

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
          name: form.nombre.trim(),
          email: form.email.trim(),
          phone: form.telefono.trim(),
          preferredChannel: 'Email',
        },
        organization: isEmpresa ? { name: form.razonSocial.trim() } : undefined,
        company: isEmpresa
          ? { rut: form.rutEmpresa.trim(), giro: form.giro.trim(), address: form.direccion.trim() }
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
        notes: form.comentarios.trim() || undefined,
        website,
      });

      // GA4: lead enviado (conversión), solo cuando el servidor lo confirmó
      trackLead('cotizacion', { lead_type: isEmpresa ? 'B2B' : 'B2C', item_count: quoteCart.length });
      setConfirmedRef(quoteRef);
      setSubmitted(true);
      clearQuote();
    } catch (err) {
      // La lista y los datos quedan para reintentar
      console.error('[QuoteCartPage]', err);
      const reason = err instanceof SubmitError ? err.reason : 'exception';
      const httpStatus = err instanceof SubmitError ? err.httpStatus : 0;
      sendEvent('cotizacion_form_submit_error', { reason, httpStatus });
      setErrorMsg(submitErrorMessage(httpStatus));
    } finally {
      setSending(false);
    }
  };

  if (submitted) return <QuoteSent quoteRef={confirmedRef} />;

  if (quoteCart.length === 0) {
    return (
      <div className="container py-16 text-center">
        <Seo title={SEO_TITLE} description={SEO_DESCRIPTION} noindex />
        <FileText className="h-16 w-16 text-muted-foreground/30 mx-auto mb-4" />
        <h1 className="text-2xl font-bold mb-2">Tu lista de cotización está vacía</h1>
        <p className="text-muted-foreground mb-6">Agrega productos desde el catálogo para solicitar una cotización</p>
        <Button asChild className="gradient-primary text-primary-foreground">
          <Link to="/catalogo">Ver catálogo</Link>
        </Button>
      </div>
    );
  }

  const inputClass = 'w-full border rounded-lg px-3 py-2.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all';

  return (
    <div className="container py-8">
        <Seo title={SEO_TITLE} description={SEO_DESCRIPTION} noindex />
      <Link to="/catalogo" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary mb-6 transition-colors">
        <ArrowLeft className="h-4 w-4" /> Seguir explorando
      </Link>
      <h1 className="text-2xl font-bold mb-2">Solicitud de cotización</h1>
      <p className="text-muted-foreground text-sm mb-6">
        Un asesor comercial revisará tu solicitud y te enviará una cotización personalizada con precios especiales.
      </p>

      <div className="border rounded-xl overflow-hidden mb-8">
        <div className="bg-surface px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider grid grid-cols-[1fr_auto_auto_auto] gap-4">
          <span>Producto</span><span>Precio unit.</span><span>Cantidad</span><span></span>
        </div>
        {quoteCart.map(item => {
          const key = quoteLineKey(item.product.id, item.cct);
          return (
          <div key={key} className="px-4 py-3 border-t grid grid-cols-[1fr_auto_auto_auto] gap-4 items-center">
            <div className="flex items-center gap-3">
              <img
                src={jsImage(item.product.imageRefs?.[0] ?? item.product.image, 200, 'thumb')}
                alt={item.product.name}
                className="h-10 w-10 object-contain rounded-lg bg-surface"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
              <div>
                <p className="font-semibold text-sm line-clamp-1">{item.product.name}</p>
                <p className="text-[10px] text-muted-foreground font-mono">
                  {item.variantSku ?? requestSku(item.product)}{item.cct ? ` · ${item.cct}K` : ''}
                </p>
              </div>
            </div>
            <div className="text-sm font-medium text-right">
              <span>{formatDisplayPrice(item.unitPrice ?? item.product.price)}</span>
              <span className="text-[10px] text-muted-foreground ml-1">{priceLabel}</span>
            </div>
            <div className="flex items-center border rounded-lg">
              <button className="p-1.5 hover:bg-accent transition-colors" onClick={() => updateQuoteQty(key, item.quantity - 1)}><Minus className="h-3 w-3" /></button>
              <span className="px-3 text-sm font-semibold">{item.quantity}</span>
              <button className="p-1.5 hover:bg-accent transition-colors" onClick={() => updateQuoteQty(key, item.quantity + 1)}><Plus className="h-3 w-3" /></button>
            </div>
            <button onClick={() => removeFromQuote(key)} className="text-muted-foreground hover:text-destructive transition-colors">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
          );
        })}
        <div className="px-4 py-3 border-t bg-surface flex justify-end items-center gap-2">
          <span className="text-sm text-muted-foreground">Total referencial:</span>
          <span className="font-bold">{fmt(totalDisplay)}</span>
          <span className="text-xs text-muted-foreground">{priceLabel}</span>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="max-w-2xl">
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
                id={`qc-${field.name}`}
                name={field.name}
                type={'type' in field ? field.type : 'text'}
                autoComplete={field.autoComplete}
                value={form[field.name]}
                onChange={handleChange}
                className={inputClass}
                required
              />
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
              onChange={(e) => setChosenType(e.target.value as CustomerType)}
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
                id={`qc-${field.name}`}
                name={field.name}
                type="text"
                autoComplete={'autoComplete' in field ? field.autoComplete : 'off'}
                maxLength={MAX_DATO_EMPRESA}
                value={form[field.name]}
                onChange={handleChange}
                className={inputClass}
                required
              />
            </div>
          ))}
          <div className="sm:col-span-2">
            <label htmlFor="qc-comentarios" className="text-sm font-medium mb-1 block">Comentarios del proyecto / requerimiento</label>
            <textarea id="qc-comentarios" name="comentarios" value={form.comentarios} onChange={handleChange} rows={3} maxLength={MAX_COMENTARIOS} className={inputClass + ' resize-none'} />
          </div>
        </div>
        {/* Error junto al botón, donde el visitante está mirando */}
        {errorMsg && (
          <div role="alert" className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 mb-4 text-sm text-red-700">
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}
        <Button type="submit" size="lg" disabled={sending} className="w-full gradient-primary text-primary-foreground h-14 text-base font-bold gap-2">
          {sending
            ? <><span className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" /> Enviando...</>
            : <><Send className="h-5 w-5" /> ENVIAR SOLICITUD DE PRESUPUESTO</>
          }
        </Button>
      </form>
    </div>
  );
};

export default QuoteCartPage;
