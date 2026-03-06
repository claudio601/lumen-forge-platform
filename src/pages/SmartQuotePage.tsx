import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Send, CheckCircle2, Upload, Zap } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';

const projectTypes = ['Oficina', 'Retail', 'Bodega', 'Industria', 'Exterior', 'Vial', 'Hogar', 'Otro'];
const illuminationLevels = ['Básico', 'Estándar', 'Alto rendimiento', 'Especializado'];

const SmartQuotePage = () => {
  const [submitted, setSubmitted] = useState(false);
  const [form, setForm] = useState({
    tipoProyecto: '', m2: '', altura: '', aplicacion: '', nivelIluminacion: '', ciudad: '', plazo: '', comentarios: '',
    nombre: '', email: '', telefono: '', rutEmpresa: '', razonSocial: '', giro: '', direccion: '',
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.tipoProyecto || !form.m2 || !form.nombre || !form.email || !form.telefono) {
      toast.error('Completa todos los campos requeridos');
      return;
    }
    // CRM-ready: creates Opportunity in Pipedrive with source='smart_quote'
    console.log('Smart Quote (CRM Opportunity):', { ...form, source: 'smart_quote' });
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <div className="container py-16 text-center max-w-md mx-auto">
        <CheckCircle2 className="h-16 w-16 text-primary mx-auto mb-4" />
        <h1 className="text-2xl font-bold mb-2">Propuesta solicitada</h1>
        <p className="text-muted-foreground mb-6">Nuestro equipo técnico preparará una propuesta personalizada para tu proyecto.</p>
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
            <Zap className="h-3.5 w-3.5" /> Cotizador Inteligente
          </div>
          <h1 className="text-2xl md:text-3xl font-bold mb-2">Solicitar propuesta técnica</h1>
          <p className="text-muted-foreground">
            Describe tu proyecto y nuestro equipo preparará una propuesta integral de iluminación con productos, cantidades y precios especiales.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Project info */}
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
                <label className="text-sm font-medium mb-1 block">m² aproximados <span className="text-destructive">*</span></label>
                <input name="m2" type="number" value={form.m2} onChange={handleChange} className="w-full border rounded-lg px-3 py-2.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30" required />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Altura del espacio (m)</label>
                <input name="altura" type="number" value={form.altura} onChange={handleChange} className="w-full border rounded-lg px-3 py-2.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30" />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Tipo de aplicación</label>
                <input name="aplicacion" value={form.aplicacion} onChange={handleChange} placeholder="Ej: iluminación general, acento..." className="w-full border rounded-lg px-3 py-2.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/30" />
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
              <p className="text-sm">Adjuntar planos o especificaciones (próximamente)</p>
            </div>
          </div>

          {/* Contact info */}
          <div className="border rounded-xl p-6 space-y-4">
            <h2 className="font-bold">Datos de contacto</h2>
            <div className="grid sm:grid-cols-2 gap-4">
              {[
                { name: 'nombre', label: 'Nombre y Apellido', required: true },
                { name: 'email', label: 'Email', type: 'email', required: true },
                { name: 'telefono', label: 'Teléfono', type: 'tel', required: true },
                { name: 'rutEmpresa', label: 'RUT Empresa' },
                { name: 'razonSocial', label: 'Razón Social' },
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

          <Button type="submit" size="lg" className="w-full gradient-primary text-primary-foreground h-14 text-base font-bold gap-2">
            <Send className="h-5 w-5" /> Solicitar propuesta técnica
          </Button>
        </form>
      </div>
    </div>
  );
};

export default SmartQuotePage;
