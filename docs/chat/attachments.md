# Raven Chat — Attachments

Files never pass through Raven's API and never through the WebSocket. The
browser uploads directly to object storage using a short-lived signed URL.

```
Client                    Raven                Object storage
  │                         │                        │
  │  POST …/attachments     │                        │
  ├────────────────────────►│                        │
  │  signed PUT URL         │                        │
  │◄────────────────────────┤                        │
  │                                                  │
  │  PUT the bytes                                   │
  ├─────────────────────────────────────────────────►│
  │                                                  │
  │  POST …/complete        │                        │
  ├────────────────────────►│                        │
  │                         │                        │
  │  sendMessage({ attachmentId })                   │
  ├────────────────────────►│                        │
```

## Why not through the WebSocket

A WebSocket is a single ordered stream. A 20 MB file pushed through it blocks
every message behind it — one person sharing a screenshot stalls the
conversation for everyone on that connection. Base64-encoding it (the usual
workaround) also inflates it by a third.

Direct-to-storage uploads mean a large file costs Raven no bandwidth, no
memory, and no head-of-line blocking, and it can be resumed or retried without
involving the messaging path at all.

## Using it

The SDK wraps the whole three-step dance:

```js
const attachment = await chat.attachments.upload(file);
await chat.sendMessage({
  type: 'attachment',
  attachmentId: attachment.id,
  text: 'See attached',
});
```

If you need a progress bar or a resumable transfer, drive it yourself:

```js
const ticket = await chat.attachments.createUploadTicket({
  filename: file.name,
  mimeType: file.type,
  size: file.size,
});

await fetch(ticket.uploadUrl, {
  method: 'PUT',
  headers: ticket.uploadHeaders,
  body: file,
});

await chat.attachments.complete(ticket.id);
```

## Downloading

```js
const { url, expiresAt } = await chat.attachments.getDownloadUrl('att_…');
```

Mint one when the user actually clicks. **Don't cache these** — they expire,
and that expiry is what stops a link shared in a screenshot from becoming
permanent access to a private file.

Access is checked on Raven's side (project, conversation membership,
`chat:read`) before a URL is issued. The object itself stays private in the
bucket, so a leaked URL grants one file for a few minutes rather than the
bucket forever.

## Security properties

**Storage credentials never reach the browser.** Only a signed URL does, and
it addresses exactly one object.

**Storage keys are `chat/{project}/{conversation}/{random}`** — never the
user-supplied filename. A filename like `../../../other-tenant/secrets` can't
traverse anywhere, because it isn't part of the path. The original name is
kept as metadata and returned at download time.

**Filenames are sanitised** of path separators and control characters, so a
name containing a newline can't become header injection in a
`Content-Disposition` downstream.

**Size is checked before a URL is issued**, and the content type is pinned into
the signed URL so a client can't swap in a different one after the fact.

**Only the uploader can attach it**, once, to one message — an attachment id
can't be reused or hijacked.

## Configuration

Any S3-compatible provider: AWS S3, MinIO, Cloudflare R2, DigitalOcean Spaces.

```bash
STORAGE_ENDPOINT=https://s3.eu-west-1.amazonaws.com
STORAGE_REGION=eu-west-1
STORAGE_BUCKET=raven-attachments
STORAGE_ACCESS_KEY_ID=…
STORAGE_SECRET_ACCESS_KEY=…
STORAGE_FORCE_PATH_STYLE=false   # true for MinIO
STORAGE_MAX_ATTACHMENT_BYTES=26214400
STORAGE_UPLOAD_URL_TTL_SECONDS=900
STORAGE_DOWNLOAD_URL_TTL_SECONDS=900
```

`docker-compose.yml` runs MinIO locally and creates the bucket, so
`pnpm infra:up` gives you working attachments with no further setup.

Leave `STORAGE_BUCKET` unset and the attachment endpoints return
`ATTACHMENTS_NOT_CONFIGURED`. Attachments are optional infrastructure, and
saying so plainly beats half-working.

`STORAGE_ENDPOINT` must be `https://` in production — the API refuses to start
otherwise, because a signed upload URL over cleartext hands the file to
anyone on the path.

## Implementation note

Raven signs URLs with a hand-written SigV4 implementation
(`s3-presign.util.ts`) rather than depending on `@aws-sdk/client-s3` and
`@aws-sdk/s3-request-presigner`. Those add several megabytes and a large
transitive tree to the API image, and Raven needs exactly two operations —
presigned `GET` and `PUT`. No multipart, no bucket management, no streaming.

It's verified in tests against an independently-derived signature, not against
itself, so "it probably works" isn't the standard being met.

## Limitations

- **No virus scanning.** Scan in your own pipeline if you need it — a webhook
  on `message.created` is the hook for that.
- **No thumbnailing or transcoding.** Store dimensions in `metadata` and
  render client-side.
- **Completion is client-asserted.** Confirming an upload that didn't happen
  leaves a message pointing at an empty key. It's visible immediately, scoped
  to that user's own attachment, and verifying would cost a `HEAD` against
  storage on every upload.
- **No resumable uploads.** A failed upload is retried from the start.
