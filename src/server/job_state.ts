/**
 * Real Cancellation State Machine & Lease-Aware Job Lifecycle
 *
 * Hardening contract:
 * - Job status transitions are constrained by an explicit state machine.
 *   Illegal transitions (e.g. CANCELLED -> COMPLETED) are impossible.
 * - A process-wide CancellationRegistry owns the AbortController for every
 *   in-flight job so that a user cancel request produces a REAL AbortSignal
 *   inside the running pipeline worker (no DB-polling guesswork).
 * - USER_CANCEL is sticky per jobId: if cancellation is requested before a
 *   worker registers (race), the worker aborts immediately on registration.
 * - LEASE_LOST is NOT sticky: when a lease expires and another worker claims
 *   the job, the new owner legitimately re-registers the same jobId.
 */

export type QueueExecutionStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export const TERMINAL_JOB_STATUSES: readonly QueueExecutionStatus[] = ['COMPLETED', 'FAILED', 'CANCELLED'];

/**
 * Stage-prefixed statuses (PLANNING..GENERATING_REPORT) are execution states
 * and are normalized to RUNNING for transition checking.
 */
export function normalizeStatus(status: string): QueueExecutionStatus {
  if (status === 'QUEUED') return 'QUEUED';
  if (status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED') return status;
  return 'RUNNING';
}

const ALLOWED_TRANSITIONS: Record<QueueExecutionStatus, readonly QueueExecutionStatus[]> = {
  QUEUED: ['RUNNING', 'CANCELLED'],
  RUNNING: ['COMPLETED', 'FAILED', 'CANCELLED'],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
};

export function canTransition(from: string, to: string): boolean {
  const f = normalizeStatus(from);
  const t = normalizeStatus(to);
  return ALLOWED_TRANSITIONS[f].includes(t);
}

export function assertTransition(from: string, to: string): void {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal job state transition: ${from} -> ${to}`);
  }
}

export type AbortReason = 'USER_CANCEL' | 'LEASE_LOST';

interface CancellationEntry {
  controller: AbortController;
  workerId?: string;
  reason?: AbortReason;
  requestedAt?: string;
}

/**
 * Process-wide registry of in-flight AbortControllers keyed by jobId.
 */
export class CancellationRegistry {
  private entries = new Map<string, CancellationEntry>();

  /**
   * Registers the AbortController backing a running worker for a job.
   * If USER_CANCEL was requested before registration (race), the supplied
   * controller is aborted immediately so the worker never starts doing work.
   * If the previous entry was a LEASE_LOST abort, the new owner may proceed.
   */
  public register(jobId: string, controller: AbortController, workerId?: string): void {
    const existing = this.entries.get(jobId);
    if (existing && existing.reason === 'USER_CANCEL' && existing.controller.signal.aborted) {
      controller.abort();
      return;
    }
    this.entries.set(jobId, { controller, workerId });
  }

  /**
   * Requests abort for a job. Idempotent. For USER_CANCEL with no registered
   * worker yet, a sticky aborted marker is stored so late registration aborts.
   * Returns true if this call transitioned the registry into an aborted state.
   */
  public abort(jobId: string, reason: AbortReason): boolean {
    const existing = this.entries.get(jobId);
    if (existing?.controller.signal.aborted) {
      return false;
    }
    if (existing) {
      existing.reason = reason;
      existing.requestedAt = new Date().toISOString();
      existing.controller.abort();
      return true;
    }
    if (reason === 'USER_CANCEL') {
      const controller = new AbortController();
      controller.abort();
      this.entries.set(jobId, {
        controller,
        reason,
        requestedAt: new Date().toISOString(),
      });
      return true;
    }
    return false;
  }

  public isAbortRequested(jobId: string): boolean {
    return this.entries.get(jobId)?.controller.signal.aborted === true;
  }

  public abortReason(jobId: string): AbortReason | null {
    return this.entries.get(jobId)?.reason ?? null;
  }

  public unregister(jobId: string, workerId?: string): void {
    const existing = this.entries.get(jobId);
    if (!existing) return;
    if (workerId && existing.workerId && existing.workerId !== workerId) return;
    this.entries.delete(jobId);
  }

  public clear(): void {
    this.entries.clear();
  }
}

export const cancellationRegistry = new CancellationRegistry();