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

// The in-progress state of an upload.
export interface FirebaseUploadState {
  uploadURL: string;
  granularity: number;
  offset: number;
}

// Indicates the type of result when uploading chunks.
export type FirebaseUploadChunkResult =
  | { type: 'continue'; state: FirebaseUploadState }
  | { type: 'finish'; metadata: FirebaseStorageMetadata };

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

  // Start the upload process.
  public async uploadStart(
    path: string,
    blob: Blob,
    metadata: FirebaseUploadMetadata = {},
  ): Promise<FirebaseUploadState> {
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
    return {
      // expect this to be in the response
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      uploadURL: res.headers.get('x-goog-upload-url')!,
      granularity: parseInt(
        // expect this to be in the response
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        res.headers.get('x-goog-upload-chunk-granularity')!,
        10,
      ),
      offset: 0,
    };
  }

  // Upload a chunk and return the new state or final metadata.
  public async uploadChunk(
    state: FirebaseUploadState,
    blob: Blob,
  ): Promise<FirebaseUploadChunkResult> {
    const chunk = blob.slice(state.offset, state.offset + state.granularity);
    const isLastChunk = chunk.size < state.granularity;
    const res = await this.fetch(state.uploadURL, {
      method: 'post',
      headers: {
        'X-Goog-Upload-Offset': state.offset.toString(),
        'X-Goog-Upload-Command': isLastChunk ? 'upload, finalize' : 'upload',
      },
      body: chunk,
    });
    if (isLastChunk) {
      return {
        type: 'finish',
        metadata: await res.json(),
      };
    }
    return {
      type: 'continue',
      state: {
        ...state,
        offset: state.offset + chunk.size,
      },
    };
  }

  // Start an upload, send all the cunks and finalize it.
  public async upload(
    path: string,
    blob: Blob,
    metadata: FirebaseUploadMetadata = {},
  ): Promise<FirebaseStorageMetadata> {
    let state = await this.uploadStart(path, blob, metadata);
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const result = await this.uploadChunk(state, blob);
      if (result.type === 'finish') {
        return result.metadata;
      }
      state = result.state;
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
