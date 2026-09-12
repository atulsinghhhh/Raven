import { AzureBlobStorageDriver } from '../src/storage/azure-blob-storage-driver.js';

describe('AzureBlobStorageDriver', () => {
  // No real Azure/Azurite connection needed for these — BlobServiceClient's
  // constructor only parses the connection string, it never connects
  // eagerly. Real upload/container behavior is exercised against Azurite
  // in the local end-to-end run, not here.
  const CONNECTION_STRING =
    'DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;' +
    'AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;' +
    'BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;';

  it('builds a public URL by joining the base URL and key', () => {
    const driver = new AzureBlobStorageDriver({
      connectionString: CONNECTION_STRING,
      container: 'live-hls',
      publicBaseUrl: 'https://cdn.example.com/live-hls',
    });

    expect(driver.publicUrlFor('stream_abc123/index.m3u8')).toBe(
      'https://cdn.example.com/live-hls/stream_abc123/index.m3u8',
    );
  });

  it('strips a trailing slash from the configured base URL so a key never doubles up', () => {
    const driver = new AzureBlobStorageDriver({
      connectionString: CONNECTION_STRING,
      container: 'live-hls',
      publicBaseUrl: 'https://cdn.example.com/live-hls/',
    });

    expect(driver.publicUrlFor('stream_abc123/index.m3u8')).toBe(
      'https://cdn.example.com/live-hls/stream_abc123/index.m3u8',
    );
  });
});
