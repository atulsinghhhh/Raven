'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { CodeBlock } from '@/components/ui/code-block';
import { ErrorState } from '@/components/ui/states';
import type { IssuedRtcToken } from '@/lib/api-client';

export function TestTokenPanel({ projectId, roomId }: { projectId: string; roomId: string }) {
  const [token, setToken] = useState<IssuedRtcToken>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);

  async function handleGenerate() {
    setLoading(true);
    setError(undefined);
    try {
      const res = await fetch(`/api/projects/${projectId}/rooms/${roomId}/test-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const payload = await res.json();
      if (!res.ok) {
        setError(payload.message ?? 'Could not mint a test token');
        return;
      }
      setToken(payload);
    } catch {
      setError('Could not reach the server.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Generate a test token"
        subtitle="10-minute, full-access token for smoke-testing this room from a browser — never for a real end-user app. See Quickstart for the real token flow."
      />
      <Button onClick={handleGenerate} disabled={loading} variant="secondary">
        {loading ? 'Generating…' : 'Generate test token'}
      </Button>
      {error && (
        <div className="mt-3">
          <ErrorState description={error} />
        </div>
      )}
      {token && (
        <div className="mt-4">
          <p className="text-xs text-neutral-500 mb-2">
            Paste this JSON into <code>examples/video-call</code> (or your own SDK integration) to join as{' '}
            <span className="font-mono">{token.participantIdentity}</span>. Expires at{' '}
            {new Date(token.expiresAt).toLocaleTimeString()}.
          </p>
          <CodeBlock language="json" code={JSON.stringify(token, null, 2)} />
        </div>
      )}
    </Card>
  );
}
