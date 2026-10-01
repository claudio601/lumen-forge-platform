import { Link } from 'react-router-dom';
import Seo from '@/components/Seo';

const NotFound = () => {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted">
    <Seo title="Página no encontrada | eLIGHTS Chile" description="Esta página no existe. Vuelve al inicio para explorar el catálogo de iluminación LED profesional." noindex />

      <div className="text-center">
        <h1 className="mb-4 text-4xl font-bold">404</h1>
        <p className="mb-4 text-xl text-muted-foreground">Página no encontrada</p>
        <Link to="/" className="text-primary underline hover:text-primary/90">
          Volver al inicio
        </Link>
      </div>
    </div>
  );
};

export default NotFound;
