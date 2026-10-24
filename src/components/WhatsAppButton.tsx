import { MessageCircle, X } from 'lucide-react';
import { useState } from 'react';
import { waBase, whatsappDisplayNumber, businessHours } from '@/config/business';
import { useWhatsAppButtonHidden } from '@/hooks/useHideWhatsAppButton';

const WhatsAppButton = () => {
  const [expanded, setExpanded] = useState(false);
  // No se ofrece en las confirmaciones de las solicitudes (dueño, 2026-10-17; auditoría UX F-03)
  const hidden = useWhatsAppButtonHidden();
  if (hidden) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-2">
      {expanded && (
        <div className="bg-background border rounded-xl shadow-lg p-4 w-64 animate-fade-in">
          <div className="flex items-center justify-between mb-2">
            <span className="font-semibold text-sm">Escríbenos por WhatsApp</span>
            <button onClick={() => setExpanded(false)}><X className="h-4 w-4" /></button>
          </div>
          {/* Ahí atiende un asistente automático que toma la solicitud; el equipo responde por correo (dueño, 2026-10-24) */}
          <p className="text-xs text-muted-foreground mb-2">Un asistente automático toma tu solicitud y te enviamos la cotización por correo.</p>
          <p className="text-xs text-muted-foreground mb-3">{businessHours}</p>
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
