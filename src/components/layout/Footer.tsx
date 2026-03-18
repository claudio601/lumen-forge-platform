import { Link } from 'react-router-dom';
import { Mail, Phone, MessageCircle } from 'lucide-react';
import { categories } from '@/data/products';
import Logo from '@/components/Logo';

const Footer = () => {
  const topCats = [...categories].sort((a, b) => b.productCount - a.productCount).slice(0, 6);

  return (
    <footer className="gradient-dark text-muted mt-16">
      <div className="container py-12">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          <div>
            <div className="mb-4">
              <Logo />
            </div>
            <p className="text-sm text-background/60 leading-relaxed mb-4">
              Iluminacion LED profesional para proyectos, empresas y hogar. Stock permanente y despacho a todo Chile.
            </p>
            <a href="https://wa.me/56991273128" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-xs font-semibold rounded-full px-3 py-1.5 transition-colors" style={{backgroundColor:'rgba(37,211,102,0.1)',color:'#25D366',border:'1px solid rgba(37,211,102,0.2)'}}>
              <MessageCircle className="h-3.5 w-3.5" />
              WhatsApp directo
            </a>
          </div>
          <div>
            <h4 className="font-semibold text-background mb-3 text-sm uppercase tracking-wider">Catalogo</h4>
            <nav className="space-y-1.5">
              {topCats.map(cat => (
                <Link key={cat.id} to={`/catalogo/${cat.slug}`} className="flex items-center justify-between text-sm text-background/60 hover:text-primary transition-colors">
                  <span>{cat.name}</span>
                  <span className="text-[10px] text-background/30">{cat.productCount}</span>
                </Link>
              ))}
              <Link to="/catalogo" className="block text-sm text-primary hover:underline mt-2">Ver todas las categorias</Link>
            </nav>
          </div>
          <div>
            <h4 className="font-semibold text-background mb-3 text-sm uppercase tracking-wider">Empresa</h4>
            <nav className="space-y-1.5">
              {[
                { label: 'Solicitar cotizacion', to: '/cotizacion' },
                { label: 'Area Instaladores', to: '/instaladores' },
                { label: 'Cotizador inteligente', to: '/cotizador' },
                { label: 'Terminos y condiciones', to: '/' },
                { label: 'Politica de privacidad', to: '/' },
              ].map(({ label, to }) => (
                <Link key={label} to={to} className="block text-sm text-background/60 hover:text-primary transition-colors">{label}</Link>
              ))}
            </nav>
          </div>
          <div>
            <h4 className="font-semibold text-background mb-3 text-sm uppercase tracking-wider">Contacto</h4>
            <div className="space-y-3">
              <a href="mailto:ventas@elights.cl" className="flex items-center gap-2 text-sm text-background/60 hover:text-primary transition-colors">
                <Mail className="h-4 w-4 shrink-0" />
                ventas@elights.cl
              </a>
              <a href="tel:+56991273128" className="flex items-center gap-2 text-sm text-background/60 hover:text-primary transition-colors">
                <Phone className="h-4 w-4 shrink-0" />
                +56 9 9127 3128
              </a>
              <a href="https://wa.me/56991273128" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-background/60 transition-colors" style={{color:'rgba(255,255,255,0.6)'}}>
                <MessageCircle className="h-4 w-4 shrink-0" />
                WhatsApp
              </a>
            </div>
            <div className="mt-5 p-3 bg-background/5 rounded-lg border border-background/10">
              <p className="text-xs text-background/50 leading-relaxed">Lunes a viernes 9:00-18:00 hrs.<br />Santiago, Chile</p>
            </div>
          </div>
        </div>
        <div className="border-t border-background/10 mt-8 pt-6 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-background/40">
          <span>© {new Date().getFullYear()} eLIGHTS - Todos los derechos reservados</span>
          <span>Iluminacion al alcance de tus proyectos.</span>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
