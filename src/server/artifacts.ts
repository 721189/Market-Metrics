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

import { adminDb } from '../lib/firebase-admin.js';
import { getStorageInstance, getStorageBucket } from '../lib/firebase-admin.js';
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
  /** Storage reference for normalized text used by citation offsets. */
  normalized_text_ref?: string;
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
  /** Remove every raw and normalized artifact belonging to one job. */
  deleteJob(job_id: string): Promise<void>;
}

/**
 * In-memory artifact store for local development and tests.
 *
 * Not suitable for production durability or capacity, but it lets the
 * pipeline and tests exercise the artifact boundary without requiring a
 * real object storage provider.
 */
export class InMemoryArtifactStorage implements ArtifactStorage {
  readonly kind = 'memory';
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
  async deleteJob(job_id: string): Promise<void> {
    const prefix = `artifacts/${job_id}/`;
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) this.store.delete(key);
    }
    for (const key of this.textStore.keys()) {
      if (key.startsWith(prefix)) this.textStore.delete(key);
    }
  }

}

export function artifactRef(source_id: string, job_id: string, kind: 'raw' | 'normalized'): string {
  return `artifacts/${job_id}/${source_id}/${kind}`;
}



// ---------------------------------------------------------------------------
// Firestore / Firebase Storage-backed artifact store (production)
// ---------------------------------------------------------------------------
// Stores raw bytes and normalized text in Firebase Cloud Storage.
// Falls back to InMemoryArtifactStorage when STORAGE_BUCKET is not configured.
// ---------------------------------------------------------------------------

export class FirestoreArtifactStorage implements ArtifactStorage {
  readonly kind = 'firestore';

  constructor() {
    getStorageBucket();
    if (!getStorageBucket()) {
      throw new Error(
        '[FirestoreArtifactStorage] STORAGE_BUCKET is not configured for this environment. ' +
          'Set STORAGE_BUCKET (or FIREBASE_STORAGE_BUCKET) or run with InMemoryArtifactStorage.',
      );
    }
  }

  async putBlob(storageRef: string, contentType: string, bytes: Buffer): Promise<void> {
    const bucket = getStorageInstance();
    await bucket.file(storageRef).save(bytes, {
      contentType,
      metadata: {
        cacheControl: 'no-cache',
        metadata: {
          source_id: parseArtifactRef(storageRef)?.source_id || 'unknown',
          job_id: parseArtifactRef(storageRef)?.job_id || 'unknown',
          kind: parseArtifactRef(storageRef)?.kind || 'unknown',
        },
      },
    });
  }

  async putRaw(source_id: string, job_id: string, url: string, contentType: string, bytes: Buffer): Promise<string> {
    const ref = artifactRef(source_id, job_id, 'raw');
    await this.putBlob(ref, contentType, bytes);
    return ref;
  }

  async putNormalizedText(source_id: string, job_id: string, text: string): Promise<string> {
    const ref = artifactRef(source_id, job_id, 'normalized');
    await this.putBlob(ref, 'text/plain', Buffer.from(text, 'utf8'));
    return ref;
  }

  async getRaw(storageRef: string): Promise<Buffer | null> {
    try {
      const bucket = getStorageInstance();
      const file = bucket.file(storageRef);
      const [exists] = await file.getMetadata();
      if (!exists) return null;
      const [data] = await file.download();
      return Buffer.from(data);
    } catch {
      return null;
    }
  }

  async getNormalizedText(storageRef: string): Promise<string | null> {
    const raw = await this.getRaw(storageRef);
    if (!raw) return null;
    return raw.toString('utf8');
  }

  async delete(source_id: string, job_id: string): Promise<void> {
    try {
      const bucket = getStorageInstance();
      const rawRef = artifactRef(source_id, job_id, 'raw');
      const normRef = artifactRef(source_id, job_id, 'normalized');
      await Promise.all([
        bucket.file(rawRef).delete().catch(() => {}),
        bucket.file(normRef).delete().catch(() => {}),
      ]);
    } catch {
      // Best-effort cleanup.
    }
  }
  async deleteJob(job_id: string): Promise<void> {
    const bucket = getStorageInstance();
    const prefix = `artifacts/${job_id}/`;
    const [files] = await bucket.getFiles({ prefix });

    // Bound concurrency to avoid an unbounded burst against Cloud Storage.
    const concurrency = 40;
    for (let index = 0; index < files.length; index += concurrency) {
      const chunk = files.slice(index, index + concurrency);
      const results = await Promise.allSettled(
        chunk.map(file => file.delete({ ignoreNotFound: true })),
      );
      const failures = results.filter((result): result is PromiseRejectedResult =>
        result.status === 'rejected',
      );
      if (failures.length > 0) {
        throw new Error(
          `Artifact cleanup failed for job ${job_id}: ${failures.length} of ${chunk.length} object deletions failed. `
          + String(failures[0].reason?.message || failures[0].reason),
        );
      }
    }
  }

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

/**
 * Select an artifact backend without silently weakening production durability.
 * Local development and tests may use memory when Storage is not configured.
 * Staging/production must have a durable Cloud Storage bucket or fail the job.
 */
export function createArtifactStorage(
  env: NodeJS.ProcessEnv = process.env,
  durableFactory: () => ArtifactStorage = () => new FirestoreArtifactStorage(),
): ArtifactStorage {
  try {
    return durableFactory();
  } catch (error) {
    const appEnv = (env.APP_ENV || '').trim().toLowerCase();
    const nodeEnv = (env.NODE_ENV || '').trim().toLowerCase();
    const requiresDurability =
      appEnv === 'production' ||
      appEnv === 'staging' ||
      nodeEnv === 'production';

    if (requiresDurability) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        '[ArtifactStorage] Durable Cloud Storage is required in staging/production; refusing in-memory fallback. '
        + detail,
      );
    }
    return new InMemoryArtifactStorage();
  }
}
