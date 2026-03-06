import { Link } from 'react-router-dom';
import { ShoppingCart, FileText, ArrowRight } from 'lucide-react';

const DualPathCards = () => (
  <section className="container py-12">
    <div className="grid md:grid-cols-2 gap-6">
      <Link to="/catalogo" className="group border-2 border-border hover:border-primary/40 rounded-xl p-8 transition-all hover:shadow-product-hover">
        <div className="h-12 w-12 rounded-xl gradient-primary flex items-center justify-center mb-4">
          <ShoppingCart className="h-6 w-6 text-primary-foreground" />
        </div>
        <h3 className="text-xl font-bold mb-2">Compra directa</h3>
        <p className="text-muted-foreground text-sm mb-4">
          Explora nuestro catálogo, agrega productos al carro y compra con despacho a todo Chile.
        </p>
        <span className="inline-flex items-center gap-1 text-sm font-semibold text-primary group-hover:gap-2 transition-all">
          Ver productos <ArrowRight className="h-4 w-4" />
        </span>
      </Link>
      <Link to="/cotizador" className="group border-2 border-border hover:border-primary/40 rounded-xl p-8 transition-all hover:shadow-product-hover">
        <div className="h-12 w-12 rounded-xl bg-accent flex items-center justify-center mb-4 border border-primary/20">
          <FileText className="h-6 w-6 text-primary" />
        </div>
        <h3 className="text-xl font-bold mb-2">Cotización para empresas / proyectos</h3>
        <p className="text-muted-foreground text-sm mb-4">
          Solicita cotización personalizada con precios especiales para empresas, proyectos y volúmenes.
        </p>
        <span className="inline-flex items-center gap-1 text-sm font-semibold text-primary group-hover:gap-2 transition-all">
          Cotizar ahora <ArrowRight className="h-4 w-4" />
        </span>
      </Link>
    </div>
  </section>
);

export default DualPathCards;
