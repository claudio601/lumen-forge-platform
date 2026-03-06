import { Link } from 'react-router-dom';
import { Wrench, ArrowRight, Shield, BarChart3, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';

const InstallerTeaser = () => (
  <section className="container py-12">
    <div className="border-2 border-primary/20 rounded-2xl p-8 md:p-12 relative overflow-hidden">
      <div className="absolute top-0 right-0 w-64 h-64 gradient-primary opacity-5 rounded-full -translate-y-1/2 translate-x-1/2" />
      <div className="relative flex flex-col md:flex-row gap-8 items-start">
        <div className="flex-1">
          <div className="inline-flex items-center gap-2 bg-accent text-accent-foreground text-xs font-semibold px-3 py-1.5 rounded-full mb-4">
            <Wrench className="h-3.5 w-3.5" /> Área Instaladores
          </div>
          <h2 className="text-2xl font-bold mb-3">Programa para profesionales e instaladores</h2>
          <p className="text-muted-foreground mb-6">
            Accede a precios especiales, historial de cotizaciones, material técnico descargable y soporte comercial dedicado.
          </p>
          <div className="grid grid-cols-2 gap-3 mb-6">
            {[
              { icon: Shield, text: 'Precios especiales' },
              { icon: BarChart3, text: 'Historial de pedidos' },
              { icon: Download, text: 'Fichas técnicas' },
              { icon: Wrench, text: 'Soporte dedicado' },
            ].map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-center gap-2 text-sm">
                <Icon className="h-4 w-4 text-primary" />
                <span>{text}</span>
              </div>
            ))}
          </div>
          <Button asChild className="gradient-primary text-primary-foreground gap-2">
            <Link to="/instaladores">
              Registrarse como instalador <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>
    </div>
  </section>
);

export default InstallerTeaser;
