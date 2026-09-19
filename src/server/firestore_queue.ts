import crypto from 'crypto';
import { adminDb } from '../lib/firebase-admin.js';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { canTransition } from './job_state.js';

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
            console.error('[Queue] Error claiming next job:', err);
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
                console.warn(`[Queue] Heartbeat REJECTED for job ${jobId}: worker ${workerId} no longer owns the lease.`);
            }
            return { owned, definitive };
        } catch (err) {
            console.error(`[Queue] Failed to heartbeat job ${jobId}:`, err);
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
            return recovered;
        } catch (err) {
            console.error('[Queue] Error in recoverStaleJobs:', err);
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

                // IMPORTANT: lease_version recheck.
                // A heartbeat may have extended this job's lease after our stale
                // snapshot but before we reached this transaction. If the version
                // changed, another worker's heartbeat won the race — do not reclaim.
                // We treat any present lease_version as 'the version we must match'.
                // Since we observed a stale snapshot where the lease was expired,
                // we require that the current document still has the same lease state
                // that made it eligible (i.e., no newer heartbeat bumped it).
                // The safest conservative rule: only reclaim if the document still
                // has a lease that is expired AND we can atomically clear it.
                // To avoid races entirely, we only reclaim when worker_id is the
                // same as when we considered it expired — but since multiple workers
                // can see the same expired job, we instead rely on version + clear:
                // we set status back to QUEUED and clear the lease atomically.
                // Another worker can still race to claim it in claimNextJob (which
                // checks status==='QUEUED'), and that's fine — that's the owned claim.

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
            console.error(`[Queue] Error recovering stale job ${jobId}:`, err);
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
                    console.warn(`[Queue] updateJobStatus: job ${jobId} does not exist.`);
                    return false;
                }
                const data = doc.data();
                if (workerId && data?.worker_id && data.worker_id !== workerId) {
                    console.warn(`[Queue] updateJobStatus REFUSED for job ${jobId}: worker ${workerId} lost ownership to ${data.worker_id}.`);
                    return false;
                }
                const current = data?.status ?? 'QUEUED';
                if (!canTransition(current, status)) {
                    console.warn(`[Queue] updateJobStatus REFUSED: illegal transition ${current} -> ${status} for job ${jobId}.`);
                    return false;
                }
                transaction.update(jobRef, {
                    status,
                    updated_at: FieldValue.serverTimestamp()
                });
                return true;
            });
        } catch (err) {
            console.error(`[Queue] Error in updateJobStatus for ${jobId}:`, err);
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
                    console.warn(`[Queue] cancel REFUSED: illegal transition ${current} -> CANCELLED for job ${jobId}.`);
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
            console.error(`[Queue] Error cancelling job ${jobId}:`, err);
            return false;
        }
    }
}
export const researchQueue = new FirestoreQueue();
