import HeroSection from '@/components/home/HeroSection';
import TrustBar from '@/components/home/TrustBar';
import DualPathCards from '@/components/home/DualPathCards';
import CategoryGrid from '@/components/home/CategoryGrid';
import FeaturedProducts from '@/components/home/FeaturedProducts';
import SolutionsSection from '@/components/home/SolutionsSection';
import InstallerTeaser from '@/components/home/InstallerTeaser';
import EstudioLuminicoTeaser from '@/components/home/EstudioLuminicoTeaser';
import WhyElights from '@/components/home/WhyElights';
import Seo from '@/components/Seo';
import { organizationJsonLd, websiteJsonLd } from '@/lib/seo/jsonld';

const Index = () => (
  <>
    <Seo title="eLIGHTS — Iluminación LED Profesional Chile" description="Iluminación LED profesional para proyectos, empresas y hogar. Catálogo técnico, instalación profesional y estudio lumínico DIALux. Despacho a todo Chile." path="/" jsonLd={[organizationJsonLd(), websiteJsonLd()]} />
    <HeroSection />
    <TrustBar />
    <DualPathCards />
    <CategoryGrid />
    <FeaturedProducts />
    <SolutionsSection />
    <InstallerTeaser />
    <EstudioLuminicoTeaser />
    <WhyElights />
  </>
);

export default Index;
