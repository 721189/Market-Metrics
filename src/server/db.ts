/**
 * Production Enterprise Persistent Repository Layer using Firebase Admin SDK (adminDb)
 */

import { adminDb } from '../lib/firebase-admin.js';
import { FieldValue } from 'firebase-admin/firestore';
import { logger } from './logger.js';
import { stripUndefined } from './firestore_sanitize.js';
import type { 
  ResearchJob, 
  ResearchEvent, 
  FullResearchReport 
} from '../types.js';

export class DatabaseRepository {
  public static async saveJob(job: ResearchJob, userId: string): Promise<void> {
    if (!userId) throw new Error('[DB] userId is required for saveJob');
    try {
      const jobRef = adminDb.collection('jobs').doc(job.id);
      await jobRef.set({
        ...stripUndefined(job),
        user_id: userId,
        updated_at: FieldValue.serverTimestamp(),
        // Optional job fields (target_company, competitors_input) are `undefined`
        // when the user leaves them blank. Firestore rejects `undefined` as a
        // value ("Cannot use undefined as a Firestore value"), which threw and
        // aborted job creation. stripUndefined drops those keys instead of
        // rejecting the whole document (SetOptions has no ignore-flag in v14).
      }, { merge: true });
    } catch (err) {
      logger.error('db.save_job_failed', `Error saving job ${job.id}`, {
        status: (err as Error)?.message || String(err),
      });
      throw err;
    }
  }

  /**
   * Atomically persist pipeline state only while the authoritative job remains
   * non-terminal. Stale worker snapshots cannot resurrect finished jobs.
   */
  public static async saveJobIfNonTerminal(job: ResearchJob, userId: string): Promise<boolean> {
    if (!userId) throw new Error('[DB] userId is required for saveJobIfNonTerminal');
    try {
      const jobRef = adminDb.collection('jobs').doc(job.id);
      return await adminDb.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(jobRef);
        if (snapshot.exists) {
          const existing = snapshot.data() as (ResearchJob & { user_id?: string }) | undefined;
          if (existing?.user_id && existing.user_id !== userId) {
            throw new Error('[DB] refusing to update a job owned by another user');
          }
          if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(String(existing?.status))) return false;
        }
        transaction.set(jobRef, stripUndefined({
          ...stripUndefined(job),
          user_id: userId,
          updated_at: FieldValue.serverTimestamp(),
        }), { merge: true });
        return true;
      });
    } catch (err) {
      logger.error('db.save_job_guarded_failed', 'Could not persist guarded job progress', {
        job_id: job.id,
        status: (err as Error)?.message || String(err),
      });
      throw err;
    }
  }

  public static async getJob(jobId: string, userId: string): Promise<ResearchJob | null> {
    if (!userId) throw new Error('[DB] userId is required for getJob');
    try {
      const docSnap = await adminDb.collection('jobs').doc(jobId).get();
      if (!docSnap.exists) return null;
      const data = docSnap.data() as ResearchJob & { user_id?: string };
      if (data.user_id && data.user_id !== userId) {
        return null;
      }
      return data;
    } catch (err) {
      logger.error('db.get_job_failed', `Error getting job ${jobId}`, {
        status: (err as Error)?.message || String(err),
      });
      return null;
    }
  }

  public static async listJobs(maxLimit: number = 50, userId: string): Promise<ResearchJob[]> {
    if (!userId) throw new Error('[DB] userId is required for listJobs');
    try {
      // No orderBy: `user_id ==` + `orderBy('created_at')` needs a composite
      // index, and without it Firestore throws FAILED_PRECONDITION — this
      // method then returned [] and the dashboard silently showed no history.
      // Sort a bounded page in memory instead (default indexes only).
      const snap = await adminDb.collection('jobs')
        .where('user_id', '==', userId)
        .limit(maxLimit)
        .get();

      const jobs: ResearchJob[] = [];
      snap.forEach(doc => {
        jobs.push(doc.data() as ResearchJob);
      });
      jobs.sort((a: any, b: any) => {
        const ta = a?.created_at ? new Date(a.created_at).getTime() : 0;
        const tb = b?.created_at ? new Date(b.created_at).getTime() : 0;
        return tb - ta;
      });
      return jobs;
    } catch (err) {
      logger.error('db.list_jobs_failed', 'Error listing jobs', {
        status: (err as Error)?.message || String(err),
      });
      return [];
    }
  }

  public static async addEvent(jobId: string, event: ResearchEvent): Promise<void> {
    try {
      const eventRef = adminDb.collection(`jobs/${jobId}/events`).doc(`evt-${event.id}`);
      await eventRef.set(stripUndefined({
        ...event,
        job_id: jobId,
        created_at: event.created_at || new Date().toISOString(),
        // `metadata` is optional on ResearchEvent; when absent it is `undefined`
        // and Firestore would reject the whole event. stripUndefined drops it.
      }));
    } catch (err) {
      logger.error('db.add_event_failed', `Error adding event to job ${jobId}`, {
        job_id: jobId,
        status: (err as Error)?.message || String(err),
      });
      throw err;
    }
  }

  public static async getEvents(jobId: string, afterSequence: number = 0): Promise<ResearchEvent[]> {
    try {
      const snap = await adminDb.collection(`jobs/${jobId}/events`).get();
      const events: ResearchEvent[] = [];
      snap.forEach(doc => {
        const item = doc.data() as any;
        if (!item) return;
        const seq = Number(item.sequence) || 0;
        if (seq > afterSequence) {
          events.push({
            ...item,
            id: String(item.id ?? doc.id),
          });
        }
      });
      events.sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
      return events;
    } catch (err) {
      logger.error('db.get_events_failed', `Error getting events for job ${jobId}`, {
        job_id: jobId,
        status: (err as Error)?.message || String(err),
      });
      return [];
    }
  }

  public static async saveReport(report: FullResearchReport, userId: string): Promise<void> {
    if (!userId) throw new Error('[DB] userId is required for saveReport');
    try {
      const reportRef = adminDb.collection('reports').doc(report.job_id);
      await reportRef.set({
        ...report,
        user_id: userId,
        saved_at: FieldValue.serverTimestamp(),
      });
    } catch (err) {
      logger.error('db.save_report_failed', `Error saving report ${report.job_id}`, {
        job_id: report.job_id,
        status: (err as Error)?.message || String(err),
      });
      throw err;
    }
  }

  public static async getReport(jobId: string, userId: string): Promise<FullResearchReport | null> {
    if (!userId) throw new Error('[DB] userId is required for getReport');
    try {
      const docSnap = await adminDb.collection('reports').doc(jobId).get();
      if (!docSnap.exists) return null;
      const data = docSnap.data() as FullResearchReport & { user_id?: string };
      if (data.user_id && data.user_id !== userId) {
        return null;
      }
      return data;
    } catch (err) {
      logger.error('db.get_report_failed', `Error getting report ${jobId}`, {
        job_id: jobId,
        status: (err as Error)?.message || String(err),
      });
      return null;
    }
  }

  /**
   * Permanently deletes a job and ALL of its persisted artifacts — the job
   * document, the compiled report, and the per-job telemetry event
   * subcollection. Tenant-scoped: ownership is verified through getJob (which
   * fails closed on a user_id mismatch), so one tenant can never delete
   * another's job. Returns false when the job does not exist or belongs to a
   * different tenant (so the caller cannot distinguish "missing" from "forbidden").
   */
  public static async deleteJob(jobId: string, userId: string): Promise<boolean> {
    if (!userId) throw new Error('[DB] userId is required for deleteJob');
    try {
      // Verify existence + ownership first (fail closed — never delete another
      // tenant's job). getJob already enforces the user_id check.
      const existing = await this.getJob(jobId, userId);
      if (!existing) return false;

      const batch = adminDb.batch();
      batch.delete(adminDb.collection('jobs').doc(jobId));
      batch.delete(adminDb.collection('reports').doc(jobId));

      // Events live in a subcollection; Firestore does not cascade-delete, so
      // remove them explicitly to avoid orphaning the job's telemetry.
      const eventsSnap = await adminDb.collection(`jobs/${jobId}/events`).get();
      eventsSnap.forEach(doc => batch.delete(doc.ref));

      await batch.commit();
      logger.info('db.job_deleted', `Deleted job ${jobId} and its artifacts`, {
        user_id: userId,
        events_removed: eventsSnap.size,
      });
      return true;
    } catch (err) {
      logger.error('db.delete_job_failed', `Error deleting job ${jobId}`, {
        user_id: userId,
        status: (err as Error)?.message || String(err),
      });
      throw err;
    }
  }
}
