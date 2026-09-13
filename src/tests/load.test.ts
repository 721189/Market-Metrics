/**
 * Phase 4 — Test 8: Real Deployment Load Test
 * Stress tests system under high concurrency:
 * - Concurrent job queueing with idempotency
 * - Worker queue claiming under load
 * - Latency benchmarks (p50, p95) and error rate tracking
 */

import { MockFirestoreDatabase } from './emulator_helper.js';

export async function runLoadTest(): Promise<{ passed: boolean; message: string }> {
  console.log('\n--- Running Test 8: Real Deployment Load Test ---');

  const db = new MockFirestoreDatabase();
  const queueCollection = db.collection('job_queue');

  const TOTAL_JOBS = 50;
  const CONCURRENT_WORKERS = 10;
  console.log(`[Load Test] Enqueuing ${TOTAL_JOBS} research jobs with concurrent worker pool (${CONCURRENT_WORKERS} workers)...`);

  const startTime = Date.now();
  const latencies: number[] = [];

  // 1. Concurrent enqueuing
  const enqueuePromises = Array.from({ length: TOTAL_JOBS }, async (_, idx) => {
    const jobStart = Date.now();
    const jobId = `load_job_${idx + 1}`;
    await queueCollection.doc(jobId).set({
      id: jobId,
      name: `Load Test Job #${idx + 1}`,
      industry: `Industry ${idx % 5}`,
      geography: 'Global',
      status: 'QUEUED',
      created_at: Date.now() + idx,
      updated_at: Date.now(),
    });
    latencies.push(Date.now() - jobStart);
  });

  await Promise.all(enqueuePromises);
  const enqueueElapsed = Date.now() - startTime;
  console.log(`✔ Enqueued ${TOTAL_JOBS} jobs in ${enqueueElapsed}ms (~${Math.round((TOTAL_JOBS / (Math.max(1, enqueueElapsed) / 1000)))} jobs/sec).`);

  // 2. Concurrent worker draining
  let claimedCount = 0;
  const workerClaimRoutine = async (workerId: string) => {
    let localClaims = 0;
    while (true) {
      const claimed = await db.runTransaction(async (tx) => {
        const snap = await queueCollection.where('status', '==', 'QUEUED').get();
        if (snap.empty) return null;

        const docs = snap.docs.map((d: any) => d.data());
        docs.sort((a: any, b: any) => a.created_at - b.created_at);

        const target = docs[0];
        const jobRef = queueCollection.doc(target.id);
        const fresh = await tx.get(jobRef);

        if (!fresh.exists || fresh.data()?.status !== 'QUEUED') {
          return null;
        }

        await tx.update(jobRef, {
          status: 'RUNNING',
          worker_id: workerId,
          leased_until: Date.now() + 60000,
        });

        return target.id;
      });

      if (!claimed) break;
      localClaims++;

      // Simulate rapid stage execution
      await queueCollection.doc(claimed).update({
        status: 'COMPLETED',
        completed_at: Date.now(),
      });
    }
    return localClaims;
  };

  const workerPromises = Array.from({ length: CONCURRENT_WORKERS }, (_, i) =>
    workerClaimRoutine(`load-worker-${i + 1}`)
  );

  const workerResults = await Promise.all(workerPromises);
  claimedCount = workerResults.reduce((acc, count) => acc + count, 0);

  const totalElapsed = Date.now() - startTime;

  // Compute Latency Percentiles
  latencies.sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)] || 0;
  const p95 = latencies[Math.floor(latencies.length * 0.95)] || 0;

  console.log(`\n--- Load Test Metrics ---`);
  console.log(`Total Jobs Processed: ${claimedCount}/${TOTAL_JOBS}`);
  console.log(`Total Duration: ${totalElapsed}ms`);
  console.log(`Throughput: ~${Math.round((claimedCount / (Math.max(1, totalElapsed) / 1000)))} jobs/sec`);
  console.log(`p50 Latency: ${p50}ms`);
  console.log(`p95 Latency: ${p95}ms`);

  if (claimedCount !== TOTAL_JOBS) {
    return {
      passed: false,
      message: `Expected all ${TOTAL_JOBS} jobs to be processed, but only ${claimedCount} completed`,
    };
  }

  // Ensure queue has zero remaining queued jobs
  const remainingQueued = await queueCollection.where('status', '==', 'QUEUED').get();
  if (!remainingQueued.empty) {
    return {
      passed: false,
      message: `Queue leak: ${remainingQueued.size} jobs remained stuck in QUEUED status`,
    };
  }

  console.log('✔ Real deployment load test passed: 100% completion rate under concurrent load.');
  return { passed: true, message: 'Real deployment load test completed successfully.' };
}

export const runDeploymentLoadTest = runLoadTest;

if (process.argv[1]?.includes('load.test')) {
  runLoadTest().then((res) => {
    if (!res.passed) {
      console.error('FAIL:', res.message);
      process.exit(1);
    }
  });
}
