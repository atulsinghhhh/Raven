import { NextRequest, NextResponse } from 'next/server';
import { ravenApi } from '@/lib/api-client';
import { handleApiError, isResponse, requireSessionToken } from '@/lib/route-helpers';

/**
 * Backs the ⌘K palette. There's no search endpoint on the Control API, so
 * this fans out to the existing list endpoints and filters in memory;
 * bounded by the same limits those endpoints already enforce, and scoped
 * to one project the caller demonstrably owns (every upstream call is
 * ownership-checked API-side).
 *
 * Results are therefore "within the most recent N records", never a full
 * historical search; the palette says so rather than implying otherwise.
 */
const SCAN_LIMIT = 200;
const MAX_PER_GROUP = 5;

export interface SearchHit {
  type: 'room' | 'connection' | 'error' | 'participant' | 'stream';
  id: string;
  title: string;
  subtitle?: string;
  href: string;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const token = await requireSessionToken();
  if (isResponse(token)) return token;

  const { projectId } = await params;
  const query = (request.nextUrl.searchParams.get('q') ?? '').trim().toLowerCase();

  if (query.length < 2) return NextResponse.json({ hits: [] });

  try {
    const [rooms, connections, errors, streams] = await Promise.all([
      ravenApi.listRooms(token, projectId).catch(() => []),
      ravenApi.listConnections(token, projectId, { limit: SCAN_LIMIT }).catch(() => []),
      ravenApi.listErrors(token, projectId, { limit: SCAN_LIMIT }).catch(() => []),
      ravenApi.listLiveStreams(token, projectId).catch(() => []),
    ]);

    const base = `/dashboard/projects/${projectId}`;
    const hits: SearchHit[] = [];

    for (const room of rooms) {
      if (!match(query, room.name, room.id)) continue;
      hits.push({
        type: 'room',
        id: room.id,
        title: room.name,
        subtitle:
          room.liveParticipantCount === null
            ? 'Live state unavailable'
            : `${room.liveParticipantCount} live participant${room.liveParticipantCount === 1 ? '' : 's'}`,
        href: `${base}/rooms/${room.id}`,
      });
      if (hits.filter((h) => h.type === 'room').length >= MAX_PER_GROUP) break;
    }

    for (const c of connections) {
      if (!match(query, c.publicId, c.participantIdentity, c.roomName)) continue;
      hits.push({
        type: 'connection',
        id: c.publicId,
        title: c.publicId,
        subtitle: `${c.participantIdentity} · ${c.roomName} · ${c.state.toLowerCase()}`,
        href: `${base}/connections/${c.publicId}`,
      });
      if (hits.filter((h) => h.type === 'connection').length >= MAX_PER_GROUP) break;
    }

    for (const e of errors) {
      if (!match(query, e.publicId, e.category, e.message)) continue;
      hits.push({
        type: 'error',
        id: e.publicId,
        title: e.message,
        subtitle: `${e.category.replace(/_/g, ' ').toLowerCase()} · ${e.publicId}`,
        href: `${base}/errors/${e.publicId}`,
      });
      if (hits.filter((h) => h.type === 'error').length >= MAX_PER_GROUP) break;
    }

    for (const stream of streams) {
      if (!match(query, stream.title, stream.id, ...stream.hosts.map((h) => h.identity))) continue;
      hits.push({
        type: 'stream',
        id: stream.id,
        title: stream.title,
        subtitle: `${stream.status.toLowerCase()}${stream.hosts[0] ? ` · ${stream.hosts[0].identity}` : ''}`,
        href: `${base}/live-streaming/streams/${stream.id}`,
      });
      if (hits.filter((h) => h.type === 'stream').length >= MAX_PER_GROUP) break;
    }

    // Participants aren't a resource of their own: they're derived from the
    // connections above, deduped by identity.
    const seen = new Set<string>();
    for (const c of connections) {
      const identity = c.participantIdentity;
      if (!identity || seen.has(identity) || !match(query, identity)) continue;
      seen.add(identity);
      hits.push({
        type: 'participant',
        id: identity,
        title: identity,
        subtitle: `Last seen in ${c.roomName}`,
        href: `${base}/participants?q=${encodeURIComponent(identity)}`,
      });
      if (seen.size >= MAX_PER_GROUP) break;
    }

    return NextResponse.json({ hits });
  } catch (error) {
    return handleApiError(error);
  }
}

function match(query: string, ...fields: (string | null | undefined)[]): boolean {
  return fields.some((f) => f?.toLowerCase().includes(query));
}
