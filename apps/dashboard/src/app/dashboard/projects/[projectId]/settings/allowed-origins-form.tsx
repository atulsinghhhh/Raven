'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { TextareaField } from '@/components/ui/field';
import { ErrorState } from '@/components/ui/states';

/**
 * Per-project browser origin allow-list.
 *
 * One textarea rather than a row-per-origin editor: the list is short, it is
 * usually pasted from somewhere, and the Control API takes and returns the
 * whole list anyway. Fancier row widgets would add state to get wrong for a
 * field most projects set twice.
 *
 * Validation is deliberately left to the API. It already refuses anything
 * that is not an origin and names the offending entries, and duplicating
 * that regex here would give two answers that could disagree.
 */
export function AllowedOriginsForm({
  projectId,
  initialOrigins,
  initialAllowLocalhost,
}: {
  projectId: string;
  initialOrigins: string[];
  initialAllowLocalhost: boolean;
}) {
  const router = useRouter();
  const [text, setText] = useState(initialOrigins.join('\n'));
  const [allowLocalhost, setAllowLocalhost] = useState(initialAllowLocalhost);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string>();

  const parsed = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const dirty = parsed.join('\n') !== initialOrigins.join('\n') || allowLocalhost !== initialAllowLocalhost;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(undefined);
    setSaved(false);

    try {
      const res = await fetch(`/api/projects/${projectId}/allowed-origins`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowedOrigins: parsed, allowLocalhostOrigins: allowLocalhost }),
      });
      const payload = await res.json();

      if (!res.ok) {
        setError(payload.message ?? 'Could not save allowed origins');
        return;
      }

      setSaved(true);
      router.refresh();
    } catch {
      setError('Could not reach the server.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Allowed origins"
        subtitle="Which browser applications may make cross-origin requests to Raven. Your Raven API key stays server-side either way."
      />

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {error && <ErrorState title="Could not save allowed origins" description={error} />}

        {parsed.length === 0 && (
          <p className="rounded border border-line bg-surface-2 p-3 text-sm leading-relaxed text-muted">
            <span className="font-medium text-fg">No origins configured — browser access is currently
            unrestricted.</span>{' '}
            Any origin may reach this project&apos;s SDK endpoints. Add your application&apos;s domains below to limit
            it: enforcement begins as soon as the list is non-empty, and applies from the next connection.
            <br />
            <span className="mt-1.5 block text-xs">
              An empty list means &ldquo;unconfigured&rdquo;, not &ldquo;deny&rdquo;, so that projects created before
              this setting existed did not lose browser access to a field nobody had filled in. A Raven API key is
              unaffected either way — it stays server-side.
            </span>
          </p>
        )}

        <TextareaField
          id="allowed-origins"
          label="Origins"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setSaved(false);
          }}
          hint="One per line. Scheme, host and port only — no paths, no wildcards."
        />

        <div className="text-sm leading-relaxed text-muted">
          <p className="font-medium text-fg">Examples</p>
          <pre className="mt-1.5 overflow-x-auto rounded border border-line bg-surface-2 p-3 font-mono text-xs text-fg">
            {'Development:\nhttp://localhost:3000\nhttp://localhost:5173\n\nProduction:\nhttps://app.example.com'}
          </pre>
        </div>

        <label className="flex items-start gap-2.5 text-sm">
          <input
            type="checkbox"
            checked={allowLocalhost}
            onChange={(e) => {
              setAllowLocalhost(e.target.checked);
              setSaved(false);
            }}
            className="mt-0.5"
          />
          <span className="text-muted">
            <span className="font-medium text-fg">Always allow localhost</span> — permits{' '}
            <code className="font-mono text-xs text-fg">localhost</code>,{' '}
            <code className="font-mono text-xs text-fg">127.0.0.1</code> and{' '}
            <code className="font-mono text-xs text-fg">[::1]</code> on any port, so local development keeps working
            without registering ports. Turn it off once this project has shipped.
          </span>
        </label>

        <div className="flex items-center gap-3 border-t border-line pt-4">
          <Button type="submit" loading={saving} disabled={!dirty}>
            Save origins
          </Button>
          <span aria-live="polite" className="text-sm text-muted">
            {saved ? 'Saved' : dirty ? 'Unsaved changes' : ''}
          </span>
        </div>
      </form>
    </Card>
  );
}
