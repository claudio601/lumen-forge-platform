import { MessageCircle } from 'lucide-react';

const WhatsAppButton = () => (
  <a
    href="https://wa.me/56912345678?text=Hola%2C%20necesito%20información%20sobre%20productos%20eLIGHTS"
    target="_blank"
    rel="noopener noreferrer"
    className="fixed bottom-6 right-6 z-40 bg-whatsapp text-whatsapp-foreground rounded-full p-3.5 shadow-lg hover:scale-105 transition-transform"
    title="Contactar por WhatsApp"
  >
    <MessageCircle className="h-6 w-6" />
  </a>
);

export default WhatsAppButton;
