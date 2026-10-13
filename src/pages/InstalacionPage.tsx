import { Link } from 'react-router-dom';
import { MapPin, Wrench, Sun, ClipboardList } from 'lucide-react';
import {
  waInstalacion,
  contactEmailInstalacion,
  installationCoverage,
  installationVisitDescription,
} from '@/config/business';
import InstallationLeadForm from '@/components/instalacion/InstallationLeadForm';
import { sendEvent } from '@/lib/analytics';
import Seo from '@/components/Seo';

// Hero copy: Variante A implementada, Variante B documentada.
// Variante A: titulo con cobertura RM explicita, subcopy orientado a propuesta
// clara. CTA principal: Solicitar evaluacion.
// Sin cifras ni credenciales no confirmadas (PR 11): ni cantidad de proyectos, ni licencia
// SEC del equipo, ni una cifra única de garantía, ni precio de la visita, ni plazos de
// respuesta. src/config/contentTruth.test.ts vigila las frases retiradas.
// Variante B descartada: titulo poetico con ambiguedad y compromiso 48h.

const scrollToFormulario = (e: React.MouseEvent) => {
  e.preventDefault();
  document.getElementById('formulario')?.scrollIntoView({ behavior: 'smooth' });
};

const InstalacionPage = () => {
  const scrollToServicios = (e: React.MouseEvent) => {
    e.preventDefault();
    document.getElementById('servicios')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="bg-[#FAFAF7]">
    <Seo title="Instalación Profesional de Iluminación LED y Paneles Solares | eLIGHTS" description="Servicio de instalación eléctrica profesional de iluminación LED y paneles solares en la Región Metropolitana. Visita técnica, cotización y ejecución de la instalación." path="/instalacion" />

      {/* Hero */}
      <section
        className="relative overflow-hidden"
        style={{ background: '#1A0A2E' }}
      >
        <div
          className="absolute inset-0 opacity-10 animate-pulse"
          style={{
            backgroundImage:
              'linear-gradient(hsl(var(--primary)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--primary)) 1px, transparent 1px)',
            backgroundSize: '40px 40px',
          }}
        />
        <div className="relative container py-20 text-center text-white">
          <div className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-semibold mb-6 uppercase tracking-widest bg-primary/15 text-primary-foreground border border-primary/30">
            <MapPin className="h-3 w-3" />
            Región Metropolitana
          </div>
          <h1 className="text-3xl md:text-5xl font-bold mb-5 leading-tight">
            Instalación eléctrica e iluminación LED{' '}
            <em className="not-italic italic text-gradient-primary">
              profesional en la Región Metropolitana
            </em>
          </h1>
          <p className="text-gray-300 text-lg max-w-xl mx-auto mb-10 leading-relaxed">
            Evaluamos tu espacio, te enviamos una propuesta clara y coordinamos la instalación. Atendemos hogares, oficinas, locales y proyectos comerciales.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <a
              href="#formulario"
              onClick={(e) => {
                scrollToFormulario(e);
                sendEvent('instalacion_cta_hero_click');
              }}
              className="inline-flex items-center justify-center gap-2 px-7 py-3.5 rounded-xl font-bold bg-primary hover:bg-primary/90 text-primary-foreground transition-all hover:brightness-110 hover:scale-105"
            >
              <ClipboardList className="h-4 w-4" />
              Solicitar evaluación
            </a>
            <a
              href={waInstalacion}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 px-7 py-3.5 rounded-xl font-bold border-2 text-white transition-all hover:bg-white/10"
              style={{ borderColor: 'rgba(37,211,102,0.5)', color: '#4ADE80' }}
            >
              Hablar por WhatsApp
            </a>
          </div>
        </div>
      </section>

      {/* Servicios */}
      <section id="servicios" className="container py-16">
        <h2 className="text-2xl md:text-3xl font-bold text-center mb-2">Nuestros servicios</h2>
        <p className="text-center text-muted-foreground mb-10">
          Elige el servicio que mejor se adapta a tu proyecto.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="group relative rounded-2xl p-7 border-2 border-transparent bg-white shadow-sm hover:border-primary hover:shadow-lg transition-all duration-300 overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-1 rounded-t-2xl opacity-0 group-hover:opacity-100 transition-opacity bg-primary" />
            <div className="inline-flex items-center justify-center h-12 w-12 rounded-xl mb-5 bg-primary/10">
              <MapPin className="h-6 w-6 text-primary" />
            </div>
            <h3 className="text-xl font-bold mb-2">Visita Técnica</h3>
            <p className="text-muted-foreground text-sm mb-5">{installationVisitDescription}</p>
            <span className="inline-block text-xs font-semibold px-3 py-1.5 rounded-full bg-primary/10 text-primary">
              Informe con recomendaciones
            </span>
          </div>
          <div className="group relative rounded-2xl p-7 border-2 border-transparent bg-white shadow-sm hover:border-primary hover:shadow-lg transition-all duration-300 overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-1 rounded-t-2xl opacity-0 group-hover:opacity-100 transition-opacity bg-primary" />
            <div className="inline-flex items-center justify-center h-12 w-12 rounded-xl mb-5 bg-primary/10">
              <Wrench className="h-6 w-6 text-primary" />
            </div>
            <h3 className="text-xl font-bold mb-2">Instalación Completa</h3>
            <p className="text-muted-foreground text-sm mb-5">
              Nos encargamos de todo: provisión de luminarias, cableado, fijaciones y puesta en marcha.
            </p>
            <span className="inline-block text-xs font-semibold px-3 py-1.5 rounded-full bg-primary/10 text-primary">
              Producto + Mano de obra incluida
            </span>
          </div>
          <div className="group relative rounded-2xl p-7 border-2 border-transparent bg-white shadow-sm hover:border-primary hover:shadow-lg transition-all duration-300 overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-1 rounded-t-2xl opacity-0 group-hover:opacity-100 transition-opacity bg-primary" />
            <div className="inline-flex items-center justify-center h-12 w-12 rounded-xl mb-5 bg-primary/10">
              <Sun className="h-6 w-6 text-primary" />
            </div>
            <h3 className="text-xl font-bold mb-2">Paneles Solares</h3>
            <p className="text-muted-foreground text-sm mb-5">
              Instalación de sistemas fotovoltaicos para hogares y empresas. Evaluamos tu consumo, diseñamos el sistema y lo instalamos.
            </p>
            <span className="inline-block text-xs font-semibold px-3 py-1.5 rounded-full bg-primary/10 text-primary">
              Conexión a la red (Net Billing)
            </span>
          </div>
        </div>
      </section>

      {/* Cómo funciona */}
      <section className="py-16" style={{ background: 'linear-gradient(135deg, #f3e8ff 0%, #ede9fe 100%)' }}>
        <div className="container">
          <h2 className="text-2xl md:text-3xl font-bold text-center mb-12">¿Cómo funciona?</h2>
          <div className="relative flex flex-col md:flex-row items-start md:items-center justify-center gap-0">
            <div className="hidden md:block absolute top-8 left-[calc(16.67%+2rem)] right-[calc(16.67%+2rem)] h-0.5 bg-primary/60" />
            {[
              { num: '1', title: 'Cuéntanos tu proyecto', desc: 'Escríbenos por WhatsApp o correo, o usa el formulario de esta página.' },
              { num: '2', title: 'Recibe tu propuesta', desc: 'Recibirás una propuesta detallada con productos, mano de obra y plazos.' },
              { num: '3', title: 'Instalamos todo', desc: 'Nuestro equipo se encarga de la instalación profesional y te entrega el proyecto terminado.' },
            ].map(({ num, title, desc }) => (
              <div key={num} className="relative flex flex-col items-center text-center flex-1 px-6 mb-8 md:mb-0">
                <div className="z-10 flex items-center justify-center h-16 w-16 rounded-full bg-primary text-primary-foreground font-extrabold text-xl mb-4 shadow-lg">
                  {num}
                </div>
                <h3 className="font-bold text-lg mb-2">{title}</h3>
                <p className="text-sm text-muted-foreground max-w-xs">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Tipos de proyecto */}
      <section className="container py-16">
        <h2 className="text-2xl md:text-3xl font-bold text-center mb-2">Tipos de proyecto</h2>
        <p className="text-center text-muted-foreground mb-10">Estos son los tipos de proyecto que atendemos.</p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {[
            { emoji: '🏠', label: 'Casa completa' },
            { emoji: '🏢', label: 'Oficinas y locales' },
            { emoji: '🌿', label: 'Jardín y terraza' },
            { emoji: '🏗️', label: 'Obra nueva' },
            { emoji: '🏬', label: 'Bodegas e industrial' },
            { emoji: '🔄', label: 'Recambio LED' },
            { emoji: '☀️', label: 'Paneles Solares' },
          ].map(({ emoji, label }) => (
            <div key={label} className="flex flex-col items-center justify-center gap-3 rounded-2xl p-6 bg-white border border-gray-100 shadow-sm hover:shadow-md hover:-translate-y-1 transition-all duration-200 cursor-default">
              <span className="text-4xl">{emoji}</span>
              <span className="font-semibold text-sm text-center">{label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Formulario */}
      <section id="formulario" className="py-16" style={{ background: 'linear-gradient(135deg, #1A0A2E 0%, #2D1560 100%)' }}>
        <div className="container max-w-2xl">
          <div className="text-center mb-10">
            <span className="inline-block text-xs font-semibold uppercase tracking-widest px-4 py-1.5 rounded-full mb-4 bg-primary/15 text-primary-foreground border border-primary/30">
              Sin compromiso
            </span>
            <h2 className="text-2xl md:text-3xl font-bold text-white mb-3">Solicita tu evaluación</h2>
            <p className="text-gray-300 text-sm max-w-md mx-auto">
              Completa el formulario y te contactaremos para revisar tu proyecto y definir la mejor propuesta.
            </p>
          </div>
          <div className="bg-white rounded-2xl p-6 md:p-8 shadow-2xl">
            <InstallationLeadForm />
          </div>
          <p className="text-center text-gray-400 text-xs mt-4">
            ¿Prefieres escribir directo?{' '}
            <a
              href={waInstalacion}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary-foreground hover:underline"
            >
              WhatsApp
            </a>{' '}
            o{' '}
            <a
              href={'mailto:' + contactEmailInstalacion}
              className="text-primary-foreground hover:underline"
            >
              correo
            </a>
          </p>
        </div>
      </section>

      {/* Cobertura */}
      <section className="py-16 text-white text-center" style={{ background: '#1A0A2E' }}>
        <div className="container max-w-2xl">
          <h2 className="text-2xl md:text-3xl font-bold mb-4">Cobertura: Región Metropolitana</h2>
          <p className="text-gray-300 text-base leading-relaxed">{installationCoverage}</p>
        </div>
      </section>

      {/* CTA Final */}
      <section className="container py-20 text-center">
        <h2 className="text-2xl md:text-3xl font-bold mb-3">Agenda una visita técnica</h2>
        <p className="text-muted-foreground mb-8 max-w-md mx-auto">
          Evaluamos tu espacio y te enviamos una propuesta detallada.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <a
            href="#formulario"
            onClick={(e) => {
              scrollToFormulario(e);
              sendEvent('instalacion_cta_final_click');
            }}
            className="inline-flex items-center justify-center gap-2 px-8 py-3.5 rounded-xl font-bold bg-primary hover:bg-primary/90 text-primary-foreground transition-all hover:brightness-110 hover:scale-105"
          >
            <ClipboardList className="h-4 w-4" />
            Solicitar evaluación
          </a>
          <a
            href={waInstalacion}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 px-8 py-3.5 rounded-xl font-bold border-2 border-[#25D366] text-[#16A34A] hover:bg-[#25D366] hover:text-white transition-all"
          >
            WhatsApp
          </a>
        </div>
      </section>
    </div>
  );
};

export default InstalacionPage;
