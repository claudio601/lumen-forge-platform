import { Link } from 'react-router-dom';
import { Clock, Shield, Phone, Truck, type LucideIcon } from 'lucide-react';
import { freeShippingShort } from '@/config/business';

// Despacho sin costo: monto y zona confirmados por el dueño el 2026-10-14 (PR 12b). El texto
// sale de business.ts (freeShippingShort) y enlaza a /despacho, donde están el IVA y las
// comunas excluidas; reemplaza "Despacho desde Santiago", así siguen siendo 4 avisos.
// Sin certificaciones generales (PR 11). La garantía de cada producto está en su ficha; la
// legal es de 6 meses. src/config/contentTruth.test.ts vigila las frases retiradas.
//
// Lista que se envuelve según el ancho de cada aviso, no grilla de columnas iguales: ese aviso
// es casi el doble de largo que los otros y en una columna de un cuarto (o de la mitad en el
// teléfono) quedaba en 4 o 5 líneas junto a avisos de 1 o 2. Así cada aviso queda en una
// línea y lo que no cabe pasa a la fila siguiente; en el teléfono es una lista de una columna
// (ahí el aviso largo usa 2 líneas). Medidas en el cuerpo de la PR 12b.
const benefits: { icon: LucideIcon; text: string; to?: string }[] = [
  { icon: Clock, text: 'Despacho en hasta 2 días hábiles' },
  { icon: Shield, text: 'Garantía según ficha (mín. 6 meses)' },
  { icon: Phone, text: 'Asesoría técnica por WhatsApp' },
  { icon: Truck, text: freeShippingShort, to: '/despacho' },
];

const TrustBar = () => (
  <div className="bg-surface border-y py-3">
    <div className="container">
      <ul className="flex flex-wrap gap-x-6 gap-y-2 md:justify-center">
        {benefits.map(({ icon: Icon, text, to }) => (
          <li key={text} className="flex min-w-0 items-center gap-2 text-sm leading-tight text-muted-foreground">
            <Icon className="h-4 w-4 text-primary shrink-0" />
            {to ? (
              <Link to={to} className="underline-offset-2 hover:text-foreground hover:underline">
                {text}
              </Link>
            ) : (
              <span>{text}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  </div>
);

export default TrustBar;
