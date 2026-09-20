/**
 * Master Test Suite Runner: Phase 4 — Testing
 * Executes all test modules in the exact required sequence:
 * 1. Firestore Emulator Verification
 * 2. Queue Race Concurrency Test
 * 3. Worker Lease & Stale Job Recovery Test
 * 4. Ownership & Security Rules Test
 * 5. API Auth & Security Middleware Test
 * 6. Pipeline Fixture Test
 * 7. Citation Integrity & Coordinate Test
 * 8. Playwright / E2E Simulation Test
 * 9. Real Deployment High-Concurrency Load Test
 */

import { MockFirestore } from './emulator_harness.js';
import { runQueueRaceTest } from './queue_race.test.js';
import { runLeaseRecoveryTest } from './lease_recovery.test.js';
import { runSecurityRulesTest } from './security_rules.test.js';
import { runApiAuthTest } from './api_auth.test.js';
import { runPipelineFixtureTest } from './pipeline_fixture.test.js';
import { runCitationIntegrityTest } from './citation_integrity.test.js';
import { runPrecisionHardeningTest } from './precision_hardening.test.js';
import { runCostArtifactTest } from './cost_artifact_integration.test.js';
import { runConcurrencyTest } from './concurrency.test.js';
import { runDeployLayerTest } from './deploy_layer_part3.js';
import { runBenchmarkCorpusTest } from './benchmark.test.js';
import { runE2ETest } from './e2e.test.js';
import { runDeploymentLoadTest } from './load.test.js';

interface TestResult {
  name: string;
  durationMs: number;
  status: 'PASSED' | 'FAILED';
  error?: string;
}

async function verifyFirestoreEmulator(): Promise<boolean> {
  console.log('\n--- Running: Firestore Emulator Harness Verification ---');
  const mockDb = new MockFirestore();
  const testRef = mockDb.collection('test_verification').doc('test-id-1');
  await testRef.set({ title: 'Emulator Active', timestamp: Date.now() });

  const snap = await testRef.get();
  if (!snap.exists || snap.data()?.title !== 'Emulator Active') {
    throw new Error('Firestore emulator failed basic set/get check');
  }

  // Test transaction
  await mockDb.runTransaction(async (tx) => {
    const fresh = await tx.get(testRef);
    tx.update(testRef, { count: (fresh.data()?.count || 0) + 1 });
  });

  const updatedSnap = await testRef.get();
  if (updatedSnap.data()?.count !== 1) {
    throw new Error('Firestore emulator transaction failed');
  }

  console.log('✓ PASS: Firestore Emulator active, healthy, and transaction-ready.');
  return true;
}

export async function runAllTests() {
  console.log('===========================================================');
  console.log('       ENTERPRISE MARKET RESEARCH SUITE: PHASE 4 TESTS     ');
  console.log('===========================================================');

  const testSteps: Array<{ name: string; fn: () => Promise<any> }> = [
    { name: '1. Firestore Emulator Verification', fn: verifyFirestoreEmulator },
    { name: '2. Queue Race Concurrency Test', fn: runQueueRaceTest },
    { name: '3. Worker Lease & Stale Job Recovery Test', fn: runLeaseRecoveryTest },
    { name: '4. Ownership & Security Rules Test', fn: runSecurityRulesTest },
    { name: '5. API Auth & Security Middleware Test', fn: runApiAuthTest },
    { name: '6. Pipeline Fixture Test', fn: runPipelineFixtureTest },
    { name: '7. Citation Integrity & Coordinate Test', fn: runCitationIntegrityTest },
    { name: 'Cost + Artifact Integration Test (P1)', fn: runCostArtifactTest },
    { name: 'Concurrency & Fault-Injection Test (P1)', fn: runConcurrencyTest },
    { name: 'Deploy-Layer Test (CORS, stores, budgets, cache)', fn: runDeployLayerTest },
    { name: 'Deterministic Benchmark Corpus (P1)', fn: runBenchmarkCorpusTest },
    { name: '8. Precision Hardening Suite (P0)', fn: runPrecisionHardeningTest },
    { name: '9. Playwright / E2E Simulation Test', fn: runE2ETest },
    { name: '10. Real Deployment Load Test', fn: runDeploymentLoadTest },
  ];

  const results: TestResult[] = [];
  const globalStart = Date.now();

  for (const step of testSteps) {
    const start = Date.now();
    try {
      const res = await step.fn();
      if (res && typeof res === 'object' && 'passed' in res && res.passed === false) {
        throw new Error(res.message || 'Test assertion returned false');
      }
      results.push({
        name: step.name,
        durationMs: Date.now() - start,
        status: 'PASSED',
      });
    } catch (err: any) {
      results.push({
        name: step.name,
        durationMs: Date.now() - start,
        status: 'FAILED',
        error: err?.message || String(err),
      });
      console.error(`\n❌ FAILED: ${step.name}`);
      console.error(err);
      break; // Halt on first failure
    }
  }

  const totalDuration = Date.now() - globalStart;

  console.log('\n===========================================================');
  console.log('                      TEST SUMMARY                         ');
  console.log('===========================================================');
  let allPassed = true;
  for (const res of results) {
    const icon = res.status === 'PASSED' ? '✓' : '✗';
    console.log(`${icon} [${res.status}] ${res.name} (${res.durationMs}ms)`);
    if (res.status === 'FAILED') {
      allPassed = false;
      if (res.error) console.log(`    Error: ${res.error}`);
    }
  }
  console.log('-----------------------------------------------------------');
  console.log(`Total Time: ${(totalDuration / 1000).toFixed(2)}s`);
  console.log(`Status: ${allPassed ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'}`);
  console.log('===========================================================\n');

  if (!allPassed) {
    process.exit(1);
  }
}

if (process.argv[1]?.endsWith('integration.test.ts')) {
  runAllTests().catch(err => {
    console.error('Master Test Suite Failed:', err);
    process.exit(1);
  });
}
