import { Link } from 'react-router-dom';
import { ArrowRight, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { motion } from 'framer-motion';

const HeroSection = () => (
  <section className="relative overflow-hidden gradient-surface">
    <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, hsl(var(--foreground)) 1px, transparent 0)', backgroundSize: '32px 32px' }} />
    <div className="container py-16 md:py-24 relative">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="max-w-2xl"
      >
        <div className="inline-flex items-center gap-2 bg-accent text-accent-foreground text-xs font-semibold px-3 py-1.5 rounded-full mb-6">
          <span className="h-1.5 w-1.5 bg-primary rounded-full" />
          Catálogo técnico con stock disponible
        </div>
        <h1 className="text-3xl md:text-5xl lg:text-6xl font-bold leading-tight mb-4">
          Iluminación LED profesional para{' '}
          <span className="text-gradient-primary">proyectos, empresas y hogar</span>
        </h1>
        <p className="text-lg md:text-xl text-muted-foreground mb-8 leading-relaxed max-w-xl">
          Catálogo técnico completo, stock permanente, despacho a todo Chile y asesoría especializada para tu proyecto de iluminación.
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
          <Button asChild size="lg" className="gradient-primary text-primary-foreground gap-2 text-base px-8 h-12">
            <Link to="/catalogo">
              Explorar catálogo <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
          <Button asChild variant="outline" size="lg" className="gap-2 text-base border-primary/30 text-primary hover:bg-accent h-12">
            <Link to="/cotizador">
              <FileText className="h-4 w-4" /> Cotizar proyecto
            </Link>
          </Button>
        </div>
      </motion.div>
    </div>
  </section>
);

export default HeroSection;
