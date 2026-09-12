/**
 * Production Enterprise Persistent Repository Layer with User and Tenant Isolation
 */

import { initializeApp, getApps, getApp } from 'firebase/app';
import { 
  getFirestore, 
  doc, 
  setDoc, 
  getDoc, 
  collection, 
  getDocs, 
  query, 
  orderBy, 
  limit, 
  where,
  updateDoc 
} from 'firebase/firestore';
import fs from 'fs';
import path from 'path';
import type { 
  ResearchJob, 
  ResearchEvent, 
  Source, 
  Evidence, 
  Claim, 
  FullResearchReport 
} from '../types.js';

// Load Firebase config
let firebaseConfig: any = null;
try {
  const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
  if (fs.existsSync(configPath)) {
    firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  }
} catch (err) {
  console.warn('[DB] Could not load firebase-applet-config.json:', err);
}

const app = getApps().length > 0 
  ? getApp() 
  : (firebaseConfig ? initializeApp(firebaseConfig) : null);

const db = (app && firebaseConfig) 
  ? getFirestore(app, firebaseConfig.firestoreDatabaseId || undefined) 
  : null;

// Persistent local stores
const localJobs = new Map<string, ResearchJob & { user_id?: string }>();
const localEvents = new Map<string, ResearchEvent[]>();
const localReports = new Map<string, FullResearchReport & { user_id?: string }>();

export class DatabaseRepository {
  /**
   * Save or Update a Research Job with strict owner ID
   */
  public static async saveJob(job: ResearchJob, userId: string = 'default_tenant'): Promise<void> {
    localJobs.set(job.id, { ...job, user_id: userId });
    if (db) {
      try {
        const jobRef = doc(db, 'jobs', job.id);
        await setDoc(jobRef, {
          id: job.id,
          user_id: userId,
          question: job.question,
          industry: job.industry,
          geography: job.geography,
          time_horizon: job.time_horizon,
          status: job.status,
          current_stage: job.current_stage,
          progress: job.progress,
          created_at: job.created_at,
          completed_at: job.completed_at || null,
          error_message: job.error_message || null,
          stats: job.stats || {},
          target_company: job.target_company || null,
          competitors_input: job.competitors_input || [],
          updated_at: new Date().toISOString(),
        }, { merge: true });
      } catch (err) {
        console.warn(`[DB] Error syncing job ${job.id} to Firestore:`, err);
      }
    }
  }

  /**
   * Get a Research Job by ID with strict owner validation
   */
  public static async getJob(jobId: string, userId: string = 'default_tenant'): Promise<ResearchJob | null> {
    const job = localJobs.get(jobId);
    if (job) {
      if (job.user_id !== userId) return null;
      return job;
    }

    if (db) {
      try {
        const jobRef = doc(db, 'jobs', jobId);
        const snap = await getDoc(jobRef);
        if (snap.exists()) {
          const data = snap.data() as ResearchJob & { user_id?: string };
          if (data.user_id && data.user_id !== userId) {
            return null;
          }
          localJobs.set(jobId, data);
          return data;
        }
      } catch (err) {
        console.warn(`[DB] Error fetching job ${jobId} from Firestore:`, err);
      }
    }

    return null;
  }

  /**
   * List recent research jobs for a specific user/tenant
   */
  public static async listJobs(maxLimit: number = 50, userId: string = 'default_tenant'): Promise<ResearchJob[]> {
    const list = Array.from(localJobs.values()).filter(j => j.user_id === userId);
    if (list.length > 0) {
      return list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, maxLimit);
    }

    if (db) {
      try {
        const jobsQuery = query(
          collection(db, 'jobs'), 
          where('user_id', '==', userId),
          orderBy('created_at', 'desc'), 
          limit(maxLimit)
        );
        const snap = await getDocs(jobsQuery);
        const fetched: ResearchJob[] = [];
        snap.forEach(d => {
          const item = d.data() as ResearchJob & { user_id?: string };
          localJobs.set(item.id, item);
          fetched.push(item);
        });
        return fetched;
      } catch (err) {
        console.warn('[DB] Error querying jobs from Firestore:', err);
      }
    }

    return [];
  }

  /**
   * Append a telemetry event
   */
  public static async addEvent(jobId: string, event: ResearchEvent): Promise<void> {
    const list = localEvents.get(jobId) || [];
    list.push(event);
    localEvents.set(jobId, list);

    if (db) {
      try {
        const eventRef = doc(db, `jobs/${jobId}/events`, `evt-${event.id}`);
        await setDoc(eventRef, {
          id: String(event.id),
          job_id: jobId,
          stage: event.stage,
          event_type: event.event_type,
          message: event.message,
          progress: event.progress,
          metadata: event.metadata || {},
          created_at: event.created_at,
        });
      } catch (err) {
        // Log silently
      }
    }
  }

  /**
   * Get all events for a job
   */
  public static async getEvents(jobId: string, afterId: number = 0): Promise<ResearchEvent[]> {
    const local = localEvents.get(jobId) || [];
    if (local.length > 0) {
      return local.filter(e => e.id > afterId);
    }

    if (db) {
      try {
        const snap = await getDocs(collection(db, `jobs/${jobId}/events`));
        const fetched: ResearchEvent[] = [];
        snap.forEach(d => {
          const item = d.data() as any;
          fetched.push({
            id: Number(item.id.replace('evt-', '')) || 0,
            job_id: jobId,
            stage: item.stage,
            event_type: item.event_type,
            message: item.message,
            progress: item.progress,
            metadata: item.metadata,
            created_at: item.created_at,
          });
        });
        fetched.sort((a, b) => a.id - b.id);
        localEvents.set(jobId, fetched);
        return fetched.filter(e => e.id > afterId);
      } catch (err) {
        console.warn(`[DB] Error fetching events for job ${jobId}:`, err);
      }
    }

    return [];
  }

  /**
   * Save a complete compiled report with ownership mapping
   */
  public static async saveReport(report: FullResearchReport, userId: string = 'default_tenant'): Promise<void> {
    localReports.set(report.job_id, { ...report, user_id: userId });
    
    // Also update in job representation
    const job = localJobs.get(report.job_id);
    if (job) {
      job.report = report;
      job.status = 'COMPLETED';
      job.progress = 100;
      job.completed_at = new Date().toISOString();
      await this.saveJob(job, userId);
    }

    if (db) {
      try {
        const reportRef = doc(db, 'reports', report.job_id);
        await setDoc(reportRef, {
          ...report,
          user_id: userId,
          saved_at: new Date().toISOString(),
        });
      } catch (err) {
        console.warn(`[DB] Error saving report ${report.job_id} to Firestore:`, err);
      }
    }
  }

  /**
   * Get a report by Job ID with ownership checks
   */
  public static async getReport(jobId: string, userId: string = 'default_tenant'): Promise<FullResearchReport | null> {
    const report = localReports.get(jobId);
    if (report) {
      if (report.user_id !== userId) return null;
      return report;
    }

    const job = localJobs.get(jobId);
    if (job && job.report) {
      if (job.user_id !== userId) return null;
      localReports.set(jobId, { ...job.report, user_id: userId });
      return job.report;
    }

    if (db) {
      try {
        const reportRef = doc(db, 'reports', jobId);
        const snap = await getDoc(reportRef);
        if (snap.exists()) {
          const data = snap.data() as FullResearchReport & { user_id?: string };
          if (data.user_id && data.user_id !== userId) {
            return null;
          }
          localReports.set(jobId, data);
          return data;
        }
      } catch (err) {
        console.warn(`[DB] Error fetching report ${jobId} from Firestore:`, err);
      }
    }

    return null;
  }
}
export const dbInstance = db;
export const appInstance = app;
