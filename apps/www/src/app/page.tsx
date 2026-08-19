import { Architecture } from '../components/Architecture';
import { ChatSection } from '../components/ChatSection';
import { CodeShowcase } from '../components/CodeShowcase';
import { DashboardPreview } from '../components/DashboardPreview';
import { EffectsSection } from '../components/EffectsSection';
import { FinalCTA } from '../components/FinalCTA';
import { Footer } from '../components/Footer';
import { Hero } from '../components/Hero';
import { HowItWorks } from '../components/HowItWorks';
import { LiveStreamingSection } from '../components/LiveStreamingSection';
import { Nav } from '../components/Nav';
import { ProductOverview } from '../components/ProductOverview';
import { RTCSection } from '../components/RTCSection';
import { Reliability } from '../components/Reliability';
import { SDKSection } from '../components/SDKSection';
import { UseCases } from '../components/UseCases';

export default function LandingPage() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <CodeShowcase />
        <ProductOverview />
        <RTCSection />
        <ChatSection />
        <LiveStreamingSection />
        <EffectsSection />
        <SDKSection />
        <DashboardPreview />
        <Architecture />
        <HowItWorks />
        <Reliability />
        <UseCases />
        <FinalCTA />
      </main>
      <Footer />
    </>
  );
}
