export interface Product {
  id: string;
  sku: string;
  name: string;
  shortName: string;
  category: string;
  subcategory: string;
  price: number;
  stock: number;
  watts: number;
  lumens: number;
  kelvin: number;
  cri?: number;
  voltage: string;
  ip?: string;
  beamAngle?: number;
  lifetime?: number;
  warranty: string;
  installationType?: string;
  tags: string[];
  image?: string;
  applications: string[];
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  icon: string;
  subcategories: { name: string; slug: string }[];
  productCount: number;
}

export interface QuoteItem {
  product: Product;
  quantity: number;
}

export interface CartItem {
  product: Product;
  quantity: number;
}

export interface QuoteRequest {
  items: QuoteItem[];
  contact: {
    nombre: string;
    email: string;
    telefono: string;
    rutEmpresa: string;
    razonSocial: string;
    giro: string;
    direccion: string;
    comentarios?: string;
  };
  source: 'quote_cart' | 'smart_quote' | 'product_page';
  status: 'pending' | 'sent' | 'responded' | 'closed';
  createdAt: string;
}

export interface ProjectQuoteRequest {
  tipoProyecto: string;
  m2: number;
  altura: number;
  aplicacion: string;
  nivelIluminacion: string;
  ciudad: string;
  plazo: string;
  comentarios?: string;
  contact: QuoteRequest['contact'];
  source: 'smart_quote';
  status: string;
  createdAt: string;
}

export interface InstallerProfile {
  userId: string;
  businessName: string;
  rut: string;
  specialty: string;
  region: string;
  verified: boolean;
  tier: 'standard' | 'silver' | 'gold';
}

export const categories: Category[] = [
  {
    id: 'ampolletas',
    name: 'Ampolletas LED',
    slug: 'ampolletas-led',
    icon: 'Lightbulb',
    subcategories: [
      { name: 'A60', slug: 'a60' },
      { name: 'Filamento', slug: 'filamento' },
      { name: 'E27', slug: 'e27' },
      { name: 'GU10', slug: 'gu10' },
      { name: 'Dicroicas', slug: 'dicroicas' },
    ],
    productCount: 48,
  },
  {
    id: 'tubos',
    name: 'Tubos LED',
    slug: 'tubos-led',
    icon: 'Cylinder',
    subcategories: [
      { name: 'T5', slug: 't5' },
      { name: 'T8', slug: 't8' },
      { name: 'Integrados', slug: 'integrados' },
      { name: 'Industriales', slug: 'industriales' },
    ],
    productCount: 32,
  },
  {
    id: 'paneles',
    name: 'Paneles LED',
    slug: 'paneles-led',
    icon: 'Square',
    subcategories: [
      { name: '60x60', slug: '60x60' },
      { name: '30x120', slug: '30x120' },
      { name: 'Embutidos', slug: 'embutidos' },
      { name: 'Sobrepuestos', slug: 'sobrepuestos' },
      { name: 'Backlit', slug: 'backlit' },
    ],
    productCount: 36,
  },
  {
    id: 'focos-riel',
    name: 'Focos a Riel',
    slug: 'focos-riel',
    icon: 'Focus',
    subcategories: [
      { name: 'Monofásicos', slug: 'monofasicos' },
      { name: 'Trifásicos', slug: 'trifasicos' },
      { name: 'Comerciales', slug: 'comerciales' },
    ],
    productCount: 18,
  },
  {
    id: 'campanas',
    name: 'Campanas Industriales',
    slug: 'campanas-industriales',
    icon: 'Factory',
    subcategories: [
      { name: 'UFO', slug: 'ufo' },
      { name: 'Lineales', slug: 'lineales' },
      { name: 'Alta Potencia', slug: 'alta-potencia' },
    ],
    productCount: 24,
  },
  {
    id: 'proyectores',
    name: 'Proyectores LED',
    slug: 'proyectores-led',
    icon: 'SunDim',
    subcategories: [
      { name: 'Exteriores', slug: 'exteriores' },
      { name: 'Estadios', slug: 'estadios' },
      { name: 'Áreas Comunes', slug: 'areas-comunes' },
    ],
    productCount: 20,
  },
  {
    id: 'alumbrado',
    name: 'Alumbrado Público',
    slug: 'alumbrado-publico',
    icon: 'Lamp',
    subcategories: [
      { name: 'Vial', slug: 'vial' },
      { name: 'Peatonal', slug: 'peatonal' },
      { name: 'Solar', slug: 'solar' },
    ],
    productCount: 15,
  },
  {
    id: 'accesorios',
    name: 'Accesorios',
    slug: 'accesorios',
    icon: 'Settings',
    subcategories: [
      { name: 'Drivers', slug: 'drivers' },
      { name: 'Rieles', slug: 'rieles' },
      { name: 'Conectores', slug: 'conectores' },
      { name: 'Sensores', slug: 'sensores' },
    ],
    productCount: 42,
  },
];

export const products: Product[] = [
  {
    id: '1',
    sku: 'EL-A60-10W-4K',
    name: 'Ampolleta LED A60 10W 4000K E27',
    shortName: 'Ampolleta A60 10W',
    category: 'ampolletas',
    subcategory: 'a60',
    price: 1990,
    stock: 350,
    watts: 10,
    lumens: 900,
    kelvin: 4000,
    cri: 80,
    voltage: '220V AC',
    beamAngle: 200,
    lifetime: 25000,
    warranty: '2 años',
    installationType: 'Rosca E27',
    tags: ['oficina', 'hogar', 'comercial'],
    applications: ['Oficinas', 'Hogares', 'Comercio', 'Pasillos'],
  },
  {
    id: '2',
    sku: 'EL-T8-18W-65K',
    name: 'Tubo LED T8 18W 6500K 120cm',
    shortName: 'Tubo T8 18W',
    category: 'tubos',
    subcategory: 't8',
    price: 3490,
    stock: 520,
    watts: 18,
    lumens: 1800,
    kelvin: 6500,
    cri: 80,
    voltage: '220V AC',
    beamAngle: 160,
    lifetime: 30000,
    warranty: '2 años',
    installationType: 'G13',
    tags: ['oficina', 'industrial', 'bodega'],
    applications: ['Oficinas', 'Bodegas', 'Estacionamientos', 'Industrias'],
  },
  {
    id: '3',
    sku: 'EL-PAN-60-48W-4K',
    name: 'Panel LED 60x60 48W 4000K Backlit',
    shortName: 'Panel 60x60 48W',
    category: 'paneles',
    subcategory: '60x60',
    price: 24990,
    stock: 180,
    watts: 48,
    lumens: 4800,
    kelvin: 4000,
    cri: 85,
    voltage: '220V AC',
    ip: 'IP20',
    lifetime: 50000,
    warranty: '3 años',
    installationType: 'Embutido cielo americano',
    tags: ['oficina', 'comercial', 'salud'],
    applications: ['Oficinas', 'Clínicas', 'Retail', 'Educación'],
  },
  {
    id: '4',
    sku: 'EL-PROY-100W-IP65',
    name: 'Proyector LED 100W IP65 6500K',
    shortName: 'Proyector 100W IP65',
    category: 'proyectores',
    subcategory: 'exteriores',
    price: 39990,
    stock: 95,
    watts: 100,
    lumens: 12000,
    kelvin: 6500,
    cri: 70,
    voltage: '220V AC',
    ip: 'IP65',
    beamAngle: 120,
    lifetime: 50000,
    warranty: '3 años',
    installationType: 'Bracket ajustable',
    tags: ['exterior', 'seguridad', 'industrial'],
    applications: ['Fachadas', 'Estacionamientos', 'Canchas', 'Seguridad'],
  },
  {
    id: '5',
    sku: 'EL-CAMP-150W-UFO',
    name: 'Campana LED Industrial UFO 150W 5000K',
    shortName: 'Campana UFO 150W',
    category: 'campanas',
    subcategory: 'ufo',
    price: 89990,
    stock: 45,
    watts: 150,
    lumens: 21000,
    kelvin: 5000,
    cri: 80,
    voltage: '220V AC',
    ip: 'IP65',
    beamAngle: 90,
    lifetime: 50000,
    warranty: '5 años',
    installationType: 'Gancho / Cadena',
    tags: ['industrial', 'bodega', 'galpón'],
    applications: ['Bodegas', 'Galpones', 'Plantas industriales', 'Centros logísticos'],
  },
  {
    id: '6',
    sku: 'EL-VIAL-150W-LED',
    name: 'Luminaria Vial LED 150W 5700K IP66',
    shortName: 'Luminaria Vial 150W',
    category: 'alumbrado',
    subcategory: 'vial',
    price: 149990,
    stock: 30,
    watts: 150,
    lumens: 19500,
    kelvin: 5700,
    cri: 70,
    voltage: '220V AC',
    ip: 'IP66',
    beamAngle: 140,
    lifetime: 50000,
    warranty: '5 años',
    installationType: 'Brazo / Poste',
    tags: ['vial', 'público', 'municipal'],
    applications: ['Calles', 'Autopistas', 'Estacionamientos', 'Parques'],
  },
  {
    id: '7',
    sku: 'EL-GU10-7W-3K',
    name: 'Dicroica LED GU10 7W 3000K',
    shortName: 'Dicroica GU10 7W',
    category: 'ampolletas',
    subcategory: 'gu10',
    price: 2490,
    stock: 600,
    watts: 7,
    lumens: 560,
    kelvin: 3000,
    cri: 90,
    voltage: '220V AC',
    beamAngle: 38,
    lifetime: 25000,
    warranty: '2 años',
    installationType: 'Base GU10',
    tags: ['retail', 'hogar', 'acento'],
    applications: ['Retail', 'Residencial', 'Hospitality', 'Exhibición'],
  },
  {
    id: '8',
    sku: 'EL-RIEL-30W-4K',
    name: 'Foco Riel Monofásico 30W 4000K',
    shortName: 'Foco Riel 30W',
    category: 'focos-riel',
    subcategory: 'monofasicos',
    price: 34990,
    stock: 72,
    watts: 30,
    lumens: 2700,
    kelvin: 4000,
    cri: 90,
    voltage: '220V AC',
    beamAngle: 24,
    lifetime: 35000,
    warranty: '3 años',
    installationType: 'Riel monofásico',
    tags: ['retail', 'exhibición', 'comercial'],
    applications: ['Tiendas', 'Galerías', 'Showrooms', 'Museos'],
  },
];

export const popularSearches = [
  'panel 60x60 48w 4000k',
  't8 18w 6500k',
  'ip65 100w proyector',
  'campana ufo 150w',
  'ampolleta e27 10w',
  'gu10 dicroica',
  'luminaria vial',
  'foco riel 30w',
];

export const formatCLP = (price: number): string => {
  return new Intl.NumberFormat('es-CL', {
    style: 'currency',
    currency: 'CLP',
    minimumFractionDigits: 0,
  }).format(price);
};
