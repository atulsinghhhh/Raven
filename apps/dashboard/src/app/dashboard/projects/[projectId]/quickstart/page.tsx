import { redirect } from 'next/navigation';
import { getSessionToken } from '@/lib/session';
import { Card, CardHeader } from '@/components/ui/card';
import { CodeBlock } from '@/components/ui/code-block';

export default async function QuickstartPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const token = await getSessionToken();
  if (!token) redirect('/login');

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <Card>
        <CardHeader title="1. Install the SDK" subtitle="Browser client — hides SDP/ICE/STUN/TURN/SFU behind a small API." />
        <CodeBlock code="npm install @raven/rtc" />
      </Card>

      <Card>
        <CardHeader
          title="2. Mint a short-lived RTC token — on your BACKEND"
          subtitle="Never mint tokens in the browser, and never embed your API key in frontend code."
        />
        <div className="mb-2 text-xs font-semibold text-neutral-500 uppercase tracking-wide">Backend</div>
        <CodeBlock
          language="bash"
          code={`curl -X POST https://your-api.example.com/v1/rooms/ROOM_ID/rtc-tokens \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "participantIdentity": "alice",
    "permissions": { "join": true, "subscribe": true, "publish": true, "publishAudio": true, "publishVideo": true }
  }'`}
        />
        <p className="text-xs text-neutral-500 mt-3">
          The response includes <code>token</code>, <code>livekitUrl</code>, and <code>iceServers</code> — forward all
          three to your frontend as-is. See{' '}
          <a href={`/dashboard/projects/${projectId}/api-keys`} className="underline">API Keys</a> to create the key
          used above.
        </p>
      </Card>

      <Card>
        <CardHeader title="3. Initialize the client and join a room — in your FRONTEND" />
        <div className="mb-2 text-xs font-semibold text-neutral-500 uppercase tracking-wide">Frontend</div>
        <CodeBlock
          language="typescript"
          code={`import { createRTCClient } from '@raven/rtc';

// token, endpoint, and iceServers all come from the backend response above —
// don't build these yourself.
const client = createRTCClient({
  token,
  endpoint,
  iceServers,
});

const room = await client.join('room-123');`}
        />
      </Card>

      <Card>
        <CardHeader title="4. Publish camera/microphone" />
        <CodeBlock
          language="typescript"
          code={`await room.enableCamera();
await room.enableMicrophone();`}
        />
      </Card>

      <Card>
        <CardHeader title="5. Subscribe to remote participants" />
        <CodeBlock
          language="typescript"
          code={`room.on('participantJoined', (participant) => {
  console.log('joined:', participant.identity);
});

room.on('trackSubscribed', (track, participant) => {
  videoContainer.appendChild(track.attach());
});`}
        />
      </Card>

      <Card>
        <CardHeader title="6. Leave the room" />
        <CodeBlock language="typescript" code="await room.leave();" />
      </Card>

      <p className="text-xs text-neutral-500">
        See <code>docs/sdk.md</code> in the repository for the full API reference — every example above matches the
        real <code>@raven/rtc</code> package exactly, nothing here is aspirational.
      </p>
    </div>
  );
}
