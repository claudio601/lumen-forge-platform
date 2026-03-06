import { CheckCircle2 } from 'lucide-react';

const reasons = [
  'Stock permanente con despacho inmediato',
  'Catálogo técnico completo con especificaciones',
  'Precios mayoristas para empresas e instaladores',
  'Asesoría técnica especializada en iluminación',
  'Cobertura de despacho a todo Chile',
  'Garantía directa en todos los productos',
];

const WhyElights = () => (
  <section className="container py-12">
    <h2 className="text-2xl font-bold mb-2 text-center">¿Por qué elegir eLIGHTS?</h2>
    <p className="text-muted-foreground text-center mb-8">Tu partner de iluminación LED profesional en Chile</p>
    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-3xl mx-auto">
      {reasons.map(r => (
        <div key={r} className="flex items-start gap-3 p-4 rounded-lg bg-surface">
          <CheckCircle2 className="h-5 w-5 text-primary mt-0.5 shrink-0" />
          <span className="text-sm font-medium">{r}</span>
        </div>
      ))}
    </div>
  </section>
);

export default WhyElights;
