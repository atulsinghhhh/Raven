import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getSessionToken } from '@/lib/session';
import { ApiError } from '@/lib/super-admin-client';
import { getDeveloperUsage, type ProductUsageBreakdown } from '@/lib/super-admin/usage';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader, StatCard } from '@/components/ui/card';
import { Meter } from '@/components/ui/meter';
import { BarChart } from '@/components/ui/chart';
import { ErrorState } from '@/components/ui/states';
import { formatCount, formatDate } from '@/lib/format';
import { AllowanceForm } from './allowance-form';

export const metadata: Metadata = {
  title: 'Developer usage — Super Admin',
};

interface Params {
  params: Promise<{ id: string }>;
}

const PRODUCT_LABEL: Record<ProductUsageBreakdown['product'], string> = {
  RTC: 'RTC',
  CHAT: 'Chat',
  LIVE_STREAMING: 'Live Streaming',
};

export default async function DeveloperUsagePage({ params }: Params) {
  const token = await getSessionToken();
  if (!token) redirect('/login?next=/super-admin/usage');

  const { id } = await params;

  let detail;
  try {
    detail = await getDeveloperUsage(token, id);
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 401 || err.status === 403) redirect('/dashboard');
      if (err.status === 404) notFound();
    }
    return (
      <div className="flex flex-col gap-8">
        <PageHeader
          eyebrow="Operations"
          breadcrumb={{ label: 'Usage', href: '/super-admin/usage' }}
          title="Developer usage"
        />
        <ErrorState
          title="Could not load this developer's usage"
          description="The Super Admin API is unreachable right now. Retry in a moment."
          retryHref={`/super-admin/usage/developers/${id}`}
        />
      </div>
    );
  }

  const rtcDaily = detail.daily.map((d) => ({ label: shortDate(d.date), value: d.rtcMinutes, hint: `${d.date}: ${d.rtcMinutes} min` }));
  const liveDaily = detail.daily.map((d) => ({
    label: shortDate(d.date),
    value: d.liveStreamingMinutes,
    hint: `${d.date}: ${d.liveStreamingMinutes} min`,
  }));

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow="Operations"
        breadcrumb={{ label: 'Usage', href: '/super-admin/usage' }}
        title={detail.email}
        description={`Developer since ${formatDate(detail.createdAt)}. Full RTC, Chat and Live Streaming allowance breakdown.`}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {detail.products.map((p) => (
          <ProductCard key={p.product} product={p} />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="RTC minutes / day" subtitle="Trailing 30 days, UTC, attributed to the day a session started." />
          <BarChart data={rtcDaily} caption="RTC minutes per day, trailing 30 days" />
        </Card>
        <Card>
          <CardHeader
            title="Live Streaming host-minutes / day"
            subtitle="Trailing 30 days, UTC. Host/co-host time only — viewers are never metered."
          />
          <BarChart data={liveDaily} caption="Live Streaming host-minutes per day, trailing 30 days" />
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Edit allowance"
          subtitle="Changing a limit requires a reason and is written to the admin audit log — nothing here is silent."
        />
        <AllowanceForm userId={detail.userId} products={detail.products} />
      </Card>
    </div>
  );
}

function ProductCard({ product }: { product: ProductUsageBreakdown }) {
  if (!product.provisioned) {
    return (
      <Card>
        <CardHeader title={PRODUCT_LABEL[product.product]} />
        <p className="text-sm text-subtle italic">Not used yet — no allowance provisioned.</p>
      </Card>
    );
  }

  const tone = product.band === '100' ? 'danger' : product.band === '90' || product.band === '75' ? 'warning' : 'default';

  return (
    <Card>
      <CardHeader
        title={PRODUCT_LABEL[product.product]}
        subtitle={product.exhaustedAt ? `Exhausted ${formatDate(product.exhaustedAt)}` : undefined}
      />
      <div className="flex flex-col gap-4">
        <Meter
          label={<span className="sr-only">{product.product} usage</span>}
          valueLabel={`${formatCount(product.used)} / ${formatCount(product.included)} ${product.unit}`}
          percent={product.usedPercent}
          value={product.used}
          max={Math.max(product.included, 1)}
        />
        <div className="grid grid-cols-3 gap-2">
          <StatCard label="Used" value={formatCount(product.used)} tone={tone} />
          <StatCard label="Included" value={formatCount(product.included)} />
          <StatCard label="Remaining" value={formatCount(product.remaining)} />
        </div>
      </div>
    </Card>
  );
}

/** `MM-DD` from a `YYYY-MM-DD` bucket key — compact enough for a 30-point x-axis. */
function shortDate(date: string): string {
  return date.slice(5);
}
