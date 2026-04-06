import { Link } from 'react-router-dom';
import { MapPin, Wrench, ChevronDown, Sun } from 'lucide-react';
import {
  waInstalacion,
  contactEmailInstalacion,
  installationCoverage,
  installationVisitLabel,
  installationVisitDescription,
} from '@/config/business';
import InstallationLeadForm from '@/components/instalacion/InstallationLeadForm';

const InstalacionPage = () => {
  const scrollToServicios = (e: React.MouseEvent) => {
    e.preventDefault();
    document.getElementById('servicios')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="bg-[#FAFAF7]">
      {/* Hero */}
      <section
        className="relative overflow-hidden"
        style={{ background: '#1A0A2E' }}
      >
        <div
          className="absolute inset-0 opacity-10 animate-pulse"
          style={{
            backgroundImage:
              'linear-gradient(#7C3AED 1px, transparent 1px), linear-gradient(90deg, #7C3AED 1px, transparent 1px)',
            backgroundSize: '40px 40px',
          }}
        />
        <div className="relative container py-20 text-center text-white">
          <h1 className="text-3xl md:text-5xl font-bold mb-4 leading-tight">
            Iluminamos tu proyecto,{' '}
            <em className="not-italic italic" style={{ color: '#FCD34D' }}>
              de principio a fin
            </em>
          </h1>
          <p className="text-gray-300 text-lg max-w-2xl mx-auto mb-8">
            Diseno, suministro e instalacion de sistemas de iluminacion LED para hogares, oficinas
            e industria. Tecnicos certificados SEC, materiales de primera calidad y garantia real.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-14">
            <a
              href={waInstalacion}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 px-7 py-3.5 rounded-xl font-bold text-white transition-all hover:brightness-110 hover:scale-105"
              style={{ background: '#25D366' }}
            >
              Cotizar por WhatsApp
            </a>
            <a
              href="#servicios"
              onClick={scrollToServicios}
              className="inline-flex items-center justify-center gap-2 px-7 py-3.5 rounded-xl font-bold border-2 border-white/30 text-white hover:border-white/60 transition-all"
            >
              Ver servicios <ChevronDown className="h-4 w-4" />
            </a>
          </div>
          <div className="grid grid-cols-3 gap-4 max-w-xl mx-auto">
            {[
              { value: '100+', label: 'Proyectos' },
              { value: 'SEC', label: 'Certificados' },
              { value: '12 meses', label: 'Garantia' },
            ].map(({ value, label }) => (
              <div
                key={label}
                className="rounded-2xl px-4 py-5"
                style={{
                  background: 'rgba(124,58,237,0.25)',
                  border: '1px solid rgba(124,58,237,0.4)',
                }}
              >
                <p className="text-2xl font-extrabold" style={{ color: '#FCD34D' }}>
                  {value}
                </p>
                <p className="text-xs text-gray-300 mt-0.5">{label}</p>
              </div>
            ))}
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
          {/* Visita Tecnica */}
          <div className="group relative rounded-2xl p-7 border-2 border-transparent bg-white shadow-sm hover:border-purple-600 hover:shadow-lg transition-all duration-300 overflow-hidden">
            <div
              className="absolute top-0 left-0 right-0 h-1 rounded-t-2xl opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ background: 'linear-gradient(90deg, #7C3AED, #F59E0B)' }}
            />
            <div
              className="inline-flex items-center justify-center h-12 w-12 rounded-xl mb-5"
              style={{ background: 'rgba(124,58,237,0.12)' }}
            >
              <MapPin className="h-6 w-6" style={{ color: '#7C3AED' }} />
            </div>
            <h3 className="text-xl font-bold mb-2">Visita Tecnica</h3>
            <p className="text-muted-foreground text-sm mb-5">{installationVisitDescription}</p>
            <span
              className="inline-block text-xs font-semibold px-3 py-1.5 rounded-full"
              style={{ background: 'rgba(124,58,237,0.10)', color: '#6B21A8' }}
            >
              {installationVisitLabel}
            </span>
          </div>
          {/* Instalacion Completa */}
          <div className="group relative rounded-2xl p-7 border-2 border-transparent bg-white shadow-sm hover:border-purple-600 hover:shadow-lg transition-all duration-300 overflow-hidden">
            <div
              className="absolute top-0 left-0 right-0 h-1 rounded-t-2xl opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ background: 'linear-gradient(90deg, #7C3AED, #F59E0B)' }}
            />
            <div
              className="inline-flex items-center justify-center h-12 w-12 rounded-xl mb-5"
              style={{ background: 'rgba(245,158,11,0.12)' }}
            >
              <Wrench className="h-6 w-6" style={{ color: '#F59E0B' }} />
            </div>
            <h3 className="text-xl font-bold mb-2">Instalacion Completa</h3>
            <p className="text-muted-foreground text-sm mb-5">
              Nos encargamos de todo: provision de luminarias, cableado, fijaciones y puesta en
              marcha. Trabajo limpio, garantizado y con certificacion de instalacion electrica cuando
              aplique.
            </p>
            <span
              className="inline-block text-xs font-semibold px-3 py-1.5 rounded-full"
              style={{ background: 'rgba(245,158,11,0.10)', color: '#92400E' }}
            >
              Producto + Mano de obra incluida
            </span>
          </div>
          {/* Paneles Solares */}
          <div className="group relative rounded-2xl p-7 border-2 border-transparent bg-white shadow-sm hover:border-purple-600 hover:shadow-lg transition-all duration-300 overflow-hidden">
            <div
              className="absolute top-0 left-0 right-0 h-1 rounded-t-2xl opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ background: 'linear-gradient(90deg, #7C3AED, #F59E0B)' }}
            />
            <div
              className="inline-flex items-center justify-center h-12 w-12 rounded-xl mb-5"
              style={{ background: 'rgba(251,191,36,0.15)' }}
            >
              <Sun className="h-6 w-6" style={{ color: '#D97706' }} />
            </div>
            <h3 className="text-xl font-bold mb-2">Paneles Solares</h3>
            <p className="text-muted-foreground text-sm mb-5">
              Instalacion de sistemas fotovoltaicos para hogares y empresas. Evaluamos tu consumo,
              disenamos el sistema y lo instalamos con conexion a la red (Net Billing).
            </p>
            <span
              className="inline-block text-xs font-semibold px-3 py-1.5 rounded-full"
              style={{ background: 'rgba(251,191,36,0.12)', color: '#92400E' }}
            >
              Ahorro desde el primer mes
            </span>
          </div>
        </div>
      </section>

      {/* Como funciona */}
      <section
        className="py-16"
        style={{ background: 'linear-gradient(135deg, #f3e8ff 0%, #ede9fe 100%)' }}
      >
        <div className="container">
          <h2 className="text-2xl md:text-3xl font-bold text-center mb-12">Como funciona?</h2>
          <div className="relative flex flex-col md:flex-row items-start md:items-center justify-center gap-0">
            <div
              className="hidden md:block absolute top-8 left-[calc(16.67%+2rem)] right-[calc(16.67%+2rem)] h-0.5"
              style={{ background: 'linear-gradient(90deg, #7C3AED, #F59E0B)' }}
            />
            {[
              {
                num: '1',
                title: 'Cuentanos tu proyecto',
                desc: 'Escribenos por WhatsApp, correo o usa el formulario de esta pagina.',
              },
              {
                num: '2',
                title: 'Recibe tu cotizacion',
                desc: 'En 24 h habiles recibiras una propuesta detallada con productos, mano de obra y plazos.',
              },
              {
                num: '3',
                title: 'Instalamos todo',
                desc: 'Nuestro equipo se encarga de la instalacion profesional y te entrega el proyecto listo.',
              },
            ].map(({ num, title, desc }) => (
              <div
                key={num}
                className="relative flex flex-col items-center text-center flex-1 px-6 mb-8 md:mb-0"
              >
                <div
                  className="z-10 flex items-center justify-center h-16 w-16 rounded-full text-white font-extrabold text-xl mb-4 shadow-lg"
                  style={{ background: 'linear-gradient(135deg, #7C3AED, #F59E0B)' }}
                >
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
        <p className="text-center text-muted-foreground mb-10">
          Experiencia en todo tipo de instalaciones.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {[
            { emoji: '🏠', label: 'Casa completa' },
            { emoji: '🏢', label: 'Oficinas y locales' },
            { emoji: '🌿', label: 'Jardin y terraza' },
            { emoji: '🏗️', label: 'Obra nueva' },
            { emoji: '🏬', label: 'Bodegas e industrial' },
            { emoji: '🔄', label: 'Recambio LED' },
            {
              emoji: '☀️',
              label: 'Paneles Solares',
              desc: 'Sistemas fotovoltaicos residenciales y comerciales con Net Billing.',
            },
          ].map(({ emoji, label, desc }) => (
            <div
              key={label}
              className="flex flex-col items-center justify-center gap-3 rounded-2xl p-6 bg-white border border-gray-100 shadow-sm hover:shadow-md hover:-translate-y-1 transition-all duration-200 cursor-default"
            >
              <span className="text-4xl">{emoji}</span>
              <span className="font-semibold text-sm text-center">{label}</span>
              {desc && <span className="text-xs text-muted-foreground text-center">{desc}</span>}
            </div>
          ))}
        </div>
      </section>

      {/* Formulario de solicitud de instalacion */}
      <section
        id="formulario"
        className="py-16"
        style={{ background: 'linear-gradient(135deg, #1A0A2E 0%, #2D1560 100%)' }}
      >
        <div className="container max-w-2xl">
          <div className="text-center mb-10">
            <span
              className="inline-block text-xs font-semibold uppercase tracking-widest px-4 py-1.5 rounded-full mb-4"
              style={{ background: 'rgba(252,211,77,0.15)', color: '#FCD34D' }}
            >
              Cotizacion gratuita
            </span>
            <h2 className="text-2xl md:text-3xl font-bold text-white mb-3">
              Solicita tu cotizacion
            </h2>
            <p className="text-gray-300 text-sm max-w-md mx-auto">
              Completa el formulario y nuestro equipo te responde en menos de 24 horas habiles con
              una propuesta personalizada.
            </p>
          </div>
          <div className="bg-white rounded-2xl p-6 md:p-8 shadow-2xl">
            <InstallationLeadForm />
          </div>
          <p className="text-center text-gray-400 text-xs mt-4">
            Preferes escribir directo?{' '}
            <a
              href={waInstalacion}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#FCD34D] hover:underline"
            >
              WhatsApp
            </a>{' '}
            o{' '}
            <a
              href={'mailto:' + contactEmailInstalacion}
              className="text-[#FCD34D] hover:underline"
            >
              correo
            </a>
          </p>
        </div>
      </section>

      {/* Cobertura */}
      <section className="py-16 text-white text-center" style={{ background: '#1A0A2E' }}>
        <div className="container max-w-2xl">
          <h2 className="text-2xl md:text-3xl font-bold mb-4">Region Metropolitana</h2>
          <p className="text-gray-300 text-base leading-relaxed">{installationCoverage}</p>
        </div>
      </section>

      {/* CTA Final */}
      <section className="container py-20 text-center">
        <h2 className="text-2xl md:text-3xl font-bold mb-3">Cotiza tu proyecto hoy</h2>
        <p className="text-muted-foreground mb-8 max-w-md mx-auto">
          Sin compromiso. Te respondemos en menos de 24 horas habiles.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <a
            href={waInstalacion}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 px-8 py-3.5 rounded-xl font-bold text-white transition-all hover:brightness-110 hover:scale-105"
            style={{ background: '#25D366' }}
          >
            WhatsApp
          </a>
          <a
            href={'mailto:' + contactEmailInstalacion}
            className="inline-flex items-center justify-center gap-2 px-8 py-3.5 rounded-xl font-bold border-2 border-primary text-primary hover:bg-primary hover:text-white transition-all"
          >
            Escribir un correo
          </a>
        </div>
      </section>
    </div>
  );
};

export default InstalacionPage;
