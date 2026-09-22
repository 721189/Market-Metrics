/**
 * Short-lived single-use stream tickets for SSE.
 * ---------------------------------------------------------------------------
 * `EventSource` cannot attach `Authorization: Bearer` headers, and putting a
 * Firebase ID token in a query string leaks a long-lived credential into
 * access logs, browser history, and `Referer` headers — which the auth
 * middleware also explicitly rejects. The ticket indirection solves both:
 *
 *   authenticated POST /stream-ticket  ->  60s single-use ticket
 *   EventSource('/events?ticket=...')  ->  server consumes + maps to userId
 *
 * Tickets are stored HASHED (sha256) so a leaked Firestore read cannot yield a
 * usable ticket, are bound to (userId, jobId), expire in 60s, and are consumed
 * exactly once inside a transaction.
 */

import crypto from 'crypto';
import { adminDb } from '../lib/firebase-admin.js';
import { FieldValue } from 'firebase-admin/firestore';
import { logger } from './logger.js';

export interface IssuedTicket {
  ticket: string;
  expiresAt: string;
}

export interface ConsumedTicket {
  userId: string;
}

export interface StreamTicketStore {
  readonly kind: 'memory' | 'firestore';
  issue(jobId: string, userId: string, ttlMs: number): Promise<IssuedTicket>;
  /** Returns the bound user, or null when invalid/expired/already used. */
  consume(ticket: string, jobId: string): Promise<ConsumedTicket | null>;
}

const DEFAULT_TTL_MS = 60_000;
const COLLECTION = 'stream_tickets';

function hashTicket(ticket: string): string {
  return crypto.createHash('sha256').update(ticket).digest('hex');
}

function newTicket(): string {
  return crypto.randomBytes(32).toString('hex');
}

export class InMemoryStreamTicketStore implements StreamTicketStore {
  readonly kind = 'memory' as const;
  private readonly tickets = new Map<string, { userId: string; jobId: string; expiresAt: number; used: boolean }>();

  async issue(jobId: string, userId: string, ttlMs: number): Promise<IssuedTicket> {
    const ticket = newTicket();
    const expiresAt = Date.now() + ttlMs;
    this.tickets.set(hashTicket(ticket), { userId, jobId, expiresAt, used: false });
    return { ticket, expiresAt: new Date(expiresAt).toISOString() };
  }

  async consume(ticket: string, jobId: string): Promise<ConsumedTicket | null> {
    const key = hashTicket(ticket);
    const record = this.tickets.get(key);
    if (!record) return null;
    // A job-binding mismatch is rejected WITHOUT consuming the ticket: the
    // ticket belongs to a different job, so refusing it must not destroy the
    // legitimate stream it was minted for.
    if (record.jobId !== jobId) return null;
    // Single synchronous check-and-consume: no await between test and set.
    if (record.used || record.expiresAt <= Date.now()) {
      this.tickets.delete(key);
      return null;
    }
    record.used = true;
    this.tickets.delete(key);
    return { userId: record.userId };
  }
}

export class FirestoreStreamTicketStore implements StreamTicketStore {
  readonly kind = 'firestore' as const;

  async issue(jobId: string, userId: string, ttlMs: number): Promise<IssuedTicket> {
    if (!userId) throw new Error('[stream_tickets] userId is required to issue a ticket');
    const ticket = newTicket();
    const expiresAtMs = Date.now() + ttlMs;
    await adminDb.collection(COLLECTION).doc(hashTicket(ticket)).set({
      user_id: userId,
      job_id: jobId,
      expires_at_ms: expiresAtMs,
      used: false,
      created_at: FieldValue.serverTimestamp(),
    });
    return { ticket, expiresAt: new Date(expiresAtMs).toISOString() };
  }

  async consume(ticket: string, jobId: string): Promise<ConsumedTicket | null> {
    const ref = adminDb.collection(COLLECTION).doc(hashTicket(ticket));
    try {
      return await adminDb.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return null;
        const data = snap.data() as { user_id?: string; job_id?: string; expires_at_ms?: number; used?: boolean };
        // Job-binding mismatch: reject WITHOUT consuming, so a probe against the
        // wrong job cannot destroy the legitimate stream's ticket.
        if (data.job_id !== jobId) return null;
        if (
          data.used ||
          !data.user_id ||
          typeof data.expires_at_ms !== 'number' ||
          data.expires_at_ms <= Date.now()
        ) {
          // Used or expired tickets are removed (already-spent or unredeemable).
          tx.delete(ref);
          return null;
        }
        tx.update(ref, { used: true, used_at: FieldValue.serverTimestamp() });
        return { userId: data.user_id };
      });
    } catch (err) {
      // Fail closed: an unverifiable ticket never grants a stream.
      logger.error('stream_tickets.consume_failed', 'Ticket consumption failed closed', {
        status: (err as Error)?.message || String(err),
      });
      return null;
    }
  }
}

let store: StreamTicketStore | null = null;

/**
 * Production binds the Firestore store so a ticket minted by replica A is
 * consumable exactly once by replica B. Development/test use memory: ephemeral
 * tickets do not justify a database round-trip on every local run.
 */
export function getStreamTicketStore(): StreamTicketStore {
  if (store) return store;
  const explicit = (process.env.STREAM_TICKET_STORE || '').trim().toLowerCase();
  if (explicit === 'memory') {
    store = new InMemoryStreamTicketStore();
  } else if (explicit === 'firestore') {
    store = new FirestoreStreamTicketStore();
  } else if (explicit === 'redis') {
    throw new Error('[stream_tickets] STREAM_TICKET_STORE=redis is not provisioned. Use firestore.');
  } else if (process.env.NODE_ENV === 'production') {
    store = new FirestoreStreamTicketStore();
  } else {
    store = new InMemoryStreamTicketStore();
  }
  return store;
}

/** Test hook: swap the backing store without touching callers. */
export function __setStreamTicketStoreForTests(next: StreamTicketStore | null): void {
  store = next;
}

export const STREAM_TICKET_TTL_MS = DEFAULT_TTL_MS;
