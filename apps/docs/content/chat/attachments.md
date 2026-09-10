---
title: Attachments
description: Direct-to-storage uploads — files never pass through the WebSocket.
---

> **Check your deployment has object storage.** Attachments require an
> S3-compatible bucket. With no `STORAGE_BUCKET` configured, every endpoint
> on this page returns `RAVEN_NOT_CONFIGURED` — the API says so out loud
> rather than half-working. See
> [Known limitations](/reference/known-limitations).


Files never pass through Livqeno's API and never through the WebSocket.
The browser uploads directly to object storage using a short-lived
signed URL.

```
Client                    Livqeno                Object storage
  │  POST .../attachments   │                        │
  ├────────────────────────►│                        │
  │  signed PUT URL         │                        │
  │◄────────────────────────┤                        │
  │  PUT the bytes                                    │
  ├─────────────────────────────────────────────────►│
  │  POST .../complete      │                        │
  ├────────────────────────►│                        │
  │  sendMessage({ attachmentId })                    │
  ├────────────────────────►│                        │
```

## Why not through the WebSocket

A WebSocket is a single ordered stream. A 20 MB file pushed through it
blocks every message behind it — one person sharing a screenshot stalls
the conversation for everyone on that connection. Base64-encoding it
(the usual workaround) also inflates it by a third. Direct-to-storage
uploads cost Livqeno no bandwidth, no memory, and no head-of-line
blocking, and can be resumed or retried without touching the messaging
path at all.

**Web and React Native only.** `raven_chat` (Flutter) doesn't expose an
attachments API in this phase — build direct-to-storage uploads against
the REST endpoints below yourself if you need them there.

## Using it

React Native uses the exact same calls as web — `raven.chat` is a
`ChatClient` instance, not a reimplementation. The examples below are
shown once, for both:

```ts
const attachment = await chat.attachments.upload(file);
await chat.sendMessage({ type: 'attachment', attachmentId: attachment.id, text: 'See attached' });
```

For a progress bar or a resumable transfer, drive it yourself:

```ts
const ticket = await chat.attachments.createUploadTicket({
  filename: file.name,
  mimeType: file.type,
  size: file.size,
});

await fetch(ticket.uploadUrl, { method: 'PUT', headers: ticket.uploadHeaders, body: file });
await chat.attachments.complete(ticket.id);
```

## Downloading

```ts
const { url, expiresAt } = await chat.attachments.getDownloadUrl('att_…');
```

Mint one when the user actually clicks. **Don't cache these** — they
expire, and that expiry is what stops a link shared in a screenshot from
becoming permanent access to a private file. Access is checked on
Livqeno's side (project, conversation membership, `chat:read`) before a
URL is issued, so a leaked URL grants one file for a few minutes rather
than the bucket forever.

## Security properties

- **Storage credentials never reach the browser** — only a signed URL
  does, addressing exactly one object.
- **Storage keys are `chat/{project}/{conversation}/{random}`**, never
  the user-supplied filename — a name like `../../../other-tenant/secrets`
  can't traverse anywhere, because it isn't part of the path. The
  original name is kept as metadata and returned at download time.
- **Filenames are sanitized** of path separators and control characters,
  so a name containing a newline can't become header injection
  downstream.
- **Size is checked before a URL is issued**, and content type is pinned
  into the signed URL so a client can't swap in a different one after
  the fact.
- **Only the uploader can attach it**, once, to one message.

## Configuration

Any S3-compatible provider — AWS S3, MinIO, Cloudflare R2, DigitalOcean
Spaces:

```bash
STORAGE_ENDPOINT=https://s3.eu-west-1.amazonaws.com
STORAGE_REGION=eu-west-1
STORAGE_BUCKET=raven-attachments
STORAGE_ACCESS_KEY_ID=...
STORAGE_SECRET_ACCESS_KEY=...
```
