import { MessageCircle, X } from 'lucide-react';
import { useState } from 'react';
import { waBase, whatsappDisplayNumber } from '@/config/business';

const WhatsAppButton = () => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-2">
      {expanded && (
        <div className="bg-background border rounded-xl shadow-lg p-4 w-64 animate-fade-in">
          <div className="flex items-center justify-between mb-2">
            <span className="font-semibold text-sm">Escribenos por WhatsApp</span>
            <button onClick={() => setExpanded(false)}><X className="h-4 w-4" /></button>
          </div>
          <p className="text-xs text-muted-foreground mb-3">Lunes a viernes 9:00-18:00 hrs.</p>
          <a
            href={waBase}
            target="_blank"
            rel="noopener noreferrer"
            className="block w-full text-center text-white text-sm font-semibold py-2 rounded-lg"
            style={{ backgroundColor: '#25D366' }}
          >
            Iniciar chat
          </a>
        </div>
      )}
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-white rounded-full shadow-lg flex items-center gap-2 px-4 py-3"
        style={{ backgroundColor: '#25D366' }}
        aria-label={`Contactar por WhatsApp ${whatsappDisplayNumber}`}
      >
        <MessageCircle className="h-5 w-5" />
        <span className="text-sm font-semibold">WhatsApp</span>
      </button>
    </div>
  );
};

export default WhatsAppButton;
