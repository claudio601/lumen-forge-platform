import { Package, Truck, Headphones, BadgePercent } from 'lucide-react';

const items = [
  { icon: Package, label: 'Stock disponible', desc: 'Despacho inmediato' },
  { icon: Truck, label: 'Despacho a todo Chile', desc: 'Cobertura nacional' },
  { icon: Headphones, label: 'Asesoría técnica', desc: 'Equipo especializado' },
  { icon: BadgePercent, label: 'Precios mayoristas', desc: 'Descuentos por volumen' },
];

const TrustBar = () => (
  <section className="border-y bg-background">
    <div className="container py-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {items.map(({ icon: Icon, label, desc }) => (
          <div key={label} className="flex items-center gap-3">
            <div className="flex-shrink-0 h-10 w-10 rounded-lg bg-accent flex items-center justify-center">
              <Icon className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold">{label}</p>
              <p className="text-xs text-muted-foreground">{desc}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  </section>
);

export default TrustBar;
