// src/pages/EstudioLuminicoPage.tsx
import { useEffect } from 'react';
import {
  FileText, Zap, BarChart3, MapPin, Clock, ChevronDown,
  Building2, Truck, Shield, Lightbulb, Globe, GraduationCap,
  ClipboardList, MessageSquare, CheckCircle, ArrowRight,
} from 'lucide-react';
import EstudioLuminicoLeadForm from '@/components/estudio-luminico/EstudioLuminicoLeadForm';
import { waEstudioLuminico } from '@/config/business';
import { sendEvent } from '@/lib/analytics';

// ── Helpers de scroll ─────────────────────────────────────────────────────────

const scrollToForm = (e: React.MouseEvent) => {
  e.preventDefault();
  document.getElementById('solicitar')?.scrollIntoView({ behavior: 'smooth' });
};

// ── Datos de secciones ────────────────────────────────────────────────────────

const APLICACIONES = [
  {
    icon: <Globe className="h-7 w-7" style={{ color: '#06B6D4' }} />,
    title: 'Estadios y canchas deportivas',
    desc: 'Canchas de futbol, rugby, tenis, atletismo y recintos multideporte. Simulacion orientada a criterios FIFA aplicables y normas internacionales de iluminacion deportiva.',
  },
  {
    icon: <Building2 className="h-7 w-7" style={{ color: '#06B6D4' }} />,
    title: 'Industria y bodegas',
    desc: 'Naves industriales, plantas de produccion y centros de distribucion. Verificacion segun EN 12464-1/2 y criterios SEC/RIC aplicables al tipo de tarea.',
  },
  {
    icon: <Truck className="h-7 w-7" style={{ color: '#06B6D4' }} />,
    title: 'Estacionamientos',
    desc: 'Recintos cubiertos y al aire libre. Definicion de uniformidades, cotas de seguridad y propuesta de luminarias de alta eficiencia.',
  },
  {
    icon: <Lightbulb className="h-7 w-7" style={{ color: '#06B6D4' }} />,
    title: 'Edificios comerciales',
    desc: 'Oficinas, retail, centros comerciales y locales. Calculo de planos de trabajo, uniformidades y eficiencia energetica.',
  },
  {
    icon: <MapPin className="h-7 w-7" style={{ color: '#06B6D4' }} />,
    title: 'Vialidad y exteriores',
    desc: 'Calles, avenidas, plazas y circuitos peatonales. Verificacion segun EN 13201 y requisitos SEC de producto e instalacion.',
  },
  {
    icon: <GraduationCap className="h-7 w-7" style={{ color: '#06B6D4' }} />,
    title: 'Proyectos especiales',
    desc: 'Colegios, hospitales, terminales de transporte y recintos mixtos. Estudio adaptado al perfil de uso y normativa aplicable al proyecto.',
  },
];

const ENTREGABLES = [
  {
    num: '01',
    title: 'Datos de planificacion',
    desc: 'Factor de mantenimiento, potencias instaladas y flujo luminoso total del sistema.',
  },
  {
    num: '02',
    title: 'Coordenadas de luminarias',
    desc: 'Posicion X/Y/Z de cada luminaria, angulos de apunte y datos de montaje.',
  },
  {
    num: '03',
    title: 'Renders 3D y colores falsos',
    desc: 'Visualizacion fotorrealista del recinto con representacion de niveles de iluminancia.',
  },
  {
    num: '04',
    title: 'Isolineas y gama de grises',
    desc: 'Mapas de curvas de igual iluminancia sobre el plano de trabajo o campo deportivo.',
  },
  {
    num: '05',
    title: 'Tabla punto a punto',
    desc: 'Valores en lux para cada punto de la trama de calculo definida en el recinto.',
  },
  {
    num: '06',
    title: 'Resumen de cumplimiento',
    desc: 'Em, Emin/Em, Emin/Emax comparados contra la normativa objetivo del proyecto.',
  },
];

const PROCESO = [
  {
    num: '1',
    title: 'Solicita tu estudio',
    desc: 'Completa el formulario con los datos del proyecto. Mientras mas informacion, mas precisa la cotizacion.',
  },
  {
    num: '2',
    title: 'Cotizacion del estudio',
    desc: 'Te enviamos la cotizacion del estudio junto con la propuesta de luminarias eLIGHTS recomendadas.',
  },
  {
    num: '3',
    title: 'Simulacion DIALux',
    desc: 'Nuestro ingeniero modela el recinto con archivos .IES reales de las luminarias propuestas.',
  },
  {
    num: '4',
    title: 'Informe final PDF',
    desc: 'Recibes el informe completo con renders, tablas, isolineas y verificacion normativa.',
  },
];

const NORMATIVAS = [
  {
    categoria: 'Deportes',
    items: [
      'Criterios FIFA aplicables al proyecto',
      'EN 12193 — Iluminacion de instalaciones deportivas',
      'Guias CIE de iluminacion deportiva',
    ],
    color: '#06B6D4',
  },
  {
    categoria: 'Industria y comercial',
    items: [
      'EN 12464-1 — Lugares de trabajo interiores',
      'EN 12464-2 — Lugares de trabajo exteriores',
      'Criterios SEC / RIC aplicables',
    ],
    color: '#7C3AED',
  },
  {
    categoria: 'Vialidad y exterior',
    items: [
      'EN 13201 — Iluminacion de carreteras',
      'SEC — Requisitos de producto e instalacion',
    ],
    color: '#F59E0B',
  },
];

const FAQ = [
  {
    q: 'Sirve para licitaciones?',
    a: 'Si. El informe PDF incluye la verificacion normativa, tablas de resultados y memorias de calculo que pueden adjuntarse como respaldo tecnico en una licitacion o ingenieria.',
  },
  {
    q: 'Puedo solicitar el estudio sin planos DWG?',
    a: 'Si. Con medidas aproximadas del recinto y fotos del lugar podemos realizar la simulacion. Los resultados seran orientativos; un plano DWG permite mayor precision.',
  },
  {
    q: 'El estudio incluye propuesta de luminarias?',
    a: 'Si. El estudio siempre incluye la propuesta de luminarias eLIGHTS que se usaron en la simulacion, con ficha tecnica y cotizacion. El valor del estudio no se descuenta de la compra.',
  },
  {
    q: 'Cuanto demora la entrega?',
    a: 'El informe se entrega en 48 horas desde la recepcion de todos los antecedentes del proyecto (planos o medidas, altura de montaje, normativa objetivo).',
  },
  {
    q: 'En que formato se entrega el informe?',
    a: 'El informe se entrega en formato PDF con renders 3D, mapas de isolineas, tablas punto a punto y resumen de cumplimiento normativo. Aproximadamente 20 paginas.',
  },
  {
    q: 'Que normativas se pueden verificar?',
    a: 'Verificamos segun EN 12193, EN 12464-1/2, EN 13201, criterios FIFA aplicables y criterios SEC/RIC. Si tienes una normativa especifica, indicalaa en el formulario.',
  },
];

// ── Componente FAQ ────────────────────────────────────────────────────────────

const FaqItem = ({ q, a }: { q: string; a: string }) => (
  <details className="border border-gray-200 rounded-2xl overflow-hidden group">
    <summary className="flex items-center justify-between gap-4 px-6 py-5 cursor-pointer list-none font-semibold text-gray-900 hover:bg-gray-50 transition-colors">
      {q}
      <ChevronDown className="h-4 w-4 text-gray-400 flex-shrink-0 group-open:rotate-180 transition-transform" />
    </summary>
    <div className="px-6 pb-5 text-sm text-gray-600 leading-relaxed border-t border-gray-100 pt-4">
      {a}
    </div>
  </details>
);

// ── Componente Preview (placeholder para imagenes reales) ─────────────────────

const ReportPreview = ({
  title,
  subtitle,
  icon,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
}) => (
  <div
    className="rounded-2xl overflow-hidden border border-cyan-200/30"
    style={{ background: 'rgba(6,182,212,0.06)' }}
  >
    {/* Placeholder con aspect ratio 4/3 — reemplazar con imagen real */}
    {/* TODO: reemplazar con <img src="..." alt="..." /> cuando esten las capturas DIALux */}
    <div
      className="flex flex-col items-center justify-center gap-3 text-center p-8"
      style={{ aspectRatio: '4/3', background: 'rgba(6,182,212,0.08)' }}
    >
      <div
        className="h-16 w-16 rounded-2xl flex items-center justify-center"
        style={{ background: 'rgba(6,182,212,0.15)' }}
      >
        {icon}
      </div>
      <p className="text-sm font-semibold text-cyan-700">{title}</p>
      <p className="text-xs text-cyan-600/70">{subtitle}</p>
      <span className="text-xs text-cyan-500/50 mt-2 italic">
        Preview del informe DIALux
      </span>
    </div>
    <div className="px-5 py-3 border-t border-cyan-200/20">
      <p className="text-xs font-semibold text-cyan-800">{title}</p>
      <p className="text-xs text-gray-500">{subtitle}</p>
    </div>
  </div>
);

// ── Pagina principal ──────────────────────────────────────────────────────────

const EstudioLuminicoPage = () => {
  // SEO: actualizar document.title y meta description
  useEffect(() => {
    document.title =
      'Estudio Luminico DIALux en Chile | Simulacion y Calculo de Iluminacion | eLIGHTS';
    const meta = document.querySelector('meta[name="description"]');
    const desc =
      'Solicita un estudio luminico profesional en DIALux para canchas, bodegas, estacionamientos, industria y vialidad. Informe tecnico con simulacion 3D, verificacion normativa y propuesta de luminarias LED. Entrega en 48 horas desde la recepcion de todos los antecedentes.';
    if (meta) {
      meta.setAttribute('content', desc);
    } else {
      const newMeta = document.createElement('meta');
      newMeta.name = 'description';
      newMeta.content = desc;
      document.head.appendChild(newMeta);
    }
    return () => {
      document.title = 'eLIGHTS — Iluminacion LED Profesional Chile';
    };
  }, []);

  return (
    <div className="bg-[#FAFAF7]">

      {/* ── 1. HERO ─────────────────────────────────────────────────────────── */}
      <section
        className="relative overflow-hidden"
        style={{ background: 'linear-gradient(135deg, #0A0E1A 0%, #111833 100%)' }}
      >
        {/* Grid pattern decorativo */}
        <div
          className="absolute inset-0 opacity-5"
          style={{
            backgroundImage:
              'linear-gradient(#06B6D4 1px, transparent 1px), linear-gradient(90deg, #06B6D4 1px, transparent 1px)',
            backgroundSize: '50px 50px',
          }}
        />

        <div className="relative container py-20 text-center text-white">
          {/* Badge */}
          <div
            className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-semibold mb-6 uppercase tracking-widest"
            style={{
              background: 'rgba(6,182,212,0.12)',
              color: '#67E8F9',
              border: '1px solid rgba(6,182,212,0.25)',
            }}
          >
            <Zap className="h-3 w-3" />
            Servicio profesional
          </div>

          {/* H1 */}
          <h1 className="text-3xl md:text-5xl font-bold mb-5 leading-tight max-w-4xl mx-auto">
            Estudio Luminico DIALux para proyectos{' '}
            <em
              className="not-italic italic"
              style={{ color: '#06B6D4' }}
            >
              deportivos, industriales y comerciales
            </em>
          </h1>

          {/* Subtitulo */}
          <p className="text-gray-300 text-lg max-w-2xl mx-auto mb-10 leading-relaxed">
            Simulacion profesional que permite verificar cumplimiento normativo, optimizar
            la seleccion de luminarias y reducir el riesgo tecnico antes de comprar o
            instalar. Incluye propuesta de luminarias eLIGHTS.
          </p>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row gap-3 justify-center mb-14">
            <a
              href="#solicitar"
              onClick={(e) => {
                scrollToForm(e);
                sendEvent('estudio_luminico_cta_hero_click');
              }}
              className="inline-flex items-center justify-center gap-2 px-7 py-3.5 rounded-xl font-bold text-white transition-all hover:brightness-110 hover:scale-105"
              style={{ background: 'linear-gradient(135deg, #0891B2, #06B6D4)' }}
            >
              <ClipboardList className="h-4 w-4" />
              Solicitar estudio
            </a>
            <a
              href={waEstudioLuminico}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => sendEvent('estudio_luminico_whatsapp_click', { source: 'hero' })}
              className="inline-flex items-center justify-center gap-2 px-7 py-3.5 rounded-xl font-bold border-2 text-white transition-all hover:bg-white/10"
              style={{ borderColor: 'rgba(37,211,102,0.5)', color: '#4ADE80' }}
            >
              Consultar por WhatsApp
            </a>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-4 max-w-2xl mx-auto">
            {[
              { value: 'DIALux', label: 'Software profesional de modelacion' },
              { value: '48h', label: 'Con antecedentes completos' },
              { value: '~20 pag', label: 'Informe PDF con renders y tablas' },
            ].map(({ value, label }) => (
              <div
                key={label}
                className="rounded-2xl px-4 py-5"
                style={{
                  background: 'rgba(6,182,212,0.12)',
                  border: '1px solid rgba(6,182,212,0.25)',
                }}
              >
                <p className="text-xl md:text-2xl font-extrabold" style={{ color: '#67E8F9' }}>
                  {value}
                </p>
                <p className="text-xs text-gray-300 mt-1 leading-snug">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 2. QUE RESUELVE ──────────────────────────────────────────────────── */}
      <section className="container py-16">
        <div className="max-w-3xl mx-auto text-center mb-12">
          <h2 className="text-2xl md:text-3xl font-bold mb-4">
            Que resuelve este estudio
          </h2>
          <p className="text-muted-foreground">
            Antes de comprar o instalar, necesitas saber que el sistema va a funcionar.
            Eso es exactamente lo que entrega el estudio luminico.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 max-w-4xl mx-auto">
          {[
            {
              icon: <Shield className="h-5 w-5" style={{ color: '#06B6D4' }} />,
              title: 'Evita subiluminacion y sobredimensionamiento',
              desc: 'Detecta si el sistema propuesto entrega la iluminancia real que necesitas o si estas pagando de mas por potencia innecesaria.',
            },
            {
              icon: <CheckCircle className="h-5 w-5" style={{ color: '#06B6D4' }} />,
              title: 'Valida cumplimiento antes de comprar',
              desc: 'Verifica si el nivel de iluminacion, la uniformidad y las relaciones Emin/Em cumplen con la normativa objetivo del proyecto.',
            },
            {
              icon: <FileText className="h-5 w-5" style={{ color: '#06B6D4' }} />,
              title: 'Respalda licitaciones e ingenieria',
              desc: 'El informe PDF sirve como memoria de calculo en procesos de licitacion, ingenieria o revision de obra.',
            },
            {
              icon: <BarChart3 className="h-5 w-5" style={{ color: '#06B6D4' }} />,
              title: 'Define la propuesta tecnica optima',
              desc: 'Determina cantidad, potencia, optica y disposicion de luminarias especificamente para tu recinto y uso.',
            },
          ].map(({ icon, title, desc }) => (
            <div
              key={title}
              className="flex gap-4 p-6 bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow"
            >
              <div
                className="flex-shrink-0 h-10 w-10 rounded-xl flex items-center justify-center"
                style={{ background: 'rgba(6,182,212,0.10)' }}
              >
                {icon}
              </div>
              <div>
                <h3 className="font-bold text-gray-900 mb-1 text-sm">{title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── 3. VISTA PREVIA DEL ENTREGABLE ───────────────────────────────────── */}
      <section
        className="py-16"
        style={{ background: 'linear-gradient(135deg, #f0f9ff 0%, #ecfeff 100%)' }}
      >
        <div className="container">
          <div className="text-center mb-12">
            <h2 className="text-2xl md:text-3xl font-bold mb-3">
              Que recibe el cliente
            </h2>
            <p className="text-muted-foreground max-w-xl mx-auto">
              El informe PDF incluye representaciones graficas y tablas numericas
              que permiten verificar el desempeno del sistema antes de la instalacion.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
            <ReportPreview
              title="Rendering de colores falsos"
              subtitle="Distribucion de iluminancia sobre el recinto"
              icon={<BarChart3 className="h-8 w-8" style={{ color: '#06B6D4' }} />}
            />
            <ReportPreview
              title="Mapa de isolineas"
              subtitle="Curvas de igual iluminancia sobre el plano de trabajo"
              icon={<Globe className="h-8 w-8" style={{ color: '#06B6D4' }} />}
            />
            <ReportPreview
              title="Tabla de resumen"
              subtitle="Em, Emin, Emax, Emin/Em, Emin/Emax vs normativa objetivo"
              icon={<FileText className="h-8 w-8" style={{ color: '#06B6D4' }} />}
            />
          </div>
        </div>
      </section>

      {/* ── 4. APLICACIONES ──────────────────────────────────────────────────── */}
      <section className="container py-16">
        <h2 className="text-2xl md:text-3xl font-bold text-center mb-3">
          Tipos de proyecto
        </h2>
        <p className="text-center text-muted-foreground mb-10">
          Experiencia en recintos deportivos, industriales, comerciales y de vialidad.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {APLICACIONES.map(({ icon, title, desc }) => (
            <div
              key={title}
              className="group relative rounded-2xl p-6 border-2 border-transparent bg-white shadow-sm hover:border-cyan-400 hover:shadow-lg transition-all duration-300 overflow-hidden"
            >
              <div
                className="absolute top-0 left-0 right-0 h-1 rounded-t-2xl opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ background: 'linear-gradient(90deg, #06B6D4, #0891B2)' }}
              />
              <div
                className="inline-flex items-center justify-center h-12 w-12 rounded-xl mb-4"
                style={{ background: 'rgba(6,182,212,0.10)' }}
              >
                {icon}
              </div>
              <h3 className="font-bold text-base mb-2">{title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── 5. ENTREGABLES ───────────────────────────────────────────────────── */}
      <section
        className="py-16"
        style={{ background: '#FAFAF7' }}
      >
        <div className="container">
          <h2 className="text-2xl md:text-3xl font-bold text-center mb-3">
            Contenido del informe
          </h2>
          <p className="text-center text-muted-foreground mb-10">
            Seis componentes que forman el informe tecnico de aproximadamente 20 paginas.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 max-w-5xl mx-auto">
            {ENTREGABLES.map(({ num, title, desc }) => (
              <div
                key={num}
                className="flex gap-4 p-5 bg-white rounded-2xl border border-gray-100 shadow-sm"
              >
                <div
                  className="flex-shrink-0 h-10 w-10 rounded-xl flex items-center justify-center font-extrabold text-sm"
                  style={{ background: 'rgba(6,182,212,0.12)', color: '#0891B2' }}
                >
                  {num}
                </div>
                <div>
                  <h3 className="font-bold text-sm mb-1">{title}</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 6. QUE NECESITAMOS PARA COTIZAR ──────────────────────────────────── */}
      <section
        className="py-14"
        style={{
          background: 'linear-gradient(135deg, rgba(6,182,212,0.06) 0%, rgba(8,145,178,0.04) 100%)',
          borderTop: '1px solid rgba(6,182,212,0.15)',
          borderBottom: '1px solid rgba(6,182,212,0.15)',
        }}
      >
        <div className="container max-w-3xl">
          <h2 className="text-2xl md:text-3xl font-bold text-center mb-3">
            Que necesitamos para cotizar
          </h2>
          <p className="text-center text-muted-foreground mb-8">
            Con esta informacion podemos preparar la cotizacion del estudio. Si no tienes
            todo, no hay problema: el formulario te pregunta exactamente por esto.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              'Planos DWG/PDF o medidas aproximadas del recinto',
              'Altura de montaje disponible (postes, estructura o cielo)',
              'Uso del recinto y nivel de iluminacion esperado',
              'Fotos del lugar si no hay planos disponibles',
            ].map((item) => (
              <div key={item} className="flex items-start gap-3">
                <CheckCircle className="h-5 w-5 flex-shrink-0 mt-0.5" style={{ color: '#06B6D4' }} />
                <p className="text-sm text-gray-700">{item}</p>
              </div>
            ))}
          </div>
          <div
            className="mt-8 rounded-xl px-5 py-4 text-sm text-center"
            style={{ background: 'rgba(6,182,212,0.10)', color: '#0891B2' }}
          >
            <Clock className="h-4 w-4 inline mr-2" />
            El informe se entrega en{' '}
            <strong>48 horas desde la recepcion de todos los antecedentes</strong>.
          </div>
        </div>
      </section>

      {/* ── 7. PROCESO ───────────────────────────────────────────────────────── */}
      <section
        className="py-16"
        style={{ background: 'linear-gradient(135deg, #0A0E1A 0%, #111833 100%)' }}
      >
        <div className="container">
          <h2 className="text-2xl md:text-3xl font-bold text-center text-white mb-12">
            Como funciona
          </h2>
          <div className="relative flex flex-col md:flex-row items-start md:items-center justify-center gap-0 max-w-4xl mx-auto">
            {/* Linea conectora */}
            <div
              className="hidden md:block absolute top-8 left-[calc(12.5%+2rem)] right-[calc(12.5%+2rem)] h-0.5"
              style={{ background: 'linear-gradient(90deg, #06B6D4, #0891B2)' }}
            />
            {PROCESO.map(({ num, title, desc }) => (
              <div
                key={num}
                className="relative flex flex-col items-center text-center flex-1 px-6 mb-10 md:mb-0"
              >
                <div
                  className="z-10 flex items-center justify-center h-16 w-16 rounded-full text-white font-extrabold text-xl mb-4 shadow-lg"
                  style={{ background: 'linear-gradient(135deg, #06B6D4, #0891B2)' }}
                >
                  {num}
                </div>
                <h3 className="font-bold text-base mb-2 text-white">{title}</h3>
                <p className="text-sm text-gray-400 max-w-xs leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 8. NORMATIVAS ────────────────────────────────────────────────────── */}
      <section className="container py-16">
        <h2 className="text-2xl md:text-3xl font-bold text-center mb-3">
          Normativas por vertical
        </h2>
        <p className="text-center text-muted-foreground mb-10 max-w-xl mx-auto">
          El estudio verifica segun la normativa objetivo del proyecto. No hacemos
          promesas absolutas de cumplimiento; aplicamos criterios tecnicos rigurosos
          de verificacion.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
          {NORMATIVAS.map(({ categoria, items, color }) => (
            <div
              key={categoria}
              className="rounded-2xl p-6 border bg-white shadow-sm"
              style={{ borderColor: color + '33' }}
            >
              <div
                className="inline-block text-xs font-bold px-3 py-1 rounded-full mb-4 uppercase tracking-widest"
                style={{ background: color + '15', color }}
              >
                {categoria}
              </div>
              <ul className="space-y-3">
                {items.map((item) => (
                  <li key={item} className="flex items-start gap-2 text-sm text-gray-700">
                    <ArrowRight
                      className="h-4 w-4 flex-shrink-0 mt-0.5"
                      style={{ color }}
                    />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* ── 9. FAQ ───────────────────────────────────────────────────────────── */}
      <section
        className="py-16"
        style={{ background: 'linear-gradient(135deg, #f0f9ff 0%, #ecfeff 100%)' }}
      >
        <div className="container max-w-3xl">
          <h2 className="text-2xl md:text-3xl font-bold text-center mb-10">
            Preguntas frecuentes
          </h2>
          <div className="space-y-3">
            {FAQ.map(({ q, a }) => (
              <FaqItem key={q} q={q} a={a} />
            ))}
          </div>
        </div>
      </section>

      {/* ── 10. FORMULARIO ───────────────────────────────────────────────────── */}
      <section
        id="solicitar"
        className="py-16"
        style={{ background: 'linear-gradient(135deg, #0A0E1A 0%, #111833 100%)' }}
      >
        <div className="container max-w-2xl">
          <div className="text-center mb-10">
            <span
              className="inline-block text-xs font-semibold uppercase tracking-widest px-4 py-1.5 rounded-full mb-4"
              style={{ background: 'rgba(6,182,212,0.15)', color: '#67E8F9' }}
            >
              Solicita tu cotizacion
            </span>
            <h2 className="text-2xl md:text-3xl font-bold text-white mb-3">
              Cuantame tu proyecto
            </h2>
            <p className="text-gray-300 text-sm max-w-md mx-auto">
              Completa el formulario con los datos del recinto. Te enviamos la cotizacion
              del estudio junto con la propuesta de luminarias eLIGHTS.
            </p>
          </div>

          <div className="bg-white rounded-2xl p-6 md:p-8 shadow-2xl">
            <EstudioLuminicoLeadForm />
          </div>

          {/* 11. CTA alternativo WhatsApp */}
          <p className="text-center text-gray-400 text-xs mt-5">
            Prefieres consultar directamente?{' '}
            <a
              href={waEstudioLuminico}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() =>
                sendEvent('estudio_luminico_whatsapp_click', { source: 'form_footer' })
              }
              className="font-semibold hover:underline"
              style={{ color: '#67E8F9' }}
            >
              Consultar por WhatsApp
            </a>
          </p>
        </div>
      </section>

    </div>
  );
};

export default EstudioLuminicoPage;
