const apiURL = 'https://firebasestorage.googleapis.com/v0/';

// Metadata that can be set when uploading a blob.
export interface FirebaseUploadMetadata {
  cacheControl?: string;
  contentDisposition?: string;
  contentEncoding?: string;
  contentLanguage?: string;
  contentType?: string;
  customMetadata?: { [key: string]: string };
}

// Metadata associated with a stored blob.
export interface FirebaseStorageMetadata {
  name: string;
  bucket: string;
  generation: string;
  contentType: string;
  metageneration: string;
  timeCreated: string;
  updated: string;
  storageClass: string;
  size: string;
  md5Hash: string;
  contentEncoding: string;
  contentDisposition: string;
  crc32c: string;
  etag: string;
  downloadTokens: string;
}

// TokenSource is invoked for each API call to find if a token is available for
// Authorization. It should handle caching and refreshing it internally.
export interface FirebaseTokenSource {
  (): Promise<string | undefined>;
}

// Config to initialize a storage client.
export interface FirebaseStorageConfig {
  storageBucket: string;
  tokenSource: FirebaseTokenSource;
}

function makeURL(bucket: string, path: string): string {
  return `${apiURL}b/${bucket}/o/${encodeURIComponent(path)}`;
}

// Make a URL from Metadata to fetch the associated blob.
// This is useful say as an image URL.
export function downloadURL(data: FirebaseStorageMetadata): string {
  const token = data.downloadTokens.split(',')[0];
  //const query = objectToQuery({ alt: 'media', token });
  const url = makeURL(data.bucket, data.name);
  return `${url}?alt=media&token=${encodeURIComponent(token)}`;
}

// Storage Client to upload, retrieve and delete blobs.
export class FirebaseStorageClient {
  private tokenSource: FirebaseTokenSource;
  private bucket: string;

  constructor(config: FirebaseStorageConfig) {
    this.tokenSource = config.tokenSource;
    this.bucket = config.storageBucket;
  }

  private url(path: string): string {
    return makeURL(this.bucket, path);
  }

  private async fetch(url: string, init?: RequestInit): Promise<Response> {
    const request = new Request(url, init);
    const token = await this.tokenSource();
    if (token) {
      request.headers.set('Authorization', `Bearer ${token}`);
    }
    return await fetch(request);
  }

  public async upload(
    path: string,
    blob: Blob,
    metadata: FirebaseUploadMetadata = {},
  ): Promise<FirebaseStorageMetadata> {
    const res = await this.fetch(this.url(path), {
      method: 'post',
      body: JSON.stringify({
        ...metadata,
        name: path,
        contentType: blob.type,
      }),
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': blob.size.toString(),
        'X-Goog-Upload-Header-Content-Type': metadata.contentType ?? blob.type,
      },
    });

    const uploadURL = res.headers.get('x-goog-upload-url')!;
    const granularity = parseInt(
      res.headers.get('x-goog-upload-chunk-granularity')!,
      10,
    );

    let offset = 0;
    while (true) {
      const chunk = blob.slice(offset, offset + granularity);
      const isLastChunk = chunk.size < granularity;
      const res = await this.fetch(uploadURL, {
        method: 'post',
        headers: {
          'X-Goog-Upload-Offset': offset.toString(),
          'X-Goog-Upload-Command': isLastChunk ? 'upload, finalize' : 'upload',
        },
        body: chunk,
      });
      if (isLastChunk) {
        return await res.json();
      }
      offset += chunk.size;
    }
  }

  public async delete(path: string): Promise<void> {
    await this.fetch(this.url(path), { method: 'delete' });
  }

  public async metadata(path: string): Promise<FirebaseStorageMetadata> {
    const response = await this.fetch(this.url(path));
    return await response.json();
  }

  public async downloadURL(path: string): Promise<string> {
    return downloadURL(await this.metadata(path));
  }
}
