import { Zap, Shield, Truck, Phone, Award, Clock, Users, Lightbulb, Star } from 'lucide-react';
import { trustClaims } from '@/config/business';

// Items que provienen de business.ts (fuente única de verdad)
const reasonsFromConfig = [
  { icon: Zap,       ...trustClaims.stock },
  { icon: Shield,    ...trustClaims.warranty },
  { icon: Truck,     ...trustClaims.dispatchChile },
  { icon: Award,     ...trustClaims.certifications },
  { icon: Clock,     ...trustClaims.dispatch },
  { icon: Star,      ...trustClaims.experience },
] as const;

// Items complementarios (no comerciales, no requieren centralización)
const reasonsLocal = [
  { icon: Phone,     title: 'Soporte técnico',    desc: 'Asesoría en selección, instalación y post-venta incluida.' },
  { icon: Users,     title: 'Precios B2B',         desc: 'Tarifas especiales para empresas, instaladores y proyectos.' },
  { icon: Lightbulb, title: 'Asesoría de proyectos', desc: 'Te ayudamos a elegir la solución correcta para tu proyecto.' },
];

const reasons = [...reasonsFromConfig, ...reasonsLocal];

const WhyElights = () => (
  <section className="py-16 bg-surface">
    <div className="container">
      <div className="text-center mb-10">
        <h2 className="text-2xl font-bold mb-2">¿Por qué elegir eLIGHTS?</h2>
        <p className="text-muted-foreground">Tu proveedor confiable de iluminación LED profesional en Chile</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {reasons.map(({ icon: Icon, title, desc }) => (
          <div key={title} className="bg-background rounded-xl p-5 border hover:border-primary/30 transition-colors">
            <div className="flex items-center gap-3 mb-2">
              <div className="gradient-primary rounded-lg p-2">
                <Icon className="h-4 w-4 text-primary-foreground" />
              </div>
              <h3 className="font-semibold text-sm">{title}</h3>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
          </div>
        ))}
      </div>
    </div>
  </section>
);

export default WhyElights;
