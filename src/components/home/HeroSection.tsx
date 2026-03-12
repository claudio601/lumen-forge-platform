import { Link } from 'react-router-dom';
import { ArrowRight, FileText, Zap, Shield, Truck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { motion } from 'framer-motion';

const HeroSection = () => (
  <section className="relative overflow-hidden" style={{ minHeight: '540px' }}>
    {/* Background image */}
    <div
      className="absolute inset-0 bg-cover bg-center bg-no-repeat"
      style={{ backgroundImage: 'url(/hero-banner.png)' }}
    />
    {/* Dark overlay left-heavy so text is readable */}
    <div className="absolute inset-0" style={{
      background: 'linear-gradient(90deg, rgba(5,2,20,0.92) 0%, rgba(10,5,30,0.80) 40%, rgba(10,5,30,0.30) 70%, rgba(10,5,30,0.10) 100%)'
    }} />
    {/* Subtle purple tint overlay */}
    <div className="absolute inset-0" style={{
      background: 'linear-gradient(135deg, rgba(88,28,220,0.25) 0%, transparent 60%)'
    }} />

    <div className="container relative h-full">
      <div className="flex items-center py-16 md:py-24" style={{ minHeight: '540px' }}>
        <motion.div
          initial={{ opacity: 0, x: -30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.7 }}
          className="max-w-xl z-10"
        >
          <div className="inline-flex items-center gap-2 bg-purple-500/20 border border-purple-500/30 text-purple-300 text-xs font-semibold px-3 py-1.5 rounded-full mb-6">
            <span className="h-1.5 w-1.5 bg-purple-400 rounded-full animate-pulse" />
            Catálogo técnico con stock disponible
          </div>

          <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold leading-tight mb-5 text-white">
            Iluminación LED profesional para{' '}
            <span style={{ background: 'linear-gradient(135deg, #c084fc, #a855f7, #818cf8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              proyectos, empresas y hogar
            </span>
          </h1>

          <p className="text-base md:text-lg text-gray-300 mb-8 leading-relaxed">
            Catálogo técnico completo, stock permanente, despacho a todo Chile y asesoría especializada para tu proyecto de iluminación.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 mb-10">
            <Button asChild size="lg" className="gap-2 text-base px-8 h-12 text-white font-semibold" style={{ background: 'linear-gradient(135deg, #7c3aed, #6366f1)' }}>
              <Link to="/catalogo">
                Explorar catálogo <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild size="lg" className="gap-2 text-base h-12 text-white font-semibold" style={{ background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(168,85,247,0.4)', backdropFilter: 'blur(8px)' }}>
              <Link to="/cotizador">
                <FileText className="h-4 w-4" /> Cotizar proyecto
              </Link>
            </Button>
          </div>

          <div className="flex flex-wrap gap-5">
            {[
              { icon: Truck, text: 'Envío gratis +$250k' },
              { icon: Shield, text: 'Garantía de fábrica' },
              { icon: Zap, text: 'Despacho 48-72 hrs' },
            ].map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-center gap-1.5 text-gray-300 text-sm">
                <Icon className="h-3.5 w-3.5 text-purple-400" />
                {text}
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </div>
  </section>
);

export default HeroSection;
