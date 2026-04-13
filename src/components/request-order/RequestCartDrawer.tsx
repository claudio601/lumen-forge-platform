// src/components/request-order/RequestCartDrawer.tsx
// Badge + resumen del Request Cart para el Header.

import { Link } from 'react-router-dom';
import { ClipboardList } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useRequestCart } from '@/context/RequestCartContext';
import { sendEvent } from '@/lib/analytics';

const RequestCartDrawer = () => {
  const { itemCount, subtotal } = useRequestCart();

  if (itemCount === 0) return null;

  const fmt = (n: number) =>
    new Intl.NumberFormat('es-CL', {
      style: 'currency',
      currency: 'CLP',
      minimumFractionDigits: 0,
    }).format(n);

  return (
    <Link
      to="/solicitar-pedido"
      onClick={() => sendEvent('request_cart_view', { itemCount, subtotal })}
    >
      <Button
        variant="outline"
        size="sm"
        className="gap-2 border-primary/40 text-primary hover:bg-accent relative h-9"
      >
        <ClipboardList className="h-4 w-4" />
        <span className="hidden sm:inline text-xs font-medium">
          Solicitud ({itemCount}) · {fmt(subtotal)}
        </span>
        <span className="sm:hidden text-xs font-bold">{itemCount}</span>
        <span className="absolute -top-1.5 -right-1.5 bg-primary text-primary-foreground text-[9px] font-bold rounded-full h-4 w-4 flex items-center justify-center sm:hidden">
          {itemCount}
        </span>
      </Button>
    </Link>
  );
};

export default RequestCartDrawer;
