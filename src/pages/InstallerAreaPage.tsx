import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Wrench, CheckCircle2, MessageCircle, FileText } from 'lucide-react';
import Seo from '@/components/Seo';
import { contactEmail, waInstaladores } from '@/config/business';

// Página de contacto para profesionales (PR 11). No hay cuentas ni niveles: el login es
// de la Fase 3. Cada punto de la lista ya existe en el sitio (precios netos con el modo
// empresa del encabezado, cotización formal con factura, asesoría y despacho).
const benefits = [
  'Precios con IVA o netos (sin IVA) en todo el catálogo',
  'Asesoría técnica por correo',
  'Cotización formal con factura',
  'Despacho en hasta 2 días hábiles',
];

const InstallerAreaPage = () => (
  <>
  <Seo title="Instaladores y profesionales | eLIGHTS Chile" description="Instaladores eléctricos, constructoras y empresas: cotiza tus proyectos de iluminación LED con eLIGHTS. Asesoría técnica y cotización formal con factura." path="/instaladores" />
  <div className="container py-8">
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="text-center mb-10">
        <div className="inline-flex items-center gap-2 bg-accent text-accent-foreground text-xs font-semibold px-3 py-1.5 rounded-full mb-4">
          <Wrench className="h-3.5 w-3.5" /> Para profesionales
        </div>
        <h1 className="text-2xl md:text-4xl font-bold mb-3">Instaladores y profesionales</h1>
        <p className="text-muted-foreground max-w-lg mx-auto">
          Atendemos a instaladores eléctricos, constructoras, arquitectos y empresas. Cuéntanos tu proyecto y te respondemos con una cotización formal con factura.
        </p>
      </div>

      <ul className="grid sm:grid-cols-2 gap-4 mb-10">
        {benefits.map(text => (
          <li key={text} className="flex items-start gap-3 border rounded-xl p-5 text-sm">
            <CheckCircle2 className="h-5 w-5 text-primary shrink-0" />
            <span>{text}</span>
          </li>
        ))}
      </ul>

      {/* Contacto */}
      <div className="border-2 border-primary/20 rounded-2xl p-8 text-center">
        <h2 className="text-xl font-bold mb-6">Cotiza tu proyecto</h2>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Button asChild size="lg" className="gap-2 h-12 text-white" style={{ backgroundColor: '#25D366' }}>
            <a href={waInstaladores} target="_blank" rel="noopener noreferrer">
              <MessageCircle className="h-4 w-4" /> Escríbenos por WhatsApp
            </a>
          </Button>
          <Button asChild size="lg" className="gradient-primary text-primary-foreground gap-2 h-12">
            <Link to="/cotizador">
              <FileText className="h-4 w-4" /> Solicitar propuesta
            </Link>
          </Button>
        </div>
        <p className="text-sm text-muted-foreground mt-6">
          También puedes escribirnos a{' '}
          <a href={'mailto:' + contactEmail} className="text-primary underline">{contactEmail}</a>.
        </p>
      </div>
    </div>
  </div>
  </>
);

export default InstallerAreaPage;
