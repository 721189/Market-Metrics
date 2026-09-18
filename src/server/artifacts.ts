/**
 * Raw artifact persistence boundary.
 *
 * Large fetched artifacts (raw HTML, raw PDF bytes, normalized text) should
 * live in object storage, not in Firestore. Firestore holds the structured
 * research graph and a lightweight reference + metadata for each artifact.
 *
 * This module defines the interface and a no-op / in-memory implementation
 * suitable for local development and tests. Production should plug in a real
 * object storage backend (S3, GCS, etc.).
 */

export interface RetrievalArtifact {
  source_id: string;
  job_id: string;
  url: string;
  retrieved_at: string;
  parser_version: string;
  normalizer_version: string;
  content_type: string;
  content_hash: string;
  raw_size_bytes: number;
  normalized_text_size_bytes: number;
  storage_ref: string; // provider-specific key / URI for the raw blob
  raw_available: boolean;
  normalized_text_available: boolean;
}

export interface ArtifactStorage {
  /**
   * Store the raw bytes for a fetched document. Returns a storage reference
   * (key/URI) that can be used to retrieve it later.
   */
  putRaw(source_id: string, job_id: string, url: string, contentType: string, bytes: Buffer): Promise<string>;

  /**
   * Store normalized text for a fetched document.
   */
  putNormalizedText(source_id: string, job_id: string, text: string): Promise<string>;

  /**
   * Retrieve raw bytes by storage reference.
   */
  getRaw(storageRef: string): Promise<Buffer | null>;

  /**
   * Retrieve normalized text by storage reference.
   */
  getNormalizedText(storageRef: string): Promise<string | null>;

  /**
   * Delete an artifact (for cleanup / retention policies).
   */
  delete(source_id: string, job_id: string): Promise<void>;
}

/**
 * In-memory artifact store for local development and tests.
 *
 * Not suitable for production durability or capacity, but it lets the
 * pipeline and tests exercise the artifact boundary without requiring a
 * real object storage provider.
 */
export class InMemoryArtifactStorage implements ArtifactStorage {
  private readonly store = new Map<string, Buffer>();
  private readonly textStore = new Map<string, string>();

  putRaw(source_id: string, job_id: string, url: string, contentType: string, bytes: Buffer): Promise<string> {
    const ref = artifactRef(source_id, job_id, 'raw');
    this.store.set(ref, bytes);
    return Promise.resolve(ref);
  }

  putNormalizedText(source_id: string, job_id: string, text: string): Promise<string> {
    const ref = artifactRef(source_id, job_id, 'normalized');
    this.textStore.set(ref, text);
    return Promise.resolve(ref);
  }

  getRaw(storageRef: string): Promise<Buffer | null> {
    return Promise.resolve(this.store.get(storageRef) || null);
  }

  getNormalizedText(storageRef: string): Promise<string | null> {
    return Promise.resolve(this.textStore.get(storageRef) || null);
  }

  delete(source_id: string, job_id: string): Promise<void> {
    const rawRef = artifactRef(source_id, job_id, 'raw');
    const textRef = artifactRef(source_id, job_id, 'normalized');
    this.store.delete(rawRef);
    this.textStore.delete(textRef);
    return Promise.resolve();
  }
}

export function artifactRef(source_id: string, job_id: string, kind: 'raw' | 'normalized'): string {
  return `artifacts/${job_id}/${source_id}/${kind}`;
}

export function parseArtifactRef(ref: string): { job_id: string; source_id: string; kind: string } | null {
  // artifacts/{job_id}/{source_id}/{kind}
  const parts = ref.split('/');
  if (parts.length >= 4 && parts[0] === 'artifacts') {
    return {
      job_id: parts[1],
      source_id: parts[2],
      kind: parts[3],
    };
  }
  return null;
}
