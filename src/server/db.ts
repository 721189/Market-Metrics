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
      await jobRef.create({
        ...stripUndefined(job),
        user_id: userId,
        updated_at: FieldValue.serverTimestamp(),
        // Optional job fields (target_company, competitors_input) are `undefined`
        // when the user leaves them blank. Firestore rejects `undefined` as a
        // value ("Cannot use undefined as a Firestore value"), which threw and
        // aborted job creation. stripUndefined drops those keys instead of
        // rejecting the whole document (SetOptions has no ignore-flag in v14).
      });
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
      return await adminDb.runTransaction(async transaction => {
        const snapshot = await transaction.get(jobRef);

        // The job must have been created by the request path. A worker must
        // never turn a deleted/missing job back into a live document.
        if (!snapshot.exists) return false;

        const existing = snapshot.data() as (ResearchJob & {
          user_id?: string;
          deletion_requested_at?: unknown;
        }) | undefined;
        if (!existing?.user_id || existing.user_id !== userId) {
          throw new Error('[DB] refusing to update a job without an exact matching owner');
        }
        if (existing.deletion_requested_at) return false;
        if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(String(existing.status))) return false;

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
      const data = docSnap.data() as ResearchJob & { user_id?: string; deletion_requested_at?: unknown };
      // Missing ownership metadata and deletion tombstones are inaccessible.
      if (data.user_id !== userId || data.deletion_requested_at) return null;
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
      const snap = await adminDb.collection('jobs')
        .where('user_id', '==', userId)
        .limit(maxLimit)
        .get();

      const jobs: ResearchJob[] = [];
      snap.forEach(doc => {
        const data = doc.data() as ResearchJob & { deletion_requested_at?: unknown };
        if (!data.deletion_requested_at) jobs.push(data);
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

  public static async addEvent(jobId: string, event: ResearchEvent, userId: string): Promise<boolean> {
    if (!userId) throw new Error('[DB] userId is required for addEvent');
    try {
      const jobRef = adminDb.collection('jobs').doc(jobId);
      const eventRef = adminDb.collection(`jobs/${jobId}/events`).doc(`evt-${event.id}`);

      return await adminDb.runTransaction(async transaction => {
        const jobSnapshot = await transaction.get(jobRef);
        if (!jobSnapshot.exists) return false;

        const jobData = jobSnapshot.data() as { user_id?: string; deletion_requested_at?: unknown };
        if (!jobData?.user_id || jobData.user_id !== userId) {
          throw new Error('[DB] refusing to add an event without an exact matching owner');
        }
        if (jobData.deletion_requested_at) return false;

        transaction.set(eventRef, stripUndefined({
          ...event,
          job_id: jobId,
          created_at: event.created_at || new Date().toISOString(),
        }));
        return true;
      });
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
      const jobRef = adminDb.collection('jobs').doc(report.job_id);
      const reportRef = adminDb.collection('reports').doc(report.job_id);

      await adminDb.runTransaction(async transaction => {
        // Read the authoritative job and report before any writes. The deletion
        // marker serializes this write against an in-progress job deletion.
        const jobSnapshot = await transaction.get(jobRef);
        const reportSnapshot = await transaction.get(reportRef);

        if (!jobSnapshot.exists) {
          throw new Error('[DB] refusing to save a report for a missing job');
        }
        const jobData = jobSnapshot.data() as { user_id?: string; deletion_requested_at?: unknown };
        if (!jobData?.user_id || jobData.user_id !== userId) {
          throw new Error('[DB] refusing to save a report without an exact matching job owner');
        }
        if (jobData.deletion_requested_at) {
          throw new Error('[DB] refusing to save a report while its job is being deleted');
        }

        if (reportSnapshot.exists) {
          const existingUserId = reportSnapshot.get('user_id');
          if (!existingUserId || existingUserId !== userId) {
            throw new Error('[DB] refusing to overwrite a report without an exact matching owner');
          }
        }

        transaction.set(reportRef, {
          ...report,
          user_id: userId,
          saved_at: FieldValue.serverTimestamp(),
        }, { merge: true });
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
      const jobRef = adminDb.collection('jobs').doc(jobId);
      const reportRef = adminDb.collection('reports').doc(jobId);
      return await adminDb.runTransaction(async transaction => {
        const jobSnapshot = await transaction.get(jobRef);
        const reportSnapshot = await transaction.get(reportRef);
        if (!jobSnapshot.exists || !reportSnapshot.exists) return null;

        const jobData = jobSnapshot.data() as { user_id?: string; deletion_requested_at?: unknown };
        if (jobData?.user_id !== userId || jobData.deletion_requested_at) return null;

        const data = reportSnapshot.data() as FullResearchReport & { user_id?: string };
        if (data.user_id !== userId) return null;
        return data;
      });
    } catch (err) {
      logger.error('db.get_report_failed', `Error getting report ${jobId}`, {
        job_id: jobId,
        status: (err as Error)?.message || String(err),
      });
      return null;
    }
  }

  public static async deleteJob(jobId: string, userId: string): Promise<boolean> {
    if (!userId) throw new Error('[DB] userId is required for deleteJob');
    try {
      const jobRef = adminDb.collection('jobs').doc(jobId);
      const reportRef = adminDb.collection('reports').doc(jobId);

      // Mark first, atomically. saveJobIfNonTerminal/addEvent/saveReport all
      // read this same parent record and refuse writes after the marker. A
      // concurrent transaction either commits before the marker (and is
      // included in cleanup) or retries and observes the marker.
      const markedForDeletion = await adminDb.runTransaction(async transaction => {
        const snapshot = await transaction.get(jobRef);
        if (!snapshot.exists) return false;

        const existing = snapshot.data() as (ResearchJob & {
          user_id?: string;
          deletion_requested_at?: unknown;
        }) | undefined;
        if (!existing?.user_id || existing.user_id !== userId) return false;
        if (!(['COMPLETED', 'FAILED', 'CANCELLED'] as string[]).includes(String(existing.status))) {
          return false;
        }

        if (!existing.deletion_requested_at) {
          transaction.update(jobRef, {
            deletion_requested_at: FieldValue.serverTimestamp(),
            updated_at: FieldValue.serverTimestamp(),
          });
        }
        return true;
      });

      if (!markedForDeletion) return false;

      // Firestore batches are capped at 500 writes. Delete events in bounded
      // chunks so a long-running job cannot make permanent deletion impossible.
      const eventsSnap = await adminDb.collection(`jobs/${jobId}/events`).get();
      const eventDocs = eventsSnap.docs;
      const chunkSize = 450;
      for (let index = 0; index < eventDocs.length; index += chunkSize) {
        const batch = adminDb.batch();
        eventDocs.slice(index, index + chunkSize).forEach(doc => batch.delete(doc.ref));
        await batch.commit();
      }

      // Remove the report and parent last, after all event pages are gone.
      const finalBatch = adminDb.batch();
      finalBatch.delete(reportRef);
      finalBatch.delete(jobRef);
      await finalBatch.commit();

      logger.info('db.job_deleted', `Deleted job ${jobId} and its artifacts`, {
        user_id: userId,
        events_removed: eventDocs.length,
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
