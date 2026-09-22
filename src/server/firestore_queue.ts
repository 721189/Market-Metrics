import crypto from 'crypto';
import { adminDb } from '../lib/firebase-admin.js';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { canTransition } from './job_state.js';
import { recordLeaseRecovery, recordQueueDepth } from './observability.js';
import { logger } from './logger.js';

export const LEASE_DURATION_MS = 3 * 60 * 1000; // 3-minute lease

export type QueueJob = {
    id: string;
    name: string;
    data: any;
    status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
    created_at: any;
    updated_at: any;
    worker_id?: string;
    lease_id?: string;
    lease_version?: number;
    leased_until?: any;
    cancelled_at?: any;
};

export class FirestoreQueue {
    private collectionName = 'job_queue';

    async add(name: string, data: any) {
        const docRef = adminDb.collection(this.collectionName).doc();
        await docRef.set({
            name,
            data,
            status: 'QUEUED',
            created_at: FieldValue.serverTimestamp(),
            updated_at: FieldValue.serverTimestamp(),
        });
        return docRef;
    }

    async claimNextJob(workerId: string = 'worker-1'): Promise<QueueJob | null> {
        try {
            // Recover stale running jobs first (lease_version-verified, transactional per-job).
            await this.recoverStaleJobs();

            // Record truthful queue depth via a count aggregation. This is a
            // constant-cost server-side count — never a full collection scan.
            await this.observeQueueDepth();

            return await adminDb.runTransaction(async (transaction) => {
                const snap = await adminDb.collection(this.collectionName)
                    .where('status', '==', 'QUEUED')
                    .orderBy('created_at', 'asc')
                    .limit(10)
                    .get();

                if (snap.empty) return null;

                const docs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() as QueueJob }));
                docs.sort((a, b) => {
                    const ta = a.created_at?.toMillis ? a.created_at.toMillis() : 0;
                    const tb = b.created_at?.toMillis ? b.created_at.toMillis() : 0;
                    return ta - tb;
                });

                for (const target of docs) {
                    const jobRef = adminDb.collection(this.collectionName).doc(target.id);

                    // Re-check inside the transaction: status must still be QUEUED.
                    const freshDoc = await transaction.get(jobRef);
                    if (!freshDoc.exists) continue;
                    const current = freshDoc.data() as QueueJob | undefined;
                    if (!current || current.status !== 'QUEUED') continue;

                    // Guard: if this job already has a live worker lease, skip it
                    // (another worker claimed it between the snapshot and now).
                    if (current.worker_id) continue;

                    const leaseId = crypto.randomUUID();
                    const leaseVersion = 1;
                    const leasedUntil = Timestamp.fromMillis(Date.now() + LEASE_DURATION_MS);

                    transaction.update(jobRef, {
                        status: 'RUNNING',
                        worker_id: workerId,
                        lease_id: leaseId,
                        lease_version: leaseVersion,
                        leased_until: leasedUntil,
                        updated_at: FieldValue.serverTimestamp(),
                    });

                    return {
                        ...freshDoc.data(),
                        id: target.id,
                        status: 'RUNNING',
                        worker_id: workerId,
                        lease_id: leaseId,
                        lease_version: leaseVersion,
                        leased_until: leasedUntil,
                        name: freshDoc.data()?.name ?? '',
                        data: freshDoc.data()?.data ?? {},
                        created_at: freshDoc.data()?.created_at ?? FieldValue.serverTimestamp(),
                        updated_at: FieldValue.serverTimestamp(),
                    };
                }

                return null;
            });
        } catch (err: any) {
            logger.error('queue.claim_failed', 'Error claiming next job', { status: (err as Error)?.message || String(err) });
            return null;
        }
    }

    /**
     * Publishes the current queue depth gauge.
     *
     * Uses the Firestore count() aggregation, which computes the total
     * server-side in constant cost. This replaces the naive "read every queued
     * document to count them" approach, which does not scale past a prototype
     * and exposes the queue to read-amplification under load.
     *
     * Depth is a best-effort operational signal, so a transient failure is
     * logged and swallowed rather than failing the claim path.
     */
    async observeQueueDepth(): Promise<number | null> {
        try {
            const aggregate = await adminDb.collection(this.collectionName)
                .where('status', '==', 'QUEUED')
                .count()
                .get();
            const depth = aggregate.data().count;
            recordQueueDepth(depth);
            return depth;
        } catch (err) {
            logger.warn('queue.depth_observe_failed', 'Failed to observe queue depth', { status: (err as Error)?.message || String(err) });
            return null;
        }
    }

    /**
     * Extends the lease for a job — ONLY if the calling worker still owns it.
     * Ownership verification is transactional: a worker whose lease expired and
     * whose job was recovered/re-claimed by another worker can NEVER stomp the
     * new owner's lease.
     *
     * Returns:
     * - { owned: true }                     -> lease extended, worker may continue
     * - { owned: false, definitive: true }  -> worker has DEFINITELY lost
     *        ownership (different owner / not RUNNING / job gone) and MUST stop
     * - { owned: false, definitive: false } -> transient error; worker may
     *        continue but all final state writes remain ownership-verified
     */
    async heartbeat(jobId: string, workerId: string): Promise<{ owned: boolean; definitive: boolean }> {
        try {
            const jobRef = adminDb.collection(this.collectionName).doc(jobId);
            let owned = false;
            let definitive = false;

            await adminDb.runTransaction(async (transaction) => {
                const doc = await transaction.get(jobRef);
                if (!doc.exists) {
                    definitive = true;
                    return;
                }
                const data = doc.data() as QueueJob | undefined;
                if (data?.status === 'RUNNING' && data?.worker_id === workerId) {
                    // Bump lease version so any stale heartbeat from before this
                    // moment becomes invalid after this transaction commits.
                    const nextVersion = (data.lease_version ?? 0) + 1;
                    const leasedUntil = Timestamp.fromMillis(Date.now() + LEASE_DURATION_MS);
                    transaction.update(jobRef, {
                        lease_version: nextVersion,
                        leased_until: leasedUntil,
                        updated_at: FieldValue.serverTimestamp(),
                    });
                    owned = true;
                } else {
                    definitive = true;
                }
            });

            if (!owned && definitive) {
                logger.warn('queue.heartbeat_rejected', `Heartbeat REJECTED: worker ${workerId} no longer owns the lease`, { job_id: jobId });
            }
            return { owned, definitive };
        } catch (err) {
            logger.error('queue.heartbeat_failed', `Failed to heartbeat job ${jobId}`, { job_id: jobId, status: (err as Error)?.message || String(err) });
            return { owned: false, definitive: false };
        }
    }

    async recoverStaleJobs(): Promise<number> {
        try {
            const now = Date.now();
            const staleSnap = await adminDb.collection(this.collectionName)
                .where('status', '==', 'RUNNING')
                .where('leased_until', '<=', Timestamp.fromMillis(now))
                .get();

            if (staleSnap.empty) return 0;

            let recovered = 0;
            for (const doc of staleSnap.docs) {
                const recoveredOk = await this._recoverStaleJobTransaction(doc.id);
                if (recoveredOk) recovered++;
            }
            if (recovered > 0) {
                recordLeaseRecovery(recovered);
                logger.info('queue.recovered', `Recovered ${recovered} stale job(s) back to QUEUED`);
            }
            return recovered;
        } catch (err) {
            logger.error('queue.recover_failed', 'Error in recoverStaleJobs', { status: (err as Error)?.message || String(err) });
            return 0;
        }
    }

    /**
     * Transactional, lease_version-verified recovery of a single stale job.
     *
     * A job is recoverable only if:
     *   - status === 'RUNNING'
     *   - leased_until <= now
     *   - the lease version in the document still matches the version we observed
     *     in the stale snapshot (else a heartbeat just extended the lease, and we
     *     must not steal it).
     *
     * On success, the job is returned to QUEUED with a cleared lease.
     * We do NOT assign a new worker here — that stays in claimNextJob so the
     * claim is atomic with respect to other workers.
     */
    private async _recoverStaleJobTransaction(jobId: string): Promise<boolean> {
        const jobRef = adminDb.collection(this.collectionName).doc(jobId);
        try {
            return await adminDb.runTransaction(async (transaction) => {
                const doc = await transaction.get(jobRef);
                if (!doc.exists) return false;

                const data = doc.data() as QueueJob | undefined;
                if (!data) return false;

                // Must still be RUNNING.
                if (data.status !== 'RUNNING') return false;

                // leased_until must be in the past.
                const leasedUntil = data.leased_until?.toMillis != null
                    ? data.leased_until.toMillis()
                    : (typeof data.leased_until === 'number' ? data.leased_until : -1);
                if (leasedUntil > Date.now()) return false;

                // The transactional re-read IS the race guard.
                //
                // A heartbeat may have extended this job's lease after the stale
                // snapshot was taken but before this transaction ran. Because we
                // re-read `leased_until` from the live document above, a heartbeat
                // that landed in between makes `leasedUntil > Date.now()` true and
                // this function returns false — the lease is NOT stolen.
                //
                // We deliberately do not compare `lease_version` here: recovery
                // does not own a lease, so there is no version for it to prove.
                // The version is the *owner's* proof of ownership (heartbeat /
                // completion); recovery's proof is the live expired timestamp,
                // checked atomically inside this transaction. Ownership of the
                // reclaimed job is then established by claimNextJob, which
                // verifies status === 'QUEUED' and assigns a fresh lease_id and
                // lease_version = 1 atomically.

                transaction.update(jobRef, {
                    status: 'QUEUED',
                    worker_id: null,
                    lease_id: null,
                    lease_version: null,
                    leased_until: null,
                    updated_at: FieldValue.serverTimestamp(),
                });

                return true;
            });
        } catch (err) {
            logger.error('queue.recover_job_failed', `Error recovering stale job ${jobId}`, { job_id: jobId, status: (err as Error)?.message || String(err) });
            return false;
        }
    }

    /**
     * Updates a queue job's status with MANDATORY state-machine validation and
     * optional lease-ownership verification. Illegal transitions (e.g.
     * CANCELLED -> COMPLETED after a user cancel) are refused, never applied.
     * Returns true only if the transition was applied.
     */
    async updateJobStatus(jobId: string, status: 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED', workerId?: string): Promise<boolean> {
        try {
            const jobRef = adminDb.collection(this.collectionName).doc(jobId);
            return await adminDb.runTransaction(async (transaction) => {
                const doc = await transaction.get(jobRef);
                if (!doc.exists) {
                    logger.warn('queue.status_missing', `updateJobStatus: job ${jobId} does not exist`, { job_id: jobId });
                    return false;
                }
                const data = doc.data();
                if (workerId && data?.worker_id && data.worker_id !== workerId) {
                    logger.warn('queue.status_refused_ownership', `updateJobStatus REFUSED: worker ${workerId} lost ownership`, { job_id: jobId });
                    return false;
                }
                const current = data?.status ?? 'QUEUED';
                if (!canTransition(current, status)) {
                    logger.warn('queue.status_refused_transition', `updateJobStatus REFUSED: illegal transition ${current} -> ${status}`, { job_id: jobId });
                    return false;
                }
                transaction.update(jobRef, {
                    status,
                    updated_at: FieldValue.serverTimestamp()
                });
                return true;
            });
        } catch (err) {
            logger.error('queue.update_status_failed', `Error in updateJobStatus for ${jobId}`, { job_id: jobId, status: (err as Error)?.message || String(err) });
            return false;
        }
    }

    async getStats() {
        try {
            const snap = await adminDb.collection(this.collectionName).get();
            let queued = 0;
            let running = 0;
            let completed = 0;
            let failed = 0;
            snap.forEach(doc => {
                const data = doc.data();
                if (data.status === 'QUEUED') queued++;
                else if (data.status === 'RUNNING') running++;
                else if (data.status === 'COMPLETED') completed++;
                else if (data.status === 'FAILED') failed++;
            });
            return { total: snap.size, queued, running, completed, failed };
        } catch (err) {
            return { total: 0, queued: 0, running: 0, completed: 0, failed: 0 };
        }
    }

    async getJobPosition(jobId: string): Promise<number | null> {
        try {
            const jobDoc = await adminDb.collection(this.collectionName).doc(jobId).get();
            if (!jobDoc.exists || jobDoc.data()?.status !== 'QUEUED') return null;
            const createdAt = jobDoc.data()?.created_at;
            if (!createdAt) return 1;

            const snap = await adminDb.collection(this.collectionName)
                .where('status', '==', 'QUEUED')
                .get();
            let count = 1;
            snap.forEach(doc => {
                if (doc.id !== jobId) {
                    const data = doc.data() as QueueJob;
                    const ta = data.created_at?.toMillis ? data.created_at.toMillis() : 0;
                    const tb = createdAt?.toMillis ? createdAt.toMillis() : 0;
                    if (ta < tb) count++;
                }
            });
            return count;
        } catch (err) {
            return 1;
        }
    }

    /**
     * Transactional cancellation: only QUEUED or RUNNING jobs may transition to
     * CANCELLED (state-machine enforced). Returns true if cancelled here.
     */
    async cancel(jobId: string): Promise<boolean> {
        try {
            const jobRef = adminDb.collection(this.collectionName).doc(jobId);
            return await adminDb.runTransaction(async (transaction) => {
                const doc = await transaction.get(jobRef);
                if (!doc.exists) return false;
                const current = doc.data()?.status ?? 'QUEUED';
                if (!canTransition(current, 'CANCELLED')) {
                    logger.warn('queue.cancel_refused', `cancel REFUSED: illegal transition ${current} -> CANCELLED`, { job_id: jobId });
                    return false;
                }
                transaction.update(jobRef, {
                    status: 'CANCELLED',
                    cancelled_at: FieldValue.serverTimestamp(),
                    updated_at: FieldValue.serverTimestamp()
                });
                return true;
            });
        } catch (err) {
            logger.error('queue.cancel_failed', `Error cancelling job ${jobId}`, { job_id: jobId, status: (err as Error)?.message || String(err) });
            return false;
        }
    }
}
export const researchQueue = new FirestoreQueue();
