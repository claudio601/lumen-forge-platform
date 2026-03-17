import { Truck, Clock, Shield, Phone, Award, Zap } from 'lucide-react';

const benefits = [
  { icon: Truck, text: 'Envío gratis Santiago +$250k' },
  { icon: Clock, text: 'Despacho 48–72 hrs hábiles' },
  { icon: Shield, text: 'Garantía de fábrica' },
  { icon: Phone, text: 'Soporte técnico incluido' },
  { icon: Award, text: 'Productos certificados CE/IEC' },
  { icon: Zap, text: 'Stock permanente Chile' },
];

const TrustBar = () => (
  <div className="bg-surface border-y py-3">
    <div className="container">
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3 md:grid-cols-6">
        {benefits.map(({ icon: Icon, text }) => (
                    <div key={text} className="flex items-center gap-2 text-sm text-muted-foreground">
            <Icon className="h-4 w-4 text-primary shrink-0" />
            <span className="whitespace-nowrap">{text}</span>
          </div>
        ))}
      </div>
    </div>
  </div>
);

export default TrustBar;
