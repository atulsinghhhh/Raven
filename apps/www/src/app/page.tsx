import { AnnouncementBar } from '../components/AnnouncementBar';
import { CodeShowcase } from '../components/CodeShowcase';
import { DashboardPreview } from '../components/DashboardPreview';
import { FinalCTA } from '../components/FinalCTA';
import { Footer } from '../components/Footer';
import { Hero } from '../components/Hero';
import { HowItWorks } from '../components/HowItWorks';
import { Nav } from '../components/Nav';
import { Platform } from '../components/Platform';
import { ProductShowcase } from '../components/ProductShowcase';
import { Reliability } from '../components/Reliability';
import { SDKSection } from '../components/SDKSection';
import { ScaleBand } from '../components/ScaleBand';
import { UseCases } from '../components/UseCases';

export default function LandingPage() {
  return (
    <>
      <AnnouncementBar />
      <Nav />
      <main>
        <Hero />
        <ProductShowcase />
        <CodeShowcase />
        <Platform />
        <SDKSection />
        <HowItWorks />
        <ScaleBand />
        <Reliability />
        <DashboardPreview />
        <UseCases />
        <FinalCTA />
      </main>
      <Footer />
    </>
  );
}
