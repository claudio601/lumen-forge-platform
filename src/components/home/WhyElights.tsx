import { Zap, Shield, Truck, Mail, Award, Clock, Users, Lightbulb } from 'lucide-react';
import { trustClaims } from '@/config/business';

// Items que provienen de business.ts (fuente única de verdad)
const reasonsFromConfig = [
  { icon: Zap,       ...trustClaims.stock },
  { icon: Shield,    ...trustClaims.warranty },
  { icon: Truck,     ...trustClaims.dispatchChile },
  { icon: Award,     ...trustClaims.certifications },
  { icon: Clock,     ...trustClaims.dispatch },
] as const;

// Items complementarios (no comerciales, no requieren centralización)
const reasonsLocal = [
  { icon: Mail,      title: 'Soporte técnico',    desc: 'Asesoría por correo para elegir el producto correcto.' },
  { icon: Users,     title: 'Precios para empresas', desc: 'Ve los precios netos (sin IVA) y pide una cotización formal con factura.' },
  { icon: Lightbulb, title: 'Estudio lumínico DIALux', desc: 'Simulamos tu recinto con las luminarias propuestas y te enviamos el informe en PDF.' },
];

const reasons = [...reasonsFromConfig, ...reasonsLocal];

const WhyElights = () => (
  <section className="py-16 bg-surface">
    <div className="container">
      <div className="text-center mb-10">
        <h2 className="text-2xl font-bold mb-2">¿Por qué elegir eLIGHTS?</h2>
        <p className="text-muted-foreground">Tu proveedor confiable de iluminación LED profesional en Chile</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
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
