import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Send, CheckCircle2, Upload, Zap } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { waBase, contactEmail, whatsappDisplayNumber } from '@/config/business';
import { Helmet } from 'react-helmet-async';

const EMAILJS_SERVICE_ID = 'service_elights';
const EMAILJS_TEMPLATE_ID = 'template_6y0bq3l';
const EMAILJS_PUBLIC_KEY = '8StzB2ZV2J_JVa7DL';

async function sendViaEmailJS(params: Record<string, string>): Promise<void> {
  const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      service_id: EMAILJS_SERVICE_ID,
      template_id: EMAILJS_TEMPLATE_ID,
      user_id: EMAILJS_PUBLIC_KEY,
      template_params: params,
    }),
  });
  if (!res.ok) throw new Error('EmailJS error: ' + res.status);
}

const projectTypes = ['Oficina', 'Retail', 'Bodega', 'Industria', 'Exterior', 'Vial', 'Hogar', 'Otro'];
const illuminationLevels = ['Basico', 'Estandar', 'Alto rendimiento', 'Especializado'];

const SmartQuotePage = () => {
  const [submitted, setSubmitted] = useState(false);
  const [sending, setSending] = useState(false);
  const [form, setForm] = useState({
    tipoProyecto: '',
    m2: '',
    altura: '',
    aplicacion: '',
    nivelIluminacion: '',
    ciudad: '',
    plazo: '',
    comentarios: '',
    nombre: '',
    email: '',
    telefono: '',
    rutEmpresa: '',
    razonSocial: '',
    giro: '',
    direccion: '',
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.tipoProyecto || !form.m2 || !form.nombre || !form.email || !form.telefono) {
      toast.error('Completa todos los campos requeridos');
      return;
    }
    setSending(true);
    try {
      await sendViaEmailJS({
        nombre: form.nombre,
        email: form.email,
        telefono: form.telefono,
        razon_social: form.razonSocial || '(no indicado)',
        rut_empresa: form.rutEmpresa || '(no indicado)',
        giro: form.giro || '(no indicado)',
        direccion: form.direccion || '(no indicado)',
        tipo_proyecto: form.tipoProyecto,
        m2: form.m2,
        altura: form.altura || '(no indicado)',
        aplicacion: form.aplicacion || '(no indicado)',
        nivel_iluminacion: form.nivelIluminacion || '(no indicado)',
        ciudad: form.ciudad || '(no indicado)',
        plazo: form.plazo || '(no indicado)',
        comentarios: form.comentarios || '(ninguno)',
        fecha: new Date().toLocaleDateString('es-CL', { day: '2-digit', month: 'long', year: 'numeric' }),
        from_name: form.nombre,
        reply_to: form.email,
      });
      toast.success('Propuesta solicitada — te contactamos pronto');
      setSubmitted(true);
    } catch (err) {
      console.error(err);
      toast.error('Error al enviar. Escribenos al ' + whatsappDisplayNumber);
    } finally {
      setSending(false);
    }
  };

  if (submitted) {
    return (
      <div className="container py-16 text-center max-w-md mx-auto">
    <Helmet>
      <title>Cotizar Iluminación LED | eLIGHTS Chile</title>
      <meta name="description" content="Solicita una cotización de iluminación LED profesional. Productos técnicos para proyectos comerciales, industriales y residenciales." />
    </Helmet>

        <CheckCircle2 className="h-16 w-16 text-primary mx-auto mb-4" />
        <h1 className="text-2xl font-bold mb-2">Propuesta solicitada!</h1>
        <p className="text-muted-foreground mb-2">
          Nuestro equipo técnico preparara una propuesta personalizada y te contactará en menos de 24 horas hábiles.
        </p>
        <p className="text-sm text-muted-foreground mb-8">
          También puedes escribirnos a{' '}
          <a href={'mailto:' + contactEmail} className="text-primary underline">{contactEmail}</a>
          {' '}o al{' '}
          <a href={waBase} className="text-primary underline">{whatsappDisplayNumber}</a>.
        </p>
        <Button asChild className="gradient-primary text-primary-foreground">
          <Link to="/">Volver al inicio</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="container py-8">
      <div className="max-w-2xl mx-auto">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 bg-accent text-accent-foreground text-xs font-semibold px-3 py-1.5 rounded-full mb-4">
            <Zap className="h-3.5 w-3.5" />
            Cotizador Inteligente
          </div>
          <h1 className="text-2xl md:text-3xl font-bold mb-2">Solicitar propuesta tecnica</h1>
          <p className="text-muted-foreground">
            Describe tu proyecto y nuestro equipo preparara una propuesta integral con productos, cantidades y precios especiales.
          </p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="border rounded-xl p-6 space-y-4">
            <h2 className="font-bold">Información del proyecto</h2>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium mb-1 block">Tipo de proyecto <span className="text-destructive">*</span></label>
                <select name="tipoProyecto" value={form.tipoProyecto} onChange={handleChange} className="w-full border rounded-lg px-3 py-2.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30" required>
                  <option value="">Seleccionar...</option>
                  {projectTypes.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">m2 aproximados <span className="text-destructive">*</span></label>
                <input name="m2" type="number" min="1" value={form.m2} onChange={handleChange} className="w-full border rounded-lg px-3 py-2.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30" required />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Altura del espacio (m)</label>
                <input name="altura" type="number" step="0.1" value={form.altura} onChange={handleChange} className="w-full border rounded-lg px-3 py-2.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30" />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Tipo de aplicación</label>
                <input name="aplicacion" value={form.aplicacion} onChange={handleChange} placeholder="Ej: iluminacion general, acento..." className="w-full border rounded-lg px-3 py-2.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30" />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Nivel de iluminación</label>
                <select name="nivelIluminacion" value={form.nivelIluminacion} onChange={handleChange} className="w-full border rounded-lg px-3 py-2.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30">
                  <option value="">Seleccionar...</option>
                  {illuminationLevels.map(l => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Ciudad / Región</label>
                <input name="ciudad" value={form.ciudad} onChange={handleChange} className="w-full border rounded-lg px-3 py-2.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30" />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Plazo del proyecto</label>
                <input name="plazo" value={form.plazo} onChange={handleChange} placeholder="Ej: 3 meses" className="w-full border rounded-lg px-3 py-2.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30" />
              </div>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Comentarios adicionales</label>
              <textarea name="comentarios" value={form.comentarios} onChange={handleChange} rows={3} className="w-full border rounded-lg px-3 py-2.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none" />
            </div>
            <div className="border-2 border-dashed rounded-xl p-6 text-center text-muted-foreground">
              <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground/50" />
              <p className="text-sm">Adjuntar planos o especificaciones (proximamente)</p>
            </div>
          </div>
          <div className="border rounded-xl p-6 space-y-4">
            <h2 className="font-bold">Datos de contacto</h2>
            <div className="grid sm:grid-cols-2 gap-4">
              {[
                { name: 'nombre', label: 'Nombre y Apellido', required: true },
                { name: 'email', label: 'Email', type: 'email', required: true },
                { name: 'telefono', label: 'Teléfono', type: 'tel', required: true },
                { name: 'rutEmpresa', label: 'RUT Empresa' },
                { name: 'razonSocial', label: 'Razon Social' },
                { name: 'giro', label: 'Giro' },
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
                    className="w-full border rounded-lg px-3 py-2.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30"
                    required={field.required}
                  />
                </div>
              ))}
              <div className="sm:col-span-2">
                <label className="text-sm font-medium mb-1 block">Dirección</label>
                <input name="direccion" value={form.direccion} onChange={handleChange} className="w-full border rounded-lg px-3 py-2.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30" />
              </div>
            </div>
          </div>
          <Button type="submit" size="lg" disabled={sending} className="w-full gradient-primary text-primary-foreground h-14 text-base font-bold gap-2">
            {sending ? (
              <><span className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Enviando...</>
            ) : (
              <><Send className="h-5 w-5" /> Solicitar propuesta tecnica</>
            )}
          </Button>
        </form>
      </div>
    </div>
  );
};

export default SmartQuotePage;
