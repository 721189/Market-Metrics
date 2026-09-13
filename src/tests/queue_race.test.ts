/**
 * Phase 4 — Test 1: Queue Race Test
 * Verifies transactional queue claiming under high concurrency.
 * Ensures that multiple simultaneous workers competing for jobs never double-claim
 * or corrupt queue state.
 */

import { MockFirestoreDatabase } from './emulator_helper.js';

export async function runQueueRaceTest(): Promise<{ passed: boolean; message: string }> {
  console.log('\n--- Running Test 1: Queue Race Test ---');
  const db = new MockFirestoreDatabase();
  const queueCollection = db.collection('job_queue');

  // Enqueue 3 test jobs
  const jobIds = ['job-race-1', 'job-race-2', 'job-race-3'];
  for (let i = 0; i < jobIds.length; i++) {
    await queueCollection.doc(jobIds[i]).set({
      id: jobIds[i],
      name: `Research Job ${i + 1}`,
      data: { industry: 'Renewable Energy', geography: 'North America' },
      status: 'QUEUED',
      created_at: Date.now() + i * 10,
      updated_at: Date.now(),
    });
  }

  // Transactional claim function mimicking FirestoreQueue.claimNextJob
  const claimNextJob = async (workerId: string) => {
    return await db.runTransaction(async (tx) => {
      const snap = await queueCollection.where('status', '==', 'QUEUED').get();
      if (snap.empty) return null;

      const docs = snap.docs.map((d: any) => d.data());
      docs.sort((a: any, b: any) => a.created_at - b.created_at);

      for (const target of docs) {
        const jobRef = queueCollection.doc(target.id);
        const freshDoc = await tx.get(jobRef);

        if (freshDoc.exists && freshDoc.data()?.status === 'QUEUED') {
          const leasedUntil = Date.now() + 180000;
          await tx.update(jobRef, {
            status: 'RUNNING',
            worker_id: workerId,
            leased_until: leasedUntil,
            updated_at: Date.now(),
          });

          return {
            ...freshDoc.data(),
            id: target.id,
            status: 'RUNNING',
            worker_id: workerId,
            leased_until: leasedUntil,
          };
        }
      }
      return null;
    });
  };

  // Launch 10 concurrent worker claims
  const workerCount = 10;
  const workers = Array.from({ length: workerCount }, (_, i) => `worker-${i + 1}`);

  const results = await Promise.all(workers.map((workerId) => claimNextJob(workerId)));
  const successfulClaims = results.filter((r) => r !== null);

  console.log(`Concurrent workers: ${workerCount}`);
  console.log(`Total jobs queued: ${jobIds.length}`);
  console.log(`Successful claims: ${successfulClaims.length}`);

  // Assertions
  if (successfulClaims.length !== jobIds.length) {
    return {
      passed: false,
      message: `Expected exactly ${jobIds.length} successful claims, but got ${successfulClaims.length}`,
    };
  }

  // Check unique claimed job IDs
  const claimedJobIds = new Set(successfulClaims.map((c) => c.id));
  if (claimedJobIds.size !== jobIds.length) {
    return {
      passed: false,
      message: `Duplicate job claim detected! Unique claimed IDs: ${claimedJobIds.size}, expected: ${jobIds.length}`,
    };
  }

  // Check unique workers
  const claimingWorkers = new Set(successfulClaims.map((c) => c.worker_id));
  if (claimingWorkers.size !== jobIds.length) {
    return {
      passed: false,
      message: `Worker collision detected! Claiming workers count: ${claimingWorkers.size}`,
    };
  }

  // Verify all 3 jobs in database now have RUNNING status
  for (const jId of jobIds) {
    const doc = await queueCollection.doc(jId).get();
    if (doc.data()?.status !== 'RUNNING') {
      return {
        passed: false,
        message: `Job ${jId} was not updated to RUNNING in database`,
      };
    }
  }

  console.log('✔ Queue race test passed: Zero double-claims across 10 concurrent workers.');
  return { passed: true, message: 'Queue race test passed successfully.' };
}

if (process.argv[1]?.endsWith('queue_race.test.ts')) {
  runQueueRaceTest().then((res) => {
    if (!res.passed) {
      console.error('FAIL:', res.message);
      process.exit(1);
    }
  });
}
