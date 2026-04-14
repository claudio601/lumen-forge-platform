import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ArrowRight, Zap } from 'lucide-react';

const features = [
  { emoji: '💡', text: 'Modelación en DIALux' },
  { emoji: '📋', text: 'Verificación normativa' },
  { emoji: '🔦', text: 'Propuesta de luminarias eLIGHTS' },
  { emoji: '📄', text: 'Informe PDF completo' },
];

const EstudioLuminicoTeaser = () => (
  <section className="container py-12">
    <div
      className="border-2 rounded-2xl p-8 md:p-12 relative overflow-hidden"
      style={{ borderColor: 'rgba(6,182,212,0.25)', background: 'rgba(6,182,212,0.04)' }}
    >
      {/* Decorative glow */}
      <div
        className="absolute top-0 right-0 w-64 h-64 rounded-full -translate-y-1/2 translate-x-1/2 pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(6,182,212,0.15) 0%, transparent 70%)' }}
      />
      <div className="relative flex flex-col md:flex-row gap-8 items-start">
        <div className="flex-1">
          <div
            className="inline-flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-full mb-4"
            style={{ background: 'rgba(6,182,212,0.12)', color: '#06B6D4' }}
          >
            <Zap className="h-3.5 w-3.5" /> Servicio Profesional
          </div>
          <h2 className="text-2xl font-bold mb-3" style={{ color: '#0891B2' }}>
            Estudio Lumínico DIALux
          </h2>
          <p className="text-muted-foreground mb-6">
            Simulación profesional de iluminación para estadios, bodegas, estacionamientos
            e industria. Informe técnico con verificación normativa. Entrega en 48 horas
            desde la recepción de todos los antecedentes.
          </p>
          <div className="grid grid-cols-2 gap-3 mb-6">
            {features.map(({ emoji, text }) => (
              <div key={text} className="flex items-center gap-2 text-sm">
                <span className="text-base leading-none">{emoji}</span>
                <span>{text}</span>
              </div>
            ))}
          </div>
          <Button
            asChild
            className="gap-2"
            style={{ background: 'linear-gradient(135deg, #06B6D4 0%, #0891B2 100%)', color: '#fff' }}
          >
            <Link to="/estudio-luminico">
              Conocer servicio <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>
    </div>
  </section>
);

export default EstudioLuminicoTeaser;
