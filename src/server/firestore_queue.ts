import { adminDb } from '../lib/firebase-admin.js';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';

export type QueueJob = {
    id: string;
    data: any;
    status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
    created_at: any;
    updated_at: any;
    leased_until?: any;
    worker_id?: string;
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
            // First recover stale running jobs whose lease expired
            await this.recoverStaleJobs();

            return await adminDb.runTransaction(async (transaction) => {
                const snap = await adminDb.collection(this.collectionName)
                    .where('status', '==', 'QUEUED')
                    .limit(10)
                    .get();

                if (snap.empty) return null;

                const docs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() as QueueJob }));
                docs.sort((a, b) => {
                    const ta = a.created_at?.toMillis ? a.created_at.toMillis() : 0;
                    const tb = b.created_at?.toMillis ? b.created_at.toMillis() : 0;
                    return ta - tb;
                });

                const target = docs[0];
                const jobRef = adminDb.collection(this.collectionName).doc(target.id);
                const freshDoc = await transaction.get(jobRef);

                if (!freshDoc.exists || freshDoc.data()?.status !== 'QUEUED') {
                    return null;
                }

                const leasedUntil = Timestamp.fromMillis(Date.now() + 3 * 60 * 1000); // 3 mins lease
                transaction.update(jobRef, {
                    status: 'RUNNING',
                    worker_id: workerId,
                    leased_until: leasedUntil,
                    updated_at: FieldValue.serverTimestamp(),
                });

                return {
                    ...freshDoc.data() as QueueJob,
                    id: target.id,
                    status: 'RUNNING',
                    worker_id: workerId,
                    leased_until: leasedUntil,
                };
            });
        } catch (err: any) {
            console.error('[Queue] Error claiming next job:', err);
            return null;
        }
    }

    async heartbeat(jobId: string, workerId: string) {
        try {
            const jobRef = adminDb.collection(this.collectionName).doc(jobId);
            const leasedUntil = Timestamp.fromMillis(Date.now() + 3 * 60 * 1000);
            await jobRef.update({
                leased_until: leasedUntil,
                updated_at: FieldValue.serverTimestamp(),
            });
        } catch (err) {
            console.error(`[Queue] Failed to heartbeat job ${jobId}:`, err);
        }
    }

    async recoverStaleJobs() {
        try {
            const now = Timestamp.now();
            const snap = await adminDb.collection(this.collectionName)
                .where('status', '==', 'RUNNING')
                .where('leased_until', '<', now)
                .get();

            if (!snap.empty) {
                const batch = adminDb.batch();
                snap.docs.forEach(doc => {
                    batch.update(doc.ref, {
                        status: 'QUEUED',
                        worker_id: null,
                        leased_until: null,
                        updated_at: FieldValue.serverTimestamp(),
                    });
                });
                await batch.commit();
                console.log(`[Queue] Recovered ${snap.size} stale running jobs back to QUEUED.`);
            }
        } catch (err) {
            console.error('[Queue] Error recovering stale jobs:', err);
        }
    }

    async updateJobStatus(jobId: string, status: 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED') {
        try {
            await adminDb.collection(this.collectionName).doc(jobId).update({
                status,
                updated_at: FieldValue.serverTimestamp()
            });
        } catch (err) {
            console.error(`[Queue] Error in updateJobStatus for ${jobId}:`, err);
            throw err;
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

    async cancel(jobId: string) {
        try {
            await adminDb.collection(this.collectionName).doc(jobId).update({
                status: 'CANCELLED',
                updated_at: FieldValue.serverTimestamp()
            });
        } catch (err) {
            console.error(`[Queue] Error cancelling job ${jobId}:`, err);
        }
    }
}
export const researchQueue = new FirestoreQueue();
