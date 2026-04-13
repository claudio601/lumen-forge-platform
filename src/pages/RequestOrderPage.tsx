// src/pages/RequestOrderPage.tsx
// Pagina principal del flujo de Solicitud de Pedido.
// Muestra el carrito, el formulario de contacto y la confirmacion.
// Referencia: QuoteCartPage.tsx + InstallationLeadForm.tsx
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
    ClipboardList,
    ArrowLeft,
    CheckCircle2,
    AlertCircle,
    Loader2,
    Minus,
    Plus,
    Trash2,
    Send,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useRequestCart } from '@/context/RequestCartContext';
import { buildRequestRef, cartItemToOrderItem, formatCLP } from '@/lib/requestOrder';
import { sendEvent } from '@/lib/analytics';
import type { RequestOrderPayload, RequestOrderSuccessResponse } from '@/types/request-order';

// ── Formulario ──────────────────────────────────────────────────────────────
const REGIONS = [
    'Arica y Parinacota','Tarapaca','Antofagasta','Atacama','Coquimbo',
    'Valparaiso','Region Metropolitana',"O'Higgins",'Maule','Nuble',
    'Biobio','La Araucania','Los Rios','Los Lagos','Aysen','Magallanes',
  ];

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
    region: 'Region Metropolitana',
    notes: '',
};

// ── Confirmacion ────────────────────────────────────────────────────────────
function ConfirmationScreen({ requestRef }: { requestRef: string }) {
    return (
          <div className="flex flex-col items-center justify-center gap-5 py-20 text-center max-w-md mx-auto">
                <CheckCircle2 className="h-16 w-16 text-green-500" />
                <h1 className="text-2xl font-bold text-gray-900">Solicitud enviada</h1>h1>
                <p className="text-gray-500 text-sm leading-relaxed">
                        Tu solicitud fue enviada. Nuestro equipo revisara stock y te contactara para habilitar el pago.
                </p>p>
                <p className="text-xs font-mono bg-muted px-3 py-1.5 rounded-lg text-muted-foreground">
                        Referencia: <span className="font-bold text-foreground">{requestRef}</span>span>
                </p>p>
                <Button asChild className="gradient-primary text-primary-foreground mt-2">
                        <Link to="/catalogo">Seguir explorando</Link>Link>
                </Button>Button>
          </div>div>
        );
}

// ── Pagina principal ────────────────────────────────────────────────────────
const RequestOrderPage = () => {
    const { items, updateQty, removeItem, clearCart, subtotal } = useRequestCart();
    const [form, setForm] = useState<FormValues>(EMPTY_FORM);
    const [status, setStatus] = useState<FormState>('idle');
    const [errorMsg, setErrorMsg] = useState('');
    const [confirmedRef, setConfirmedRef] = useState('');
  
    const inputClass =
          'w-full border border-gray-200 rounded-xl px-4 py-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-purple-400/40 focus:border-purple-500 transition-all placeholder:text-gray-400';
    const labelClass = 'block text-sm font-semibold text-gray-700 mb-1.5';
  
    const handleChange = (
          e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
        ) => {
              const { name, value } = e.target;
              setForm((prev) => ({ ...prev, [name]: value }));
        };
  
    // Carrito vacio
    if (items.length === 0 && status !== 'success') {
          return (
                  <div className="container py-16 text-center">
                          <ClipboardList className="h-16 w-16 text-muted-foreground/30 mx-auto mb-4" />
                          <h1 className="text-2xl font-bold mb-2">Tu solicitud esta vacia</h1>h1>
                          <p className="text-muted-foreground mb-6">
                                    Agrega productos desde el catalogo para solicitar un pedido
                          </p>p>
                          <Button asChild className="gradient-primary text-primary-foreground">
                                    <Link to="/catalogo">Ver catalogo</Link>Link>
                          </Button>Button>
                  </div>div>
                );
    }
  
    // Confirmacion
    if (status === 'success') {
          return <ConfirmationScreen requestRef={confirmedRef} />;
    }
  
    const handleSubmit = async (e: React.FormEvent) => {
          e.preventDefault();
      
          // Validacion basica
          const required: (keyof FormValues)[] = ['fullName', 'email', 'phone', 'commune', 'region'];
          const missing = required.filter((f) => !form[f].trim());
          if (form.customerType === 'empresa' && !form.companyName.trim()) {
                  missing.push('companyName');
          }
      
          // Fix 4: Validacion minima de telefono (>= 8 digitos reales)
          const phoneDigits = form.phone.replace(/\D/g, '');
          if (phoneDigits.length < 8) {
                  missing.push('phone');
          }
      
          if (missing.length > 0) {
                  setErrorMsg('Por favor completa todos los campos requeridos (*).');
                  // Fix 5: Scroll automatico al banner de error
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                  return;
          }
      
          setErrorMsg('');
          setStatus('sending');
          sendEvent('request_form_start', { commune: form.commune, customerType: form.customerType });
      
          const requestReference = buildRequestRef(form.email, items);
      
          const payload: RequestOrderPayload = {
                  items: items.map(cartItemToOrderItem),
                  subtotal,
                  fullName: form.fullName.trim(),
                  email: form.email.trim(),
                  phone: form.phone.trim(),
                  customerType: form.customerType,
                  companyName: form.customerType === 'empresa' ? form.companyName.trim() : undefined,
                  rut: form.rut.trim() || undefined,
                  commune: form.commune.trim(),
                  region: form.region,
                  notes: form.notes.trim() || undefined,
                  requestReference,
          };
      
          try {
                  // 1. Llamar al endpoint (Pipedrive es fuente de verdad — BLOQUEANTE)
                  const res = await fetch('/api/request-orders/create', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(payload),
                  });
            
                  if (!res.ok) {
                            let errDetail = '';
                            try { errDetail = JSON.stringify(await res.json()); } catch { /* ignored */ }
                            console.error('[RequestOrder] Endpoint error', { status: res.status, detail: errDetail });
                            sendEvent('request_form_submit_error', { reason: 'api_error', httpStatus: res.status });
                            throw new Error('Error al crear la solicitud en el servidor.');
                  }
            
                  const data = (await res.json()) as RequestOrderSuccessResponse;
            
                  // Fix 2: GAS email eliminado del frontend — el unico envio es en el backend (fire-and-forget).
            
                  sendEvent('request_form_submit_success', {
                            requestReference: data.requestReference,
                            dealId: data.dealId,
                            itemCount: items.length,
                            subtotal,
                  });
            
                  clearCart();
                  setConfirmedRef(data.requestReference);
                  setStatus('success');
          } catch (err) {
                  console.error('[RequestOrder] handleSubmit error:', err);
                  sendEvent('request_form_submit_error', { reason: 'exception' });
                  setStatus('error');
                  setErrorMsg(
                            'No pudimos enviar tu solicitud. Por favor intentalo de nuevo o escr\u00edbenos por WhatsApp.'
                          );
                  // Fix 5: Scroll automatico al banner de error tambien en catch
                  window.scrollTo({ top: 0, behavior: 'smooth' });
          }
    };
  
    // Fix 3: Etiqueta de modo de precio congelado segun tipo de cliente
    const priceModeLabel =
          form.customerType === 'empresa' ? 'Precio neto (B2B)' : 'Precio con IVA (B2C)';
  
    return (
          <div className="container py-8 max-w-3xl">
                <Link
                          to="/catalogo"
                          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary mb-6 transition-colors"
                        >
                        <ArrowLeft className="h-4 w-4" />
                        Seguir explorando
                </Link>Link>
          
                <h1 className="text-2xl font-bold mb-1">Solicitud de pedido</h1>h1>
                <p className="text-muted-foreground text-sm mb-6">
                        Completa tus datos y nuestro equipo revisara stock y disponibilidad para habilitarte el pago.
                </p>p>
          
            {/* ── Tabla de productos ──────────────────────────────────────── */}
                <div className="border rounded-xl overflow-hidden mb-8">
                        <div className="bg-surface px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider grid grid-cols-[1fr_auto_auto_auto] gap-4">
                                  <span>Producto</span>span>
                                  <span>
                                              Precio unit.{' '}
                                              <span className="normal-case font-normal text-muted-foreground/70">
                                                            ({priceModeLabel})
                                              </span>span>
                                  </span>span>
                                  <span>Cantidad</span>span>
                                  <span />
                        </div>div>
                
                  {items.map((item) => (
                      <div
                                    key={item.productId}
                                    className="px-4 py-3 border-t grid grid-cols-[1fr_auto_auto_auto] gap-4 items-center"
                                  >
                                  <div className="flex items-center gap-3">
                                    {item.image && (
                                                    <img
                                                                        src={item.image}
                                                                        alt={item.name}
                                                                        className="h-10 w-10 object-contain rounded-lg bg-surface"
                                                                        onError={(e) => {
                                                                                              (e.target as HTMLImageElement).style.display = 'none';
                                                                        }}
                                                                      />
                                                  )}
                                                <div>
                                                                <p className="font-semibold text-sm line-clamp-1">{item.name}</p>p>
                                                                <p className="text-[10px] text-muted-foreground font-mono">{item.sku}</p>p>
                                                </div>div>
                                  </div>div>
                                  <div className="text-sm font-medium text-right">
                                    {formatCLP(item.unitPrice)}
                                  </div>div>
                                  <div className="flex items-center border rounded-lg">
                                                <button
                                                                  className="p-1.5 hover:bg-accent transition-colors"
                                                                  onClick={() => updateQty(item.productId, item.quantity - 1)}
                                                                >
                                                                <Minus className="h-3 w-3" />
                                                </button>button>
                                                <span className="px-3 text-sm font-semibold">{item.quantity}</span>span>
                                                <button
                                                                  className="p-1.5 hover:bg-accent transition-colors"
                                                                  onClick={() => updateQty(item.productId, item.quantity + 1)}
                                                                >
                                                                <Plus className="h-3 w-3" />
                                                </button>button>
                                  </div>div>
                                  <button
                                                  onClick={() => removeItem(item.productId)}
                                                  className="text-muted-foreground hover:text-destructive transition-colors"
                                                >
                                                <Trash2 className="h-4 w-4" />
                                  </button>button>
                      </div>div>
                    ))}
                
                        <div className="px-4 py-3 border-t bg-surface flex justify-end items-center gap-2">
                                  <span className="text-sm text-muted-foreground">Total referencial:</span>span>
                                  <span className="font-bold">{formatCLP(subtotal)}</span>span>
                                  <span className="text-xs text-muted-foreground">CLP</span>span>
                        </div>div>
                </div>div>
          
            {/* ── Formulario de contacto ──────────────────────────────────── */}
                <form onSubmit={handleSubmit} noValidate>
                        <h2 className="text-lg font-bold mb-4">Datos de contacto</h2>h2>
                
                  {errorMsg && (
                      <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 mb-5 text-sm text-red-700">
                                  <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                        {errorMsg}
                      </div>div>
                        )}
                
                        <div className="grid sm:grid-cols-2 gap-5 mb-6">
                          {/* Nombre */}
                                  <div className="sm:col-span-2">
                                              <label htmlFor="ro-fullName" className={labelClass}>
                                                            Nombre completo <span className="text-red-500">*</span>span>
                                              </label>label>
                                              <input
                                                              id="ro-fullName"
                                                              name="fullName"
                                                              type="text"
                                                              value={form.fullName}
                                                              onChange={handleChange}
                                                              placeholder="Juan Perez"
                                                              className={inputClass}
                                                              autoComplete="name"
                                                            />
                                  </div>div>
                        
                          {/* Email */}
                                  <div>
                                              <label htmlFor="ro-email" className={labelClass}>
                                                            Correo electronico <span className="text-red-500">*</span>span>
                                              </label>label>
                                              <input
                                                              id="ro-email"
                                                              name="email"
                                                              type="email"
                                                              value={form.email}
                                                              onChange={handleChange}
                                                              placeholder="correo@ejemplo.com"
                                                              className={inputClass}
                                                              autoComplete="email"
                                                            />
                                  </div>div>
                        
                          {/* Telefono */}
                                  <div>
                                              <label htmlFor="ro-phone" className={labelClass}>
                                                            Telefono <span className="text-red-500">*</span>span>
                                              </label>label>
                                              <input
                                                              id="ro-phone"
                                                              name="phone"
                                                              type="tel"
                                                              value={form.phone}
                                                              onChange={handleChange}
                                                              placeholder="+56 9 XXXX XXXX"
                                                              className={inputClass}
                                                              autoComplete="tel"
                                                            />
                                  </div>div>
                        
                          {/* Tipo de cliente */}
                                  <div>
                                              <label htmlFor="ro-customerType" className={labelClass}>
                                                            Tipo de cliente <span className="text-red-500">*</span>span>
                                              </label>label>
                                              <select
                                                              id="ro-customerType"
                                                              name="customerType"
                                                              value={form.customerType}
                                                              onChange={handleChange}
                                                              className={inputClass}
                                                            >
                                                            <option value="persona">Persona natural</option>option>
                                                            <option value="empresa">Empresa</option>option>
                                              </select>select>
                                  </div>div>
                        
                          {/* Empresa (condicional) */}
                          {form.customerType === 'empresa' && (
                        <div>
                                      <label htmlFor="ro-companyName" className={labelClass}>
                                                      Nombre de empresa <span className="text-red-500">*</span>span>
                                      </label>label>
                                      <input
                                                        id="ro-companyName"
                                                        name="companyName"
                                                        type="text"
                                                        value={form.companyName}
                                                        onChange={handleChange}
                                                        placeholder="Empresa S.A."
                                                        className={inputClass}
                                                        autoComplete="organization"
                                                      />
                        </div>div>
                                  )}
                        
                          {/* RUT (condicional empresa) */}
                          {form.customerType === 'empresa' && (
                        <div>
                                      <label htmlFor="ro-rut" className={labelClass}>
                                                      RUT empresa{' '}
                                                      <span className="text-xs font-normal text-gray-400">(opcional)</span>span>
                                      </label>label>
                                      <input
                                                        id="ro-rut"
                                                        name="rut"
                                                        type="text"
                                                        value={form.rut}
                                                        onChange={handleChange}
                                                        placeholder="12.345.678-9"
                                                        className={inputClass}
                                                      />
                        </div>div>
                                  )}
                        
                          {/* Comuna */}
                                  <div>
                                              <label htmlFor="ro-commune" className={labelClass}>
                                                            Comuna <span className="text-red-500">*</span>span>
                                              </label>label>
                                              <input
                                                              id="ro-commune"
                                                              name="commune"
                                                              type="text"
                                                              value={form.commune}
                                                              onChange={handleChange}
                                                              placeholder="Ej: Las Condes, Maipu..."
                                                              className={inputClass}
                                                            />
                                  </div>div>
                        
                          {/* Region */}
                                  <div>
                                              <label htmlFor="ro-region" className={labelClass}>
                                                            Region <span className="text-red-500">*</span>span>
                                              </label>label>
                                              <select
                                                              id="ro-region"
                                                              name="region"
                                                              value={form.region}
                                                              onChange={handleChange}
                                                              className={inputClass}
                                                            >
                                                {REGIONS.map((r) => (
                                                                              <option key={r} value={r}>
                                                                                {r}
                                                                              </option>option>
                                                                            ))}
                                              </select>select>
                                  </div>div>
                        
                          {/* Notas */}
                                  <div className="sm:col-span-2">
                                              <label htmlFor="ro-notes" className={labelClass}>
                                                            Notas adicionales{' '}
                                                            <span className="text-xs font-normal text-gray-400">(opcional)</span>span>
                                              </label>label>
                                              <textarea
                                                              id="ro-notes"
                                                              name="notes"
                                                              value={form.notes}
                                                              onChange={handleChange}
                                                              rows={3}
                                                              placeholder="Instrucciones especiales, despacho, proyecto..."
                                                              className={inputClass + ' resize-none'}
                                                            />
                                  </div>div>
                        </div>div>
                
                        <Button
                                    type="submit"
                                    size="lg"
                                    disabled={status === 'sending'}
                                    className="w-full h-14 text-base font-bold gap-2 rounded-xl text-white transition-all"
                                    style={{ background: 'linear-gradient(135deg, #7C3AED, #F59E0B)' }}
                                  >
                          {status === 'sending' ? (
                                                <>
                                                              <Loader2 className="h-5 w-5 animate-spin" />
                                                              Enviando solicitud...
                                                </>>
                                              ) : (
                                                <>
                                                              <Send className="h-5 w-5" />
                                                              ENVIAR SOLICITUD DE PEDIDO
                                                </>>
                                              )}
                        </Button>Button>
                
                        <p className="text-center text-xs text-gray-400 mt-3">
                                  Nuestro equipo revisara stock y te contactara para habilitar el pago. Sin cobro automatico.
                        </p>p>
                </form>form>
          </div>div>
        );
};

export default RequestOrderPage;
</></></div>
