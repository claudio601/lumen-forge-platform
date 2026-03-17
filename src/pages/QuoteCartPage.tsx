import { useState } from 'react';
import { useApp } from '@/context/AppContext';
import { Link } from 'react-router-dom';
import { Minus, Plus, Trash2, FileText, Send, ArrowLeft, Zap, CheckCircle2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

const EMAILJS_SERVICE_ID  = 'service_elights';
const EMAILJS_TEMPLATE_ID = 'template_6y0bq3l';
const EMAILJS_PUBLIC_KEY  = '8StzB2ZV2J_JVa7DL';

const ELIGHTS_EMAIL = 'ventas@elights.cl';

const sendEmail = async (payload: object) => {
  const GAS_URL = "https://script.google.com/macros/s/AKfycbwn2Qv3nJsNrUfBvzdpB9X70NmQfAVXgBKVw8bdmG-CXMXGsL-2IUcJaKX0mpO4kNwfOw/exec";
  const response = await fetch(GAS_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify(payload),
  });
  const result = await response.json();
  if (result.status !== "ok") throw new Error(result.message || "Error enviando email");
};

const QuoteCartPage = () => {
  const { quoteCart, updateQuoteQty, removeFromQuote, clearQuote, formatDisplayPrice, displayPrice, priceLabel, isB2B } = useApp();
  const [submitted, setSubmitted] = useState(false);
  const [sending, setSending] = useState(false);
  const [form, setForm] = useState({
    nombre: '', email: '', telefono: '', rutEmpresa: '',
    razonSocial: '', giro: '', direccion: '', comentarios: '',
  });

  const fmt = (n: number) => new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', minimumFractionDigits: 0 }).format(n);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));

  const itemsText = quoteCart.map(i =>
    `• ${i.product.sku} — ${i.product.name} x${i.quantity} = ${fmt(displayPrice(i.product.price) * i.quantity)} ${priceLabel}`
  ).join('\n');

  const totalDisplay = quoteCart.reduce((s, i) => s + displayPrice(i.product.price) * i.quantity, 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const required = ['nombre','email','telefono','rutEmpresa','razonSocial','giro','direccion'] as const;
    if (required.some(f => !form[f])) {
      toast.error('Completa todos los campos requeridos');
      return;
    }
    setSending(true);
    try {
      await sendEmail({
        to_email:      ELIGHTS_EMAIL,
        reply_to:      form.email,
        from_name:     form.nombre,
        razon_social:  form.razonSocial,
        rut_empresa:   form.rutEmpresa,
        giro:          form.giro,
        telefono:      form.telefono,
        direccion:     form.direccion,
        comentarios:   form.comentarios || '—',
        items_lista:   itemsText,
        total:         `${fmt(totalDisplay)} ${priceLabel}`,
        modo_precio:   isB2B ? 'B2B (neto sin IVA)' : 'B2C (con IVA incluido)',
        fecha:         new Date().toLocaleDateString('es-CL', { dateStyle: 'long' }),
      });
      setSubmitted(true);
      clearQuote();
    } catch (err) {
      console.error(err);
      toast.error('Error al enviar. Contáctanos por WhatsApp al +56 9 9127 3128');
    } finally {
      setSending(false);
    }
  };

  if (submitted) {
    return (
      <div className="container py-16 text-center max-w-md mx-auto">
        <CheckCircle2 className="h-16 w-16 text-primary mx-auto mb-4" />
        <h1 className="text-2xl font-bold mb-2">Solicitud enviada</h1>
        <p className="text-muted-foreground mb-6">
          Nuestro equipo comercial revisará tu solicitud y te contactará a la brevedad con tu cotización personalizada.
        </p>
        <Button asChild className="gradient-primary text-primary-foreground">
          <Link to="/catalogo">Seguir explorando</Link>
        </Button>
      </div>
    );
  }

  if (quoteCart.length === 0) {
    return (
      <div className="container py-16 text-center">
        <FileText className="h-16 w-16 text-muted-foreground/30 mx-auto mb-4" />
        <h1 className="text-2xl font-bold mb-2">Tu lista de cotización está vacía</h1>
        <p className="text-muted-foreground mb-6">Agrega productos desde el catálogo para solicitar una cotización</p>
        <Button asChild className="gradient-primary text-primary-foreground">
          <Link to="/catalogo">Ver catálogo</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="container py-8">
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
        {quoteCart.map(item => (
          <div key={item.product.id} className="px-4 py-3 border-t grid grid-cols-[1fr_auto_auto_auto] gap-4 items-center">
            <div className="flex items-center gap-3">
              <img
                src={item.product.image}
                alt={item.product.name}
                className="h-10 w-10 object-contain rounded-lg bg-surface"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
              <div>
                <p className="font-semibold text-sm line-clamp-1">{item.product.name}</p>
                <p className="text-[10px] text-muted-foreground font-mono">{item.product.sku}</p>
              </div>
            </div>
            <div className="text-sm font-medium text-right">
              <span>{formatDisplayPrice(item.product.price)}</span>
              <span className="text-[10px] text-muted-foreground ml-1">{priceLabel}</span>
            </div>
            <div className="flex items-center border rounded-lg">
              <button className="p-1.5 hover:bg-accent transition-colors" onClick={() => updateQuoteQty(item.product.id, item.quantity - 1)}><Minus className="h-3 w-3" /></button>
              <span className="px-3 text-sm font-semibold">{item.quantity}</span>
              <button className="p-1.5 hover:bg-accent transition-colors" onClick={() => updateQuoteQty(item.product.id, item.quantity + 1)}><Plus className="h-3 w-3" /></button>
            </div>
            <button onClick={() => removeFromQuote(item.product.id)} className="text-muted-foreground hover:text-destructive transition-colors">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
        <div className="px-4 py-3 border-t bg-surface flex justify-end items-center gap-2">
          <span className="text-sm text-muted-foreground">Total referencial:</span>
          <span className="font-bold">{fmt(totalDisplay)}</span>
          <span className="text-xs text-muted-foreground">{priceLabel}</span>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="max-w-2xl">
        <h2 className="text-lg font-bold mb-4">Datos de contacto</h2>
        <div className="grid sm:grid-cols-2 gap-4 mb-6">
          {[
            { name: 'nombre',      label: 'Nombre y Apellido',  required: true },
            { name: 'email',       label: 'Email',              type: 'email', required: true },
            { name: 'telefono',    label: 'Teléfono',           type: 'tel',   required: true },
            { name: 'rutEmpresa',  label: 'RUT Empresa',        required: true },
            { name: 'razonSocial', label: 'Razón Social',       required: true },
            { name: 'giro',        label: 'Giro',               required: true },
          ].map(field => (
            <div key={field.name}>
              <label className="text-sm font-medium mb-1 block">
                {field.label} {field.required && <span className="text-destructive">*</span>}
              </label>
              <input
                name={field.name}
                type={field.type || 'text'}
                value={form[field.name as keyof typeof form]}
                onChange={handleChange}
                className="w-full border rounded-lg px-3 py-2.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
                required={field.required}
              />
            </div>
          ))}
          <div className="sm:col-span-2">
            <label className="text-sm font-medium mb-1 block">Dirección Comercial <span className="text-destructive">*</span></label>
            <input name="direccion" value={form.direccion} onChange={handleChange} className="w-full border rounded-lg px-3 py-2.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all" required />
          </div>
          <div className="sm:col-span-2">
            <label className="text-sm font-medium mb-1 block">Comentarios del proyecto / requerimiento</label>
            <textarea name="comentarios" value={form.comentarios} onChange={handleChange} rows={3} className="w-full border rounded-lg px-3 py-2.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all resize-none" />
          </div>
        </div>
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
