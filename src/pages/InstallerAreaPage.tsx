import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Wrench, Shield, BarChart3, Download, Heart, HeadphonesIcon, ArrowRight, User, FileText, Package, Star } from 'lucide-react';

const features = [
  { icon: Shield, title: 'Precios especiales', desc: 'Descuentos exclusivos para instaladores registrados y verificados.' },
  { icon: FileText, title: 'Historial de cotizaciones', desc: 'Accede a todas tus solicitudes de cotización y su estado actual.' },
  { icon: Package, title: 'Pedidos anteriores', desc: 'Revisa tu historial de compras y reordena con un clic.' },
  { icon: Heart, title: 'Favoritos y listas', desc: 'Guarda productos frecuentes en listas para acceso rápido.' },
  { icon: Download, title: 'Material técnico', desc: 'Descarga fichas técnicas, certificados y manuales de instalación.' },
  { icon: HeadphonesIcon, title: 'Soporte comercial', desc: 'Ejecutivo de cuenta dedicado para tus proyectos.' },
];

const tiers = [
  { name: 'Standard', color: 'border-border', desc: 'Registro básico con acceso a catálogo técnico', benefits: ['Acceso al catálogo completo', 'Cotizaciones online', 'Soporte por email'] },
  { name: 'Silver', color: 'border-muted-foreground', desc: 'Para instaladores con volumen regular', benefits: ['5% descuento base', 'Prioridad en stock', 'Ejecutivo asignado', 'Material técnico premium'] },
  { name: 'Gold', color: 'border-warning', desc: 'Instaladores con alto volumen y proyectos recurrentes', benefits: ['10% descuento base', 'Stock reservado', 'Soporte prioritario', 'Capacitaciones', 'Crédito 30 días'] },
];

const InstallerAreaPage = () => (
  <div className="container py-8">
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="text-center mb-12">
        <div className="inline-flex items-center gap-2 bg-accent text-accent-foreground text-xs font-semibold px-3 py-1.5 rounded-full mb-4">
          <Wrench className="h-3.5 w-3.5" /> Programa Profesional
        </div>
        <h1 className="text-2xl md:text-4xl font-bold mb-3">Área Instaladores y Profesionales</h1>
        <p className="text-muted-foreground max-w-lg mx-auto">
          Únete a nuestra red de profesionales y accede a beneficios exclusivos, precios especiales y herramientas para gestionar tus proyectos.
        </p>
      </div>

      {/* Features */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-12">
        {features.map(({ icon: Icon, title, desc }) => (
          <div key={title} className="border rounded-xl p-5 hover:shadow-product transition-all">
            <Icon className="h-8 w-8 text-primary mb-3" />
            <h3 className="font-semibold mb-1">{title}</h3>
            <p className="text-sm text-muted-foreground">{desc}</p>
          </div>
        ))}
      </div>

      {/* Tiers */}
      <h2 className="text-xl font-bold mb-4 text-center">Niveles del programa</h2>
      <div className="grid md:grid-cols-3 gap-4 mb-12">
        {tiers.map(tier => (
          <div key={tier.name} className={`border-2 ${tier.color} rounded-xl p-6`}>
            <div className="flex items-center gap-2 mb-2">
              <Star className="h-5 w-5 text-primary" />
              <h3 className="font-bold text-lg">{tier.name}</h3>
            </div>
            <p className="text-sm text-muted-foreground mb-4">{tier.desc}</p>
            <ul className="space-y-2">
              {tier.benefits.map(b => (
                <li key={b} className="flex items-center gap-2 text-sm">
                  <span className="h-1.5 w-1.5 bg-primary rounded-full shrink-0" />
                  {b}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* CTA */}
      <div className="border-2 border-primary/20 rounded-2xl p-8 text-center">
        <User className="h-12 w-12 text-primary mx-auto mb-4" />
        <h2 className="text-xl font-bold mb-2">Registrarse como instalador</h2>
        <p className="text-muted-foreground text-sm mb-6 max-w-md mx-auto">
          Crea tu cuenta profesional y comienza a disfrutar de beneficios exclusivos. La verificación demora 24-48 horas hábiles.
        </p>
        <Button size="lg" className="gradient-primary text-primary-foreground gap-2 h-12" disabled>
          <ArrowRight className="h-4 w-4" /> Crear cuenta profesional (próximamente)
        </Button>
      </div>
    </div>
  </div>
);

export default InstallerAreaPage;
