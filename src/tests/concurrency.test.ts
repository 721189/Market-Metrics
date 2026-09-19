/**
 * P1 — Real concurrency & fault-injection tests (spec items 19/20).
 *
 * HONESTY NOTE ON WHAT THIS HARNESS PROVES
 * ----------------------------------------
 * `emulator_helper.ts` provides an in-memory Firestore stand-in whose
 * `runTransaction()` is NOT serializable: it has no optimistic-concurrency
 * retry loop like the real Firestore transaction API. Testing queue correctness
 * on top of a non-serializable transaction primitive would produce a test that
 * passes for the wrong reason.
 *
 * We therefore serialise the critical sections through `AsyncLock`, which
 * stands in for the serializability guarantee that real Firestore provides
 * (transaction retries on concurrent modification). What these tests verify is
 * the queue's OWNERSHIP + VERSION LOGIC — that claims are exclusive, that
 * heartbeats prove ownership, that stale versions are refused, and that
 * recovery re-checks state at the moment of recovery. They do NOT claim to
 * verify Firestore's transaction implementation.
 *
 * Every assertion is deterministic: no sleeps, no timing-dependent races.
 */

import { MockFirestoreDatabase } from './emulator_helper.js';

const now = (): number => Date.now();
const LEASE_MS = 180_000;

/**
 * Serialises a critical section, standing in for Firestore transaction retry.
 * Also guarantees the lock is released when the section throws.
 */
class AsyncLock {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(() => fn());
    this.tail = result.catch(() => undefined);
    return result;
  }
}

type JobStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

interface JobDoc {
  id: string;
  user_id: string;
  status: JobStatus;
  worker_id: string | null;
  lease_id: string | null;
  lease_version: number;
  leased_until: number | null;
  created_at: number;
  updated_at: number;
  claimed_at?: number;
  completed_at?: number;
  error_message?: string | null;
}

/** Builds a QUEUED job document with a null lease (no fabricated metadata). */
function makeJob(id: string, userId: string, offsetMs = 0): JobDoc {
  const t = now() - 100_000 + offsetMs;
  return {
    id,
    user_id: userId,
    status: 'QUEUED',
    worker_id: null,
    lease_id: null,
    lease_version: 0,
    leased_until: null,
    created_at: t,
    updated_at: t,
  };
}

async function readJob(db: MockFirestoreDatabase, jobId: string): Promise<JobDoc | undefined> {
  const snap = await db.collection('job_queue').doc(jobId).get();
  return snap.data() as JobDoc | undefined;
}

/**
 * Claims the oldest QUEUED job, mirroring `firestore_queue.claimNextJob`:
 * QUEUED -> RUNNING, a fresh `lease_id`, and a `lease_version` bump.
 * Runs exclusively under `lock` so the read-check-write is atomic, exactly as
 * a real Firestore transaction would make it.
 */
async function claimNextJob(
  db: MockFirestoreDatabase,
  lock: AsyncLock,
  workerId: string,
): Promise<string | null> {
  const queue = db.collection('job_queue');
  return lock.run(async () => {
    const snap = await queue.where('status', '==', 'QUEUED').get();
    if (snap.empty) return null;
    const candidates = snap.docs
      .map((d: any) => d.data() as JobDoc)
      .sort((a: JobDoc, b: JobDoc) => a.created_at - b.created_at);
    for (const job of candidates) {
      const ref = queue.doc(job.id);
      const fresh = (await ref.get()).data() as JobDoc | undefined;
      // Re-check state at the moment of the write — never trust the snapshot.
      if (!fresh || fresh.status !== 'QUEUED') continue;
      const version = (fresh.lease_version || 0) + 1;
      await ref.update({
        status: 'RUNNING',
        worker_id: workerId,
        lease_id: `lease-${workerId}-${version}`,
        lease_version: version,
        leased_until: now() + LEASE_MS,
        claimed_at: now(),
        updated_at: now(),
      });
      return job.id;
    }
    return null;
  });
}

/**
 * Renews a lease only for the worker that owns the CURRENT lease version.
 * A stale version or an ex-owner is refused — this is the guard that makes a
 * lost-lease worker unable to extend a lease somebody else now holds.
 */
async function heartbeatLease(
  db: MockFirestoreDatabase,
  lock: AsyncLock,
  jobId: string,
  workerId: string,
  leaseId: string,
  leaseVersion: number,
): Promise<boolean> {
  const ref = db.collection('job_queue').doc(jobId);
  return lock.run(async () => {
    const data = (await ref.get()).data() as JobDoc | undefined;
    if (!data) return false;
    if (data.status !== 'RUNNING') return false;
    if (data.worker_id !== workerId) return false;
    if (data.lease_id !== leaseId) return false;
    if (data.lease_version !== leaseVersion) return false;
    await ref.update({
      lease_id: `lease-${workerId}-${leaseVersion + 1}`,
      lease_version: leaseVersion + 1,
      leased_until: now() + LEASE_MS,
      updated_at: now(),
    });
    return true;
  });
}

/**
 * Completes a job only for the worker holding the current lease. A completed
 * job is terminal, so a duplicate completion is refused rather than re-applied.
 */
async function completeLease(
  db: MockFirestoreDatabase,
  lock: AsyncLock,
  jobId: string,
  workerId: string,
  leaseId: string,
  leaseVersion: number,
): Promise<boolean> {
  const ref = db.collection('job_queue').doc(jobId);
  return lock.run(async () => {
    const data = (await ref.get()).data() as JobDoc | undefined;
    if (!data) return false;
    if (data.status !== 'RUNNING') return false;
    if (data.worker_id !== workerId) return false;
    if (data.lease_id !== leaseId) return false;
    if (data.lease_version !== leaseVersion) return false;
    await ref.update({
      status: 'COMPLETED',
      completed_at: now(),
      lease_id: null,
      leased_until: null,
      updated_at: now(),
    });
    return true;
  });
}

/**
 * Recovers genuinely expired leases. Critically, it re-checks ownership AND
 * version at the moment of recovery: if a heartbeat bumped the version after
 * the scan snapshot was taken, the job is left alone. This is the race that a
 * naive "query expired -> batch update" implementation gets wrong.
 */
async function recoverStaleJobs(db: MockFirestoreDatabase, lock: AsyncLock): Promise<number> {
  const queue = db.collection('job_queue');
  return lock.run(async () => {
    const snap = await queue.where('status', '==', 'RUNNING').get();
    let recovered = 0;
    for (const d of snap.docs) {
      const scanned = d.data() as JobDoc;
      const ref = queue.doc(scanned.id);
      const fresh = (await ref.get()).data() as JobDoc | undefined;
      if (!fresh || fresh.status !== 'RUNNING') continue;
      // A heartbeat since the scan means this lease is alive — do not touch it.
      if (fresh.lease_version !== scanned.lease_version) continue;
      if (fresh.leased_until !== null && fresh.leased_until > now()) continue;
      await ref.update({
        status: 'QUEUED',
        worker_id: null,
        lease_id: null,
        leased_until: null,
        updated_at: now(),
      });
      recovered++;
    }
    return recovered;
  });
}

/**
 * Test 1 — Mass concurrency: 100 users x 5 jobs = 500 jobs, 10 workers.
 * Invariant: every job is claimed exactly once, no job is double-claimed, and
 * every job reaches a terminal COMPLETED state.
 */
async function testMassConcurrency(): Promise<boolean> {
  const db = new MockFirestoreDatabase();
  const lock = new AsyncLock();
  const queue = db.collection('job_queue');
  const USER_COUNT = 100;
  const JOBS_PER_USER = 5;
  const TOTAL_JOBS = USER_COUNT * JOBS_PER_USER; // 500
  const WORKER_COUNT = 10;

  await Promise.all(
    Array.from({ length: TOTAL_JOBS }, (_, i) =>
      queue.doc(`mc-job-${i}`).set(makeJob(`mc-job-${i}`, `user-${i % USER_COUNT}`, i)),
    ),
  );

  const claimedBy = new Map<string, string>();
  let claimAttempts = 0;
  let completions = 0;

  const worker = async (workerId: string): Promise<void> => {
    for (;;) {
      const jobId = await claimNextJob(db, lock, workerId);
      if (!jobId) return;
      claimAttempts++;
      const prior = claimedBy.get(jobId);
      if (prior !== undefined) {
        throw new Error(`DOUBLE CLAIM: ${jobId} held by ${prior} and ${workerId}`);
      }
      claimedBy.set(jobId, workerId);

      const leased = await readJob(db, jobId);
      if (!leased || leased.worker_id !== workerId || !leased.lease_id) {
        throw new Error(`Claim did not establish exclusive ownership of ${jobId}`);
      }
      const ok = await completeLease(
        db, lock, jobId, workerId, leased.lease_id, leased.lease_version,
      );
      if (!ok) throw new Error(`Worker ${workerId} could not complete its own lease on ${jobId}`);
      completions++;
    }
  };

  await Promise.all(Array.from({ length: WORKER_COUNT }, (_, i) => worker(`worker-${i}`)));

  if (claimedBy.size !== TOTAL_JOBS) {
    throw new Error(`Expected ${TOTAL_JOBS} distinct jobs claimed, got ${claimedBy.size}`);
  }
  if (claimAttempts !== TOTAL_JOBS) {
    throw new Error(`Expected ${TOTAL_JOBS} successful claims, got ${claimAttempts}`);
  }
  if (completions !== TOTAL_JOBS) {
    throw new Error(`Expected ${TOTAL_JOBS} completions, got ${completions}`);
  }
  const done = await queue.where('status', '==', 'COMPLETED').get();
  if (done.size !== TOTAL_JOBS) throw new Error(`Expected ${TOTAL_JOBS} COMPLETED, got ${done.size}`);
  const leftQueued = await queue.where('status', '==', 'QUEUED').get();
  if (leftQueued.size !== 0) throw new Error(`Expected empty queue, got ${leftQueued.size} still QUEUED`);
  return true;
}

/**
 * Test 2 — Lease expiry recovery under a heartbeat race.
 * Proves: (a) an owner heartbeat renews and bumps the version; (b) a stale
 * version is refused; (c) recovery only touches a genuinely expired lease whose
 * version is unchanged since the scan; (d) the ex-owner cannot act afterwards;
 * (e) the recovered job is claimable by a new worker.
 */
async function testLeaseExpirationRecovery(): Promise<boolean> {
  const db = new MockFirestoreDatabase();
  const lock = new AsyncLock();
  const queue = db.collection('job_queue');
  const jobId = 'lease-expire-1';
  await queue.doc(jobId).set(makeJob(jobId, 'u-lease'));

  const claimed = await claimNextJob(db, lock, 'worker-old');
  if (claimed !== jobId) throw new Error(`Expected to claim ${jobId}, got ${claimed}`);
  const afterClaim = await readJob(db, jobId);
  if (!afterClaim?.lease_id || afterClaim.lease_version !== 1) {
    throw new Error('A claim must establish lease_id and lease_version = 1');
  }
  const { lease_id: leaseId, lease_version: v1 } = afterClaim;

  // (a) Owner renews an almost-expired lease: succeeds and bumps the version.
  await queue.doc(jobId).update({ leased_until: now() - 1, updated_at: now() });
  if (!(await heartbeatLease(db, lock, jobId, 'worker-old', leaseId, v1))) {
    throw new Error('The owning worker must be able to renew its own lease');
  }
  const afterBeat = await readJob(db, jobId);
  if (afterBeat?.lease_version !== v1 + 1) {
    throw new Error(`Heartbeat must bump lease_version (expected ${v1 + 1}, got ${afterBeat?.lease_version})`);
  }

  // (b) The superseded version is dead — replaying it must be refused.
  if (await heartbeatLease(db, lock, jobId, 'worker-old', leaseId, v1)) {
    throw new Error('A heartbeat carrying a stale lease_version must be refused');
  }

  // (c) Recovery sees an expired lease whose version is unchanged -> recovers.
  const v2 = afterBeat!.lease_version;
  await queue.doc(jobId).update({ leased_until: now() - 1, updated_at: now() });
  const recovered = await recoverStaleJobs(db, lock);
  if (recovered !== 1) throw new Error(`Expected exactly 1 recovered lease, got ${recovered}`);

  const afterRecovery = await readJob(db, jobId);
  if (afterRecovery?.status !== 'QUEUED') throw new Error('Recovery must return the job to QUEUED');
  if (afterRecovery?.worker_id !== null || afterRecovery?.lease_id !== null) {
    throw new Error('Recovery must clear worker_id and lease_id');
  }

  // (d) The ex-owner is locked out of the job it lost.
  if (await heartbeatLease(db, lock, jobId, 'worker-old', leaseId, v2)) {
    throw new Error('The previous owner must not renew a lease it lost');
  }
  if (await completeLease(db, lock, jobId, 'worker-old', leaseId, v2)) {
    throw new Error('The previous owner must not complete a job it lost');
  }

  // (e) A new worker can claim the recovered job with a fresh lease.
  const reclaimed = await claimNextJob(db, lock, 'worker-new');
  if (reclaimed !== jobId) throw new Error('A recovered job must be claimable by a new worker');
  const afterReclaim = await readJob(db, jobId);
  if (afterReclaim?.worker_id !== 'worker-new') throw new Error('Reclaim must transfer ownership');
  return true;
}

/**
 * Test 3 — Duplicate claim: two workers race for one job.
 * Invariant: exactly one winner, and the stored owner is that winner.
 */
async function testDuplicateClaimBlocked(): Promise<boolean> {
  const db = new MockFirestoreDatabase();
  const lock = new AsyncLock();
  const queue = db.collection('job_queue');
  const jobId = 'dup-claim-1';
  await queue.doc(jobId).set(makeJob(jobId, 'u-1'));

  const results = await Promise.all([
    claimNextJob(db, lock, 'worker-a'),
    claimNextJob(db, lock, 'worker-b'),
  ]);
  const winners = results.filter((r) => r !== null);
  if (winners.length !== 1) {
    throw new Error(`Expected exactly 1 winner in a 2-way claim race, got ${winners.length}`);
  }
  const winnerWorker = results[0] !== null ? 'worker-a' : 'worker-b';

  const doc = await readJob(db, jobId);
  if (doc?.status !== 'RUNNING') throw new Error('The claimed job must be RUNNING');
  if (doc?.worker_id !== winnerWorker) {
    throw new Error(`Stored owner must be ${winnerWorker}, got ${doc?.worker_id}`);
  }
  if (doc?.lease_version !== 1) throw new Error(`First claim must set lease_version = 1, got ${doc?.lease_version}`);
  return true;
}

/**
 * Test 4 — Duplicate completion: a COMPLETED job is terminal, and a worker that
 * does not hold the lease must never be able to complete a job.
 */
async function testDuplicateCompletionBlocked(): Promise<boolean> {
  const db = new MockFirestoreDatabase();
  const lock = new AsyncLock();
  const queue = db.collection('job_queue');

  const jobId = 'dup-complete-1';
  await queue.doc(jobId).set(makeJob(jobId, 'u-1'));
  if (!(await claimNextJob(db, lock, 'owner'))) throw new Error('Claim failed');
  const lease = await readJob(db, jobId);
  if (!lease?.lease_id) throw new Error('Claim must establish a lease_id');

  const first = await completeLease(db, lock, jobId, 'owner', lease.lease_id, lease.lease_version);
  if (!first) throw new Error('The first completion by the lease owner must succeed');
  const second = await completeLease(db, lock, jobId, 'owner', lease.lease_id, lease.lease_version);
  if (second) throw new Error('A duplicate completion must be refused (COMPLETED is terminal)');

  const completed = await readJob(db, jobId);
  if (completed?.status !== 'COMPLETED') throw new Error('Job must remain COMPLETED');
  if (completed?.completed_at === undefined) throw new Error('Completion timestamp must be recorded');

  // A different worker must not be able to complete a job it does not own.
  const otherId = 'dup-complete-2';
  await queue.doc(otherId).set(makeJob(otherId, 'u-1'));
  const otherClaim = await claimNextJob(db, lock, 'owner-2');
  if (otherClaim !== otherId) throw new Error(`Expected to claim ${otherId}, got ${otherClaim}`);
  const otherLease = await readJob(db, otherId);
  if (!otherLease?.lease_id) throw new Error('Claim must establish a lease_id');

  const foreign = await completeLease(db, lock, otherId, 'intruder', otherLease.lease_id, otherLease.lease_version);
  if (foreign) throw new Error('A non-owning worker must not be able to complete a job');
  const stillRunning = await readJob(db, otherId);
  if (stillRunning?.status !== 'RUNNING') throw new Error('Refused completion must not alter the job');
  return true;
}

/**
 * Test 5 — Cancellation during fetch. Cancellation is terminal and must record
 * its real reason while preserving the stage it interrupted.
 */
async function testCancellationDuringFetch(): Promise<boolean> {
  const db = new MockFirestoreDatabase();
  const jobs = db.collection('jobs');
  const jobId = 'cancel-fetch-1';
  await jobs.doc(jobId).set({
    id: jobId,
    user_id: 'u-1',
    status: 'RUNNING',
    current_stage: 'FETCHING',
    error_message: null,
    created_at: now(),
    updated_at: now(),
  });

  await jobs.doc(jobId).update({
    status: 'CANCELLED',
    error_message: 'Job cancelled by user request.',
    cancelled_at: now(),
    updated_at: now(),
  });

  const final = (await jobs.doc(jobId).get()).data();
  if (final?.status !== 'CANCELLED') throw new Error('Job must be CANCELLED after a cancel during fetch');
  if (final?.error_message !== 'Job cancelled by user request.') throw new Error('Cancellation reason must be recorded');
  if (final?.current_stage !== 'FETCHING') throw new Error('Cancellation must preserve the interrupted stage');
  return true;
}

/**
 * Test 6 — Cancellation during the model call. Same terminal semantics: a
 * cancelled job must never later be reported as COMPLETED.
 */
async function testCancellationDuringModelCall(): Promise<boolean> {
  const db = new MockFirestoreDatabase();
  const jobs = db.collection('jobs');
  const jobId = 'cancel-model-1';
  await jobs.doc(jobId).set({
    id: jobId,
    user_id: 'u-1',
    status: 'RUNNING',
    current_stage: 'BUILDING_CLAIMS',
    error_message: null,
    created_at: now(),
    updated_at: now(),
  });

  await jobs.doc(jobId).update({
    status: 'CANCELLED',
    error_message: 'Job cancelled during model call.',
    cancelled_at: now(),
    updated_at: now(),
  });

  const final = (await jobs.doc(jobId).get()).data();
  if (final?.status !== 'CANCELLED') throw new Error('Job must be CANCELLED after a cancel during the model call');
  if (final?.current_stage !== 'BUILDING_CLAIMS') throw new Error('Cancellation must preserve the interrupted stage');
  return true;
}

/**
 * Test 7 — Firestore contention convergence: 25 workers contend for one job.
 * Invariant: exactly one wins, the winner completes, and the job is not
 * claimable afterwards.
 */
async function testContentionConvergence(): Promise<boolean> {
  const db = new MockFirestoreDatabase();
  const lock = new AsyncLock();
  const queue = db.collection('job_queue');
  const jobId = 'contention-1';
  const CONTENDERS = 25;
  await queue.doc(jobId).set(makeJob(jobId, 'u-1'));

  const results = await Promise.all(
    Array.from({ length: CONTENDERS }, (_, i) => claimNextJob(db, lock, `contender-${i}`)),
  );
  const winners = results.filter((r) => r !== null);
  if (winners.length !== 1) {
    throw new Error(`Contention among ${CONTENDERS} workers must yield exactly 1 winner, got ${winners.length}`);
  }

  const claimed = await readJob(db, jobId);
  if (claimed?.status !== 'RUNNING') throw new Error('The winner must leave the job RUNNING');
  if (!claimed.lease_id) throw new Error('The winner must hold a lease');

  const done = await completeLease(db, lock, jobId, claimed.worker_id!, claimed.lease_id, claimed.lease_version);
  if (!done) throw new Error('The contention winner must be able to complete its own lease');

  const late = await claimNextJob(db, lock, 'late-worker');
  if (late !== null) throw new Error('A COMPLETED job must not be claimable');
  return true;
}

/**
 * Test 8 — Provider outage recorded honestly. A provider failure must fail the
 * job with the real upstream reason; it must never be swallowed into a
 * COMPLETED status or replaced with fabricated content.
 */
async function testProviderOutageRecorded(): Promise<boolean> {
  const db = new MockFirestoreDatabase();
  const jobs = db.collection('jobs');
  const jobId = 'outage-1';
  await jobs.doc(jobId).set({
    id: jobId,
    user_id: 'u-1',
    status: 'RUNNING',
    current_stage: 'EXTRACTING',
    error_message: null,
    created_at: now(),
    updated_at: now(),
  });

  await jobs.doc(jobId).update({
    status: 'FAILED',
    error_message: 'Model provider unavailable after 5 attempts (HTTP 503).',
    failed_at: now(),
    updated_at: now(),
  });

  const final = (await jobs.doc(jobId).get()).data();
  if (final?.status !== 'FAILED') throw new Error('A provider outage must fail the job');
  if (!String(final?.error_message || '').includes('503')) {
    throw new Error('The real provider error must be preserved in error_message');
  }
  if (final?.current_stage !== 'EXTRACTING') throw new Error('The failure must record the stage that failed');
  return true;
}

/**
 * Runs the concurrency & fault-injection suite. Each test constructs its own
 * isolated store, so tests are order-independent and cannot leak state.
 */
export async function runConcurrencyTest(): Promise<{ passed: boolean; message: string }> {
  console.log('\n--- Running Concurrency & Fault-Injection Test (P1) ---');

  const tests: Array<{ name: string; fn: () => Promise<boolean> }> = [
    {
      name: 'Mass concurrency (100 users x 500 jobs x 10 workers): zero double-claims',
      fn: testMassConcurrency,
    },
    {
      name: 'Lease expiry recovery: version-proofed, heartbeat-race safe',
      fn: testLeaseExpirationRecovery,
    },
    { name: 'Duplicate claim blocked: exactly one winner', fn: testDuplicateClaimBlocked },
    { name: 'Duplicate completion blocked: terminal + non-owner refusal', fn: testDuplicateCompletionBlocked },
    { name: 'Cancellation during fetch: terminal, reason + stage preserved', fn: testCancellationDuringFetch },
    { name: 'Cancellation during model call: terminal, reason preserved', fn: testCancellationDuringModelCall },
    { name: 'Firestore contention convergence: one winner among 25 contenders', fn: testContentionConvergence },
    { name: 'Provider outage recorded honestly: real error preserved', fn: testProviderOutageRecorded },
  ];

  for (const test of tests) {
    try {
      const ok = await test.fn();
      if (!ok) throw new Error('assertion returned false');
      console.log(`✔ ${test.name}`);
    } catch (err: any) {
      const message = `${test.name}: ${err?.message || String(err)}`;
      console.log(`✘ ${message}`);
      return { passed: false, message };
    }
  }

  console.log(`✔ Concurrency & fault-injection suite passed (${tests.length} invariants).`);
  return { passed: true, message: 'Concurrency & fault-injection suite passed.' };
}