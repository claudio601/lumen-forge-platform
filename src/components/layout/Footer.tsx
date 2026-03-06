import { Link } from 'react-router-dom';
import { Zap, Mail, Phone, MapPin } from 'lucide-react';

const Footer = () => (
  <footer className="gradient-dark text-muted mt-16">
    <div className="container py-12">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
        <div>
          <div className="flex items-center gap-1.5 mb-4">
            <div className="gradient-primary rounded-lg p-1.5">
              <Zap className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="text-lg font-bold text-background">
              e<span className="text-primary">LIGHTS</span>
            </span>
          </div>
          <p className="text-sm text-background/60 leading-relaxed">
            Iluminación LED profesional para proyectos, empresas y hogar. 
            Stock permanente y despacho a todo Chile.
          </p>
        </div>
        <div>
          <h4 className="font-semibold text-background mb-3 text-sm uppercase tracking-wider">Catálogo</h4>
          <nav className="space-y-2">
            {['Ampolletas LED', 'Tubos LED', 'Paneles LED', 'Campanas Industriales', 'Proyectores LED'].map(item => (
              <Link key={item} to="/catalogo" className="block text-sm text-background/60 hover:text-primary transition-colors">{item}</Link>
            ))}
          </nav>
        </div>
        <div>
          <h4 className="font-semibold text-background mb-3 text-sm uppercase tracking-wider">Empresa</h4>
          <nav className="space-y-2">
            {['Cotizar Proyecto', 'Área Instaladores', 'Cotizador Inteligente', 'Términos y Condiciones'].map(item => (
              <Link key={item} to="/" className="block text-sm text-background/60 hover:text-primary transition-colors">{item}</Link>
            ))}
          </nav>
        </div>
        <div>
          <h4 className="font-semibold text-background mb-3 text-sm uppercase tracking-wider">Contacto</h4>
          <div className="space-y-2.5">
            <a href="mailto:ventas@elights.cl" className="flex items-center gap-2 text-sm text-background/60 hover:text-primary transition-colors">
              <Mail className="h-4 w-4" /> ventas@elights.cl
            </a>
            <a href="tel:+56912345678" className="flex items-center gap-2 text-sm text-background/60 hover:text-primary transition-colors">
              <Phone className="h-4 w-4" /> +56 9 1234 5678
            </a>
            <span className="flex items-center gap-2 text-sm text-background/60">
              <MapPin className="h-4 w-4" /> Santiago, Chile
            </span>
          </div>
        </div>
      </div>
      <div className="border-t border-background/10 mt-8 pt-6 text-center text-xs text-background/40">
        © {new Date().getFullYear()} eLIGHTS — Todos los derechos reservados
      </div>
    </div>
  </footer>
);

export default Footer;
