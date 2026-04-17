// src/components/request-order/RequestOrderButton.tsx
// Boton "Solicitar pedido" que agrega un producto al Request Cart.
// Reemplaza el boton "Comprar" en tarjetas y PDP.

import { useState } from 'react';
import { ClipboardList, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useRequestCart } from '@/context/RequestCartContext';
import type { RequestCartItem } from '@/types/request-order';
import type { ButtonProps } from '@/components/ui/button';

interface RequestOrderButtonProps extends Omit<ButtonProps, 'onClick'> {
  item: Omit<RequestCartItem, 'quantity'>;
  quantity?: number;
  /** Variante visual: 'card' (compacto) | 'pdp' (grande) */
  variant?: 'card' | 'pdp';
}

const RequestOrderButton = ({
  item,
  quantity = 1,
  variant = 'card',
  className,
  ...rest
}: RequestOrderButtonProps) => {
  const { addItem } = useRequestCart();
  const [added, setAdded] = useState(false);

  const handleClick = () => {
    addItem({ ...item, quantity });
    setAdded(true);
    toast.success('Agregado a tu solicitud', {
      description: item.name,
      action: {
        label: 'Ver solicitud',
        onClick: () => (window.location.href = '/solicitar-pedido'),
      },
    });
    setTimeout(() => setAdded(false), 2000);
  };

  if (variant === 'pdp') {
    return (
      <Button
        size="lg"
        className={['flex-1 gap-2 h-12 bg-primary hover:bg-primary/90 text-primary-foreground', className].filter(Boolean).join(' ')}
        onClick={handleClick}
        {...rest}
      >
        {added ? (
          <>
            <CheckCircle2 className="h-4 w-4" />
            Agregado
          </>
        ) : (
          <>
            <ClipboardList className="h-4 w-4" />
            Solicitar pedido
          </>
        )}
      </Button>
    );
  }

  return (
    <Button
      size="sm"
      className={['flex-1 gap-1 text-xs h-8 bg-primary hover:bg-primary/90 text-primary-foreground', className].filter(Boolean).join(' ')}
      onClick={handleClick}
      {...rest}
    >
      {added ? (
        <>
          <CheckCircle2 className="h-3.5 w-3.5" />
          Agregado
        </>
      ) : (
        <>
          <ClipboardList className="h-3.5 w-3.5" />
          Solicitar
        </>
      )}
    </Button>
  );
};

export default RequestOrderButton;
