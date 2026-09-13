import { adminDb } from '../lib/firebase-admin.js';
import { FieldValue } from 'firebase-admin/firestore';

export type QueueJob = {
    id: string;
    data: any;
    status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED';
    created_at: any;
    updated_at: any;
};

export class FirestoreQueue {
    private collectionName = 'job_queue';

    async add(name: string, data: any) {
        return await adminDb.collection(this.collectionName).add({
            name,
            data,
            status: 'QUEUED',
            created_at: FieldValue.serverTimestamp(),
            updated_at: FieldValue.serverTimestamp(),
        });
    }

    async getNextJob() {
        try {
            const snap = await adminDb.collection(this.collectionName)
                .where('status', '==', 'QUEUED')
                .limit(20)
                .get();
            if (snap.empty) return null;
            const docs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() as QueueJob }));
            docs.sort((a, b) => {
                const ta = a.created_at?.toMillis ? a.created_at.toMillis() : 0;
                const tb = b.created_at?.toMillis ? b.created_at.toMillis() : 0;
                return ta - tb;
            });
            return docs[0];
        } catch (err: any) {
            if (err?.code === 5 || err?.message?.includes('NOT_FOUND') || err?.details?.includes('NOT_FOUND')) {
                // Collection or database not yet initialized/populated
                return null;
            }
            console.error('[Queue] Error in getNextJob:', err);
            return null;
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
