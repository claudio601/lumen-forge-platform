import { Link } from 'react-router-dom';
import { Building2, Factory, Store, HardHat, ArrowRight } from 'lucide-react';

const solutions = [
  { icon: Building2, title: 'Oficinas y corporativos', desc: 'Paneles, tubos y downlights para espacios de trabajo eficientes.' },
  { icon: Factory, title: 'Industrial y logístico', desc: 'Campanas de alta potencia y luminarias para plantas y bodegas.' },
  { icon: Store, title: 'Retail y comercio', desc: 'Focos a riel, dicroicas y soluciones de acento para exhibición.' },
  { icon: HardHat, title: 'Proyectos y constructoras', desc: 'Cotización integral de iluminación con soporte técnico.' },
];

const SolutionsSection = () => (
  <section className="gradient-surface py-12">
    <div className="container">
      <h2 className="text-2xl font-bold mb-2">Soluciones para empresas</h2>
      <p className="text-muted-foreground mb-8">Iluminación profesional para cada tipo de proyecto</p>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {solutions.map(({ icon: Icon, title, desc }) => (
          <div key={title} className="bg-card border rounded-xl p-6 hover:shadow-product transition-all">
            <Icon className="h-8 w-8 text-primary mb-3" />
            <h3 className="font-semibold mb-1">{title}</h3>
            <p className="text-sm text-muted-foreground">{desc}</p>
          </div>
        ))}
      </div>
      <div className="text-center mt-8">
        <Link to="/cotizador" className="inline-flex items-center gap-2 text-sm font-semibold text-primary hover:gap-3 transition-all">
          Solicitar propuesta técnica <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </div>
  </section>
);

export default SolutionsSection;
