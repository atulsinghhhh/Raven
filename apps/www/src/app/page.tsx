import { Architecture } from '../components/Architecture';
import { ChatSection } from '../components/ChatSection';
import { DashboardPreview } from '../components/DashboardPreview';
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
        <ProductOverview />
        <RTCSection />
        <ChatSection />
        <LiveStreamingSection />
        <HowItWorks />
        <SDKSection />
        <Architecture />
        <DashboardPreview />
        <Reliability />
        <UseCases />
        <FinalCTA />
      </main>
      <Footer />
    </>
  );
}
