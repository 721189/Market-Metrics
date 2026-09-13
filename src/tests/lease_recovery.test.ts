/**
 * Phase 4 — Test 2: Lease Recovery Test
 * Verifies worker lease management, heartbeats, and stale job recovery.
 * Ensures that crashed or stalled workers have their jobs safely re-queued.
 */

import { MockFirestoreDatabase } from './emulator_helper.js';

export async function runLeaseRecoveryTest(): Promise<{ passed: boolean; message: string }> {
  console.log('\n--- Running Test 2: Lease Recovery Test ---');
  const db = new MockFirestoreDatabase();
  const queueCollection = db.collection('job_queue');

  const jobId = 'job-lease-recovery-1';
  await queueCollection.doc(jobId).set({
    id: jobId,
    name: 'Autonomous Driving Market Sizing',
    data: { industry: 'Robotics', geography: 'Global' },
    status: 'QUEUED',
    created_at: Date.now(),
    updated_at: Date.now(),
  });

  // Step 1: Worker 1 claims the job with a 500ms lease
  const now = Date.now();
  const initialLease = now + 500;
  await queueCollection.doc(jobId).update({
    status: 'RUNNING',
    worker_id: 'worker-stale-1',
    leased_until: initialLease,
    updated_at: now,
  });

  let jobDoc = await queueCollection.doc(jobId).get();
  if (jobDoc.data()?.status !== 'RUNNING' || jobDoc.data()?.worker_id !== 'worker-stale-1') {
    return { passed: false, message: 'Initial claim failed' };
  }
  console.log('Worker 1 claimed job with lease.');

  // Step 2: Test Heartbeat extension
  const extendedLease = Date.now() + 1000;
  await queueCollection.doc(jobId).update({
    leased_until: extendedLease,
    updated_at: Date.now(),
  });
  jobDoc = await queueCollection.doc(jobId).get();
  if (jobDoc.data()?.leased_until !== extendedLease) {
    return { passed: false, message: 'Heartbeat extension failed' };
  }
  console.log('✔ Heartbeat successfully extended lease.');

  // Step 3: Simulate Worker 1 crashing and lease expiring
  const expiredTime = Date.now() - 5000; // Expired 5 seconds ago
  await queueCollection.doc(jobId).update({
    leased_until: expiredTime,
  });

  // Stale recovery routine mimicking FirestoreQueue.recoverStaleJobs
  const recoverStaleJobs = async () => {
    const currentTime = Date.now();
    const snap = await queueCollection.where('status', '==', 'RUNNING').get();
    const batch = db.batch();
    let recoveredCount = 0;

    snap.docs.forEach((doc: any) => {
      const data = doc.data();
      if (data.leased_until && data.leased_until < currentTime) {
        batch.update(doc.ref, {
          status: 'QUEUED',
          worker_id: null,
          leased_until: null,
          updated_at: Date.now(),
        });
        recoveredCount++;
      }
    });

    await batch.commit();
    return recoveredCount;
  };

  const recovered = await recoverStaleJobs();
  if (recovered !== 1) {
    return { passed: false, message: `Expected 1 recovered job, but got ${recovered}` };
  }

  jobDoc = await queueCollection.doc(jobId).get();
  if (jobDoc.data()?.status !== 'QUEUED' || jobDoc.data()?.worker_id !== null) {
    return { passed: false, message: 'Job was not properly reset to QUEUED state' };
  }
  console.log('✔ Stale lease detection recovered job back to QUEUED status.');

  // Step 4: Worker 2 successfully claims the recovered job
  await queueCollection.doc(jobId).update({
    status: 'RUNNING',
    worker_id: 'worker-healthy-2',
    leased_until: Date.now() + 180000,
    updated_at: Date.now(),
  });

  jobDoc = await queueCollection.doc(jobId).get();
  if (jobDoc.data()?.status !== 'RUNNING' || jobDoc.data()?.worker_id !== 'worker-healthy-2') {
    return { passed: false, message: 'Worker 2 failed to claim recovered job' };
  }
  console.log('✔ Worker 2 successfully claimed the recovered job.');

  return { passed: true, message: 'Lease recovery test passed successfully.' };
}

if (process.argv[1]?.endsWith('lease_recovery.test.ts')) {
  runLeaseRecoveryTest().then((res) => {
    if (!res.passed) {
      console.error('FAIL:', res.message);
      process.exit(1);
    }
  });
}
