/**
 * Production Enterprise Persistent Repository Layer using Firebase Admin SDK (adminDb)
 */

import { adminDb } from '../lib/firebase-admin.js';
import { FieldValue } from 'firebase-admin/firestore';
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
        ...job,
        user_id: userId,
        updated_at: FieldValue.serverTimestamp(),
      }, { merge: true });
    } catch (err) {
      console.error(`[DB] Error saving job ${job.id}:`, err);
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
      console.error(`[DB] Error getting job ${jobId}:`, err);
      return null;
    }
  }

  public static async listJobs(maxLimit: number = 50, userId: string): Promise<ResearchJob[]> {
    if (!userId) throw new Error('[DB] userId is required for listJobs');
    try {
      const snap = await adminDb.collection('jobs')
        .where('user_id', '==', userId)
        .orderBy('created_at', 'desc')
        .limit(maxLimit)
        .get();
      
      const jobs: ResearchJob[] = [];
      snap.forEach(doc => {
        jobs.push(doc.data() as ResearchJob);
      });
      return jobs;
    } catch (err) {
      console.error('[DB] Error listing jobs:', err);
      return [];
    }
  }

  public static async addEvent(jobId: string, event: ResearchEvent): Promise<void> {
    try {
      const eventRef = adminDb.collection(`jobs/${jobId}/events`).doc(`evt-${event.id}`);
      await eventRef.set({
        ...event,
        job_id: jobId,
        created_at: event.created_at || new Date().toISOString(),
      });
    } catch (err) {
      console.error(`[DB] Error adding event to job ${jobId}:`, err);
      throw err;
    }
  }

  public static async getEvents(jobId: string, afterId: number = 0): Promise<ResearchEvent[]> {
    try {
      const snap = await adminDb.collection(`jobs/${jobId}/events`).get();
      const events: ResearchEvent[] = [];
      snap.forEach(doc => {
        const item = doc.data() as any;
        const eventId = Number(String(item.id).replace('evt-', '')) || 0;
        if (eventId > afterId) {
          events.push({
            ...item,
            id: eventId,
          });
        }
      });
      events.sort((a, b) => a.id - b.id);
      return events;
    } catch (err) {
      console.error(`[DB] Error getting events for job ${jobId}:`, err);
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
      console.error(`[DB] Error saving report ${report.job_id}:`, err);
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
      console.error(`[DB] Error getting report ${jobId}:`, err);
      return null;
    }
  }
}
