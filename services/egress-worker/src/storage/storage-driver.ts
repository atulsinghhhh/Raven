/**
 * What the egress pipeline needs from an object store, and nothing more.
 *
 * Deliberately provider-agnostic: `AzureBlobStorageDriver` is the only
 * implementation this pass builds (explicit product decision — see
 * LIVE_STREAM_P0_FIX_REPORT.md-adjacent scoping docs), but nothing in
 * `EgressSession` imports `@azure/storage-blob` directly. A future
 * Cloudflare R2/S3/Supabase Storage driver implements this same interface
 * without touching the pipeline that uses it.
 */
export interface StorageDriver {
  /** Uploads (or overwrites) one object. `contentType` matters for HLS: `.m3u8` needs `application/vnd.apple.mpegurl`, `.ts`/`.m4s` needs `video/mp2t`/`video/iso.segment` so a CDN and browser both handle them correctly. */
  upload(key: string, body: Buffer, contentType: string): Promise<void>;
  /** Deletes every object under a key prefix — used when a stream's egress is torn down. Best-effort by convention; callers decide whether a failure here is fatal. */
  deletePrefix(prefix: string): Promise<void>;
  /** The public URL a viewer's HLS player would fetch for a given key, once it's uploaded (e.g. behind Azure Front Door). Never includes credentials. */
  publicUrlFor(key: string): string;
}
