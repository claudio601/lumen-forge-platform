import { Zap } from 'lucide-react';

const TopInfoBar = () => (
  <div className="gradient-primary text-primary-foreground py-2 px-4 text-center text-sm font-medium">
    <div className="container flex items-center justify-center gap-2">
      <Zap className="h-3.5 w-3.5" />
      <span>Atención empresas, instaladores y proyectos — Cotización rápida y despacho a todo Chile</span>
      <Zap className="h-3.5 w-3.5" />
    </div>
  </div>
);

export default TopInfoBar;
