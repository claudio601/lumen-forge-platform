import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';

const NotFound = () => {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted">
    <Helmet>
      <title>Página no encontrada | eLIGHTS Chile</title>
      <meta name="description" content="Esta página no existe. Vuelve al inicio para explorar el catálogo de iluminación LED profesional." />
    </Helmet>

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
