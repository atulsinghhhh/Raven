import { BlobServiceClient, ContainerClient } from '@azure/storage-blob';
import type { StorageDriver } from './storage-driver.js';

export interface AzureBlobStorageDriverOptions {
  /** Full Azure Storage connection string (or Azurite's well-known local one for dev). Service-to-service only — never forwarded to a browser. */
  connectionString: string;
  container: string;
  /**
   * The public base URL a viewer's HLS player fetches from — normally an
   * Azure Front Door/CDN endpoint in front of this container, not the
   * storage account's own URL. Trailing slash stripped if present.
   */
  publicBaseUrl: string;
}

/**
 * The only concrete `StorageDriver` this pass builds — Azure Blob Storage,
 * per explicit product decision to stay on Azure rather than adding a
 * second cloud provider. Not layered on the existing S3-compatible
 * presigner (`apps/api/src/modules/chat/attachments/s3-presign.util.ts`):
 * that presigner only speaks S3 SigV4, which does not work against Azure
 * Blob's SharedKey/SAS auth (see docs/issues/06-azure-blob-storage-driver.md)
 * — this uses the real `@azure/storage-blob` SDK instead of trying to force
 * Azure Blob into an S3-shaped client.
 */
export class AzureBlobStorageDriver implements StorageDriver {
  private readonly container: ContainerClient;
  private readonly publicBaseUrl: string;

  constructor(options: AzureBlobStorageDriverOptions) {
    const client = BlobServiceClient.fromConnectionString(options.connectionString);
    this.container = client.getContainerClient(options.container);
    this.publicBaseUrl = options.publicBaseUrl.replace(/\/+$/, '');
  }

  /**
   * Idempotent — safe to call on every worker start; a container that
   * already exists is a no-op, not an error.
   *
   * Public blob-level read access, not just container metadata: HLS
   * segments/manifests for a PUBLIC-visibility stream are meant to be
   * fetched anonymously by any viewer's player, the same as any public
   * CDN-fronted asset. This is not a general-purpose bucket — it holds
   * nothing but this container's own HLS output — so there is no
   * unrelated data to accidentally expose. Backend-core v1 scope does not
   * yet differentiate PRIVATE/AUTHENTICATED-visibility streams' storage
   * access (see docs/architecture/cdn-hls-egress-scope.md's follow-up
   * notes) — every BROADCAST stream's output is public-readable for now.
   */
  async ensureContainer(): Promise<void> {
    await this.container.createIfNotExists({ access: 'blob' });
  }

  async upload(key: string, body: Buffer, contentType: string): Promise<void> {
    const blockBlob = this.container.getBlockBlobClient(key);
    await blockBlob.uploadData(body, { blobHTTPHeaders: { blobContentType: contentType } });
  }

  async deletePrefix(prefix: string): Promise<void> {
    for await (const blob of this.container.listBlobsFlat({ prefix })) {
      await this.container.deleteBlob(blob.name).catch(() => undefined);
    }
  }

  publicUrlFor(key: string): string {
    return `${this.publicBaseUrl}/${key}`;
  }
}
