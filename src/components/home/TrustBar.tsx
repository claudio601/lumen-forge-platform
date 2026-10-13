import { Clock, Shield, Phone, Zap } from 'lucide-react';

// Sin umbral de despacho sin costo ni certificaciones generales hasta que el dueño confirme
// la cifra y el alcance (PR 11). La garantía de cada producto está en su ficha; la legal es
// de 6 meses. src/config/contentTruth.test.ts vigila las frases retiradas.
const benefits = [
  { icon: Clock, text: 'Despacho en hasta 2 días hábiles' },
  { icon: Shield, text: 'Garantía según ficha (mín. 6 meses)' },
  { icon: Phone, text: 'Asesoría técnica por WhatsApp' },
  { icon: Zap, text: 'Despacho desde Santiago' },
];

const TrustBar = () => (
  <div className="bg-surface border-y py-3">
    <div className="container">
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 md:grid-cols-4">
        {benefits.map(({ icon: Icon, text }) => (
                    <div key={text} className="flex min-w-0 items-center gap-2 text-sm leading-tight text-muted-foreground">
            <Icon className="h-4 w-4 text-primary shrink-0" />
            <span>{text}</span>
          </div>
        ))}
      </div>
    </div>
  </div>
);

export default TrustBar;
