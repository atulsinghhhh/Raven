import { redirect } from 'next/navigation';
import { getSessionToken } from '@/lib/session';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Card, CardHeader } from '@/components/ui/card';
import { CodeBlock } from '@/components/ui/code-block';
import { ButtonLink } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { DOCS_URL } from '@/lib/nav';

/**
 * Livqeno Effects has no per-project data of its own: there is no
 * "effects" resource in the Control API, nothing to fetch. This page is a
 * capability reference, the same kind of static page as SDKs: what ships,
 * on which platform, at what maturity. Every row here is transcribed from
 * packages/effects's actual filter/preset registry and each SDK's own
 * integration: nothing is listed as shipping that isn't in the tree.
 */

type Status = 'production' | 'experimental' | 'planned';

const STATUS_TONE: Record<Status, BadgeTone> = {
  production: 'success',
  experimental: 'warning',
  planned: 'neutral',
};

const STATUS_LABEL: Record<Status, string> = {
  production: 'Production',
  experimental: 'Experimental',
  planned: 'Planned',
};

interface CapabilityRow {
  name: string;
  web: Status;
  react: Status;
  reactNative: Status;
  flutter: Status;
  note?: string;
}

const FILTER_ROWS: CapabilityRow[] = [
  { name: 'Brightness', web: 'production', react: 'production', reactNative: 'planned', flutter: 'planned' },
  { name: 'Contrast', web: 'production', react: 'production', reactNative: 'planned', flutter: 'planned' },
  { name: 'Saturation', web: 'production', react: 'production', reactNative: 'planned', flutter: 'planned' },
  { name: 'Exposure', web: 'production', react: 'production', reactNative: 'planned', flutter: 'planned' },
  { name: 'Temperature', web: 'production', react: 'production', reactNative: 'planned', flutter: 'planned' },
  { name: 'Tint', web: 'production', react: 'production', reactNative: 'planned', flutter: 'planned' },
  { name: 'Grayscale', web: 'production', react: 'production', reactNative: 'planned', flutter: 'planned' },
  { name: 'Sepia', web: 'production', react: 'production', reactNative: 'planned', flutter: 'planned' },
  { name: 'Blur', web: 'production', react: 'production', reactNative: 'planned', flutter: 'planned' },
  {
    name: 'Presets (vivid, warm, cool, cinematic, vintage)',
    web: 'production',
    react: 'production',
    reactNative: 'planned',
    flutter: 'planned',
    note: 'Pure composition of the filters above — no separate implementation.',
  },
  {
    name: 'Beauty smoothing',
    web: 'production',
    react: 'production',
    reactNative: 'planned',
    flutter: 'planned',
    note: 'Whole-frame adjustable blur, not face-aware — see Face tracking below for why.',
  },
];

const CAPABILITY_ROWS: CapabilityRow[] = [
  {
    name: 'Effects pipeline (add/remove/update/reorder/enable/disable/clear)',
    web: 'production',
    react: 'production',
    reactNative: 'planned',
    flutter: 'planned',
    note: 'RN/Flutter can build and validate a pipeline in JS/Dart today; there is no native engine to attach it to yet.',
  },
  {
    name: 'RTC integration (camera.attachEffects())',
    web: 'production',
    react: 'production',
    reactNative: 'planned',
    flutter: 'planned',
    note: 'On RN, calling attachEffects() degrades to the unmodified camera track and emits RAVEN_EFFECT_UNSUPPORTED — it never throws or fakes processed video. On Flutter there is no track handle to attach to yet.',
  },
  {
    name: 'Live Streaming integration',
    web: 'production',
    react: 'production',
    reactNative: 'planned',
    flutter: 'planned',
    note: 'Same pipeline as RTC — a live stream is an ordinary Room underneath, so nothing stream-specific was built.',
  },
  { name: 'Face detection / tracking', web: 'planned', react: 'planned', reactNative: 'planned', flutter: 'planned' },
  {
    name: 'Background blur / replacement',
    web: 'planned',
    react: 'planned',
    reactNative: 'planned',
    flutter: 'planned',
    note: 'Needs a segmentation model this release does not ship.',
  },
  {
    name: 'AR overlays / face masks',
    web: 'planned',
    react: 'planned',
    reactNative: 'planned',
    flutter: 'planned',
    note: 'Depends on face tracking, above.',
  },
];

export default async function EffectsOverviewPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const token = await getSessionToken();
  if (!token) redirect('/login');

  const base = `/dashboard/projects/${projectId}`;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Effects"
        description="Camera filters and real-time video effects, shared by Livqeno RTC and Livqeno Live Streaming — one pipeline, applied to the publisher's video before it reaches either."
        actions={
          <ButtonLink href={`${DOCS_URL}/effects.md`} variant="primary">
            Effects docs
          </ButtonLink>
        }
      />

      <section className="rounded-lg border border-info-line bg-info-subtle p-4">
        <p className="text-sm leading-relaxed text-info-text">
          <span className="font-medium">Effects run once, on the publisher.</span> A pipeline processes the local camera
          track before it&apos;s published; every remote participant or viewer receives the already-processed video.
          Nothing re-runs per viewer.
        </p>
      </section>

      <Card padded={false}>
        <div className="border-b border-line px-5 py-4">
          <h2 className="text-sm font-semibold text-fg">Quickstart</h2>
        </div>
        <div className="p-5">
          <CodeBlock
            language="typescript"
            code={`const room = await raven.rtc.join(roomId);
const camera = await room.enableCamera();

const effects = raven.effects.createPipeline();
effects.applyPreset(raven.effects.presets.cinematic);

await camera.attachEffects(effects);
// camera.detachEffects() reverts to the unmodified track at any time.`}
          />
        </div>
      </Card>

      <Card padded={false}>
        <CardHeaderRow
          title="Filters &amp; presets"
          subtitle="Every filter in packages/effects's registry, by platform."
        />
        <CapabilityTable rows={FILTER_ROWS} />
      </Card>

      <Card padded={false}>
        <CardHeaderRow
          title="Pipeline &amp; integration"
          subtitle="Lifecycle, RTC/Live Streaming wiring, and the not-yet-implemented foundations."
        />
        <CapabilityTable rows={CAPABILITY_ROWS} />
      </Card>

      <Card>
        <CardHeader title="Browser support (Web/React)" subtitle="Capability-detected at runtime — never assumed." />
        <ul className="flex flex-col gap-2 text-sm leading-relaxed text-muted">
          <li>
            <span className="font-medium text-fg">WebGL2 + captureStream() available.</span> GPU-accelerated pipeline —
            current Chrome, Firefox, Edge, and Safari 16.4+.
          </li>
          <li>
            <span className="font-medium text-fg">captureStream() only.</span> CPU pixel-buffer fallback (Canvas2D) —
            every filter still runs, just slower.
          </li>
          <li>
            <span className="font-medium text-fg">Neither available.</span> The pipeline passes the original camera
            track through unmodified. The call or stream keeps working either way.
          </li>
        </ul>
      </Card>

      <Card>
        <CardHeader title="Not available" subtitle="Stated so you don't go looking." />
        <ul className="flex flex-col gap-2 text-sm leading-relaxed text-muted">
          <li>
            <span className="font-medium text-fg">Native mobile processing.</span> React Native and Flutter can build
            and validate a pipeline (filters, presets, parameters) with no native code, but there is no GPU frame
            processor wired to a published camera track on either platform yet.
          </li>
          <li>
            <span className="font-medium text-fg">Face detection, background blur/replacement, AR overlays.</span> The
            extension points exist (<span className="font-mono text-xs">FaceDetector</span>,{' '}
            <span className="font-mono text-xs">BackgroundProcessor</span>,{' '}
            <span className="font-mono text-xs">AROverlay</span> in{' '}
            <span className="font-mono text-xs">@ravenkash/effects</span>
            ), and every one of them reports itself unsupported rather than faking a result.
          </li>
          <li>
            <span className="font-medium text-fg">Arbitrary custom shaders/scripts.</span> Custom effects register as
            trusted, in-process objects only — Livqeno Effects never loads code, shaders, or WASM from a URL.
          </li>
        </ul>
        <div className="mt-4">
          <ButtonLink href={`${base}/sdks`} variant="secondary">
            View SDKs
          </ButtonLink>
        </div>
      </Card>
    </div>
  );
}

function CardHeaderRow({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="border-b border-line px-5 py-4">
      <h2 className="text-sm font-semibold text-fg">{title}</h2>
      <p className="mt-1 text-xs leading-relaxed text-muted">{subtitle}</p>
    </div>
  );
}

function CapabilityTable({ rows }: { rows: CapabilityRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead>
          <tr className="border-b border-line text-xs font-semibold uppercase tracking-wide text-muted">
            <th className="px-5 py-3">Capability</th>
            <th className="px-5 py-3">Web</th>
            <th className="px-5 py-3">React</th>
            <th className="px-5 py-3">React Native</th>
            <th className="px-5 py-3">Flutter</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.name} className="border-b border-line last:border-b-0">
              <td className="px-5 py-3 align-top">
                <div className="text-fg">{row.name}</div>
                {row.note && <div className="mt-1 max-w-md text-xs leading-relaxed text-subtle">{row.note}</div>}
              </td>
              <td className="px-5 py-3 align-top">
                <StatusBadge status={row.web} />
              </td>
              <td className="px-5 py-3 align-top">
                <StatusBadge status={row.react} />
              </td>
              <td className="px-5 py-3 align-top">
                <StatusBadge status={row.reactNative} />
              </td>
              <td className="px-5 py-3 align-top">
                <StatusBadge status={row.flutter} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatusBadge({ status }: { status: Status }) {
  return <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>;
}
