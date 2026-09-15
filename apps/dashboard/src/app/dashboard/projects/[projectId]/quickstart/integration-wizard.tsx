'use client';

import { useMemo, useState } from 'react';
import type { IntegrationVerifyResult, Project, ProjectIntegration } from '@/lib/api-client';
import {
  FRAMEWORKS,
  LANGUAGES,
  PLATFORM_STATUS,
  PRODUCTS,
  getIntegrationEntry,
  isSupported,
  renderIntegrationReadme,
  type Framework,
  type Product,
} from '@/lib/integration-registry';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { CodeBlock, CodeTabs } from '@/components/ui/code-block';
import { CopyButton } from '@/components/ui/copy-button';
import { ErrorState } from '@/components/ui/states';

const PRODUCT_TO_ENUM: Record<Product, ProjectIntegration['product']> = {
  rtc: 'RTC',
  chat: 'CHAT',
  'live-streaming': 'LIVE_STREAMING',
};
const ENUM_TO_PRODUCT: Record<ProjectIntegration['product'], Product> = {
  RTC: 'rtc',
  CHAT: 'chat',
  LIVE_STREAMING: 'live-streaming',
};

/**
 * Per-OS-target verification for the currently selected framework —
 * currently only Flutter has one (`PLATFORM_STATUS`), since every other
 * framework here targets exactly one runtime. Renders nothing for any
 * framework without an entry, so this never affects TypeScript's rows.
 */
function PlatformStatusRow({ framework }: { framework: Framework }) {
  const platforms = PLATFORM_STATUS[framework];
  if (!platforms) return null;

  return (
    <div className="mt-3 flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        {platforms.map((p) => (
          <Badge key={p.id} tone={p.verification === 'verified' ? 'success' : 'neutral'}>
            {FRAMEWORKS.find((f) => f.id === framework)?.label} {p.label} —{' '}
            {p.verification === 'verified' ? 'Supported & verified' : 'Verification pending'}
          </Badge>
        ))}
      </div>
      <p className="text-xs leading-relaxed text-muted">
        {platforms.map((p) => `${p.label}: ${p.detail}`).join(' ')}
      </p>
    </div>
  );
}

export function IntegrationWizard({
  project,
  initialIntegrations,
  defaultFramework,
}: {
  project: Pick<Project, 'id' | 'name'>;
  initialIntegrations: ProjectIntegration[];
  defaultFramework: Framework;
}) {
  const savedProducts = useMemo(() => initialIntegrations.map((i) => ENUM_TO_PRODUCT[i.product]), [initialIntegrations]);

  const [selectedProducts, setSelectedProducts] = useState<Set<Product>>(new Set(savedProducts));
  const [language, setLanguage] = useState(initialIntegrations[0]?.language ?? 'typescript');
  const [framework, setFramework] = useState<Framework>((initialIntegrations[0]?.framework as Framework) ?? defaultFramework);
  const [confirmed, setConfirmed] = useState(savedProducts.length > 0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  // Frameworks are language-specific (Flutter only exists under Dart, the
  // four JS frameworks only exist under TypeScript) — filter rather than
  // showing every framework regardless of the language picked above it.
  const frameworksForLanguage = useMemo(() => FRAMEWORKS.filter((f) => f.language === language), [language]);

  function selectLanguage(id: string) {
    setLanguage(id);
    // The current framework may belong to a different language than the
    // one just picked (e.g. switching TypeScript -> Dart while "Next.js"
    // was selected) — fall back to that language's first framework so the
    // wizard never holds a mismatched language/framework pair.
    const stillValid = FRAMEWORKS.some((f) => f.id === framework && f.language === id);
    if (!stillValid) {
      const next = FRAMEWORKS.find((f) => f.language === id);
      if (next) setFramework(next.id);
    }
  }

  function toggleProduct(id: Product) {
    setSelectedProducts((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  async function confirmSelection() {
    setError(undefined);
    setSaving(true);
    try {
      await Promise.all(
        Array.from(selectedProducts).map((product) =>
          fetch(`/api/projects/${project.id}/integrations/${product}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ language, framework }),
          }).then((res) => {
            if (!res.ok) throw new Error(`Could not save your ${product} selection.`);
          }),
        ),
      );
      setConfirmed(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your selection.');
    } finally {
      setSaving(false);
    }
  }

  if (!confirmed) {
    return (
      <div className="flex flex-col gap-8">
        <section>
          <h2 className="text-sm font-semibold text-fg">What are you building?</h2>
          <p className="mt-1 text-sm text-muted">Select one or more. This shapes everything below.</p>
          <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            {PRODUCTS.map((p) => {
              const active = selectedProducts.has(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleProduct(p.id)}
                  className={`rounded-md border px-4 py-3 text-left transition-all ${
                    active ? 'border-accent bg-accent-subtle shadow-raven-sm' : 'border-line bg-canvas hover:border-line-strong'
                  }`}
                >
                  <span className="block text-sm font-medium text-fg">{p.label}</span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-muted">{p.description}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-fg">What language are you using?</h2>
          <div className="mt-4 flex flex-wrap gap-2">
            {LANGUAGES.map((l) => (
              <button
                key={l.id}
                type="button"
                disabled={!l.supported}
                aria-pressed={language === l.id}
                onClick={() => l.supported && selectLanguage(l.id)}
                className={`rounded-md border px-3.5 py-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  language === l.id ? 'border-accent bg-accent-subtle text-fg' : 'border-line bg-canvas text-muted hover:border-line-strong'
                }`}
              >
                {l.label}
                {!l.supported && <span className="ml-2 text-xs text-subtle">Coming soon</span>}
              </button>
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-fg">What framework are you using?</h2>
          <div className="mt-4 flex flex-wrap gap-2">
            {frameworksForLanguage.map((f) => (
              <button
                key={f.id}
                type="button"
                aria-pressed={framework === f.id}
                onClick={() => setFramework(f.id)}
                className={`rounded-md border px-3.5 py-2 text-sm transition-colors ${
                  framework === f.id ? 'border-accent bg-accent-subtle text-fg' : 'border-line bg-canvas text-muted hover:border-line-strong'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <PlatformStatusRow framework={framework} />
        </section>

        {error && <ErrorState title="Could not save your selection" description={error} />}

        <div>
          <Button onClick={confirmSelection} loading={saving} disabled={selectedProducts.size === 0}>
            Get my integration
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="rounded-md border border-line bg-surface-raised p-3">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted">
            <span className="font-medium text-fg">{LANGUAGES.find((l) => l.id === language)?.label}</span>
            {' + '}
            <span className="font-medium text-fg">{FRAMEWORKS.find((f) => f.id === framework)?.label}</span>
            {' + '}
            <span className="font-medium text-fg">
              {Array.from(selectedProducts)
                .map((p) => PRODUCTS.find((pr) => pr.id === p)?.label)
                .join(', ')}
            </span>
          </p>
          <Button variant="ghost" size="sm" onClick={() => setConfirmed(false)}>
            Change stack
          </Button>
        </div>
        <PlatformStatusRow framework={framework} />
      </div>

      {Array.from(selectedProducts).map((product) => (
        <ProductIntegrationCard
          key={product}
          project={project}
          product={product}
          language={language}
          framework={framework}
          savedRow={initialIntegrations.find((i) => i.product === PRODUCT_TO_ENUM[product])}
        />
      ))}
    </div>
  );
}

function ProductIntegrationCard({
  project,
  product,
  language,
  framework,
  savedRow,
}: {
  project: Pick<Project, 'id' | 'name'>;
  product: Product;
  language: string;
  framework: Framework;
  savedRow?: ProjectIntegration;
}) {
  const entry = getIntegrationEntry(product, language, framework);
  const productLabel = PRODUCTS.find((p) => p.id === product)?.label ?? product;

  const [verifying, setVerifying] = useState(false);
  const [result, setResult] = useState<IntegrationVerifyResult | null>(null);
  const [verifyError, setVerifyError] = useState<string>();

  async function testConnection() {
    setVerifying(true);
    setVerifyError(undefined);
    try {
      const res = await fetch(`/api/projects/${project.id}/integrations/${product}/verify`, { method: 'POST' });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.message ?? 'Could not run the check.');
      setResult(payload as IntegrationVerifyResult);
    } catch (err) {
      setVerifyError(err instanceof Error ? err.message : 'Could not reach the Control API.');
    } finally {
      setVerifying(false);
    }
  }

  if (!isSupported(entry)) {
    return (
      <Card>
        <CardHeader title={productLabel} />
        <ErrorState title="This combination isn't currently supported" description={`${entry.reason} ${entry.alternative}`} />
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title={productLabel}
        subtitle={
          savedRow?.lastVerifiedSuccess === true
            ? 'Verified — last checked successfully.'
            : savedRow?.lastVerifiedSuccess === false
              ? 'Last check failed — see below.'
              : undefined
        }
      />

      <ol className="mt-4 flex flex-col gap-6">
        <li>
          <p className="text-sm font-medium text-fg">1. Install</p>
          <div className="mt-2">
            <CodeTabs samples={entry.install} />
          </div>
        </li>

        <li>
          <p className="text-sm font-medium text-fg">2. Environment variables</p>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            Server-only — never put these in client-side code, <code className="font-mono">NEXT_PUBLIC_*</code> variables,
            or version control. There is no client-safe Raven credential: the browser only ever receives a short-lived
            token your backend forwards to it.
          </p>
          <div className="mt-2">
            <CodeBlock
              language="bash"
              filename=".env"
              code={entry.env.server.map((v) => `${v.name}=${v.example ?? ''}`).join('\n')}
            />
          </div>
        </li>

        <li>
          <p className="text-sm font-medium text-fg">3. Code</p>
          <div className="mt-2 flex flex-col gap-3">
            {entry.files.map((file) => (
              <CodeBlock key={file.path} language={file.language} filename={file.path} code={file.code} />
            ))}
          </div>
        </li>

        <li>
          <p className="text-sm font-medium text-fg">4. Run</p>
          <div className="mt-2">
            <CodeBlock language="bash" code={entry.runCommand} />
          </div>
        </li>
      </ol>

      <div className="mt-6 border-t border-line pt-5">
        <p className="text-sm font-medium text-fg">Test your integration</p>
        <div className="mt-2 flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={testConnection} loading={verifying}>
            Test Raven connection
          </Button>
          <CopyButton value={renderIntegrationReadme(entry, project)} label="Copy integration guide" />
        </div>

        {verifyError && (
          <div className="mt-3">
            <ErrorState title="Could not run the check" description={verifyError} />
          </div>
        )}

        {result && (
          <ul className="mt-3 flex flex-col gap-1.5">
            {result.checks.map((check) => (
              <li key={check.id} className="flex items-start gap-2 text-sm">
                <Badge tone={check.status === 'pass' ? 'success' : 'danger'}>
                  {check.status === 'pass' ? 'Pass' : 'Fail'}
                </Badge>
                <span className="min-w-0 flex-1">
                  <span className="block text-fg">{check.label}</span>
                  {check.detail && <span className="block text-xs text-muted">{check.detail}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
