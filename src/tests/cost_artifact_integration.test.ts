/**
 * P1 integration tests for cost governor + artifact persistence wiring.
 *
 * These exercises are deterministic and do not require a real object storage
 * provider: InMemoryArtifactStorage is used by default.
 */

import { CostGovernor } from '../server/cost_governor.js';
import { InMemoryArtifactStorage, artifactRef, RetrievalArtifact } from '../server/artifacts.js';
import { logEnvelope } from '../server/rate_limits.js';
import { RealDocumentFetcher } from '../server/fetcher.js';

function approxEqual(a: number, b: number, tol = 0.01): boolean {
  return Math.abs(a - b) <= tol;
}

async function runCostGovernorTests(): Promise<{ passed: boolean; message: string }> {
  console.log('[Cost/Artifact Integration] Running cost governor + artifact persistence tests...');

  // --- Cost governor: cap enforcement ---
  const governor = new CostGovernor({ maxSources: 3, maxDocumentSizeBytes: 1000 });
  if (governor.allowFetch(500) !== null) {
    return { passed: false, message: 'allowFetch should allow a small document' };
  }
  if (governor.allowFetch(2000) !== 'Document too large: 2000 bytes exceeds 1000 bytes') {
    return { passed: false, message: 'allowFetch should reject an oversized document' };
  }

  // Exhaust the source cap.
  governor.recordFetch(100, 0.01);
  governor.recordFetch(100, 0.01);
  governor.recordFetch(100, 0.01);
  if (governor.allowFetch(50) !== 'Source cap exceeded: 3 sources per request') {
    return { passed: false, message: 'allowFetch should reject after maxSources exhausted' };
  }

  // --- Cost governor: budget enforcement ---
  const budgetGov = new CostGovernor({ requestBudgetUsd: 0.05 });
  budgetGov.recordFetch(100, 0.02);
  budgetGov.recordFetch(100, 0.02);
  budgetGov.recordFetch(100, 0.02);
  if (budgetGov.checkRequestBudget() !== 'Request budget exceeded: $0.05 per request') {
    return { passed: false, message: 'checkRequestBudget should fire when estimated cost exceeds budget' };
  }

  // --- Artifact persistence ---
  const storage = new InMemoryArtifactStorage();
  const ref = await storage.putRaw('src-1', 'job-1', 'https://example.test/src-1', 'text/plain', Buffer.from('hello world'));
  if (ref !== artifactRef('src-1', 'job-1', 'raw')) {
    return { passed: false, message: 'putRaw should return the expected artifactRef' };
  }
  const got = await storage.getRaw(ref);
  if (!got || got.toString() !== 'hello world') {
    return { passed: false, message: 'getRaw should return the stored bytes' };
  }

  const textRef = await storage.putNormalizedText('src-1', 'job-1', 'normalized text here');
  if ((await storage.getNormalizedText(textRef)) !== 'normalized text here') {
    return { passed: false, message: 'getNormalizedText should return the stored text' };
  }

  // delete
  await storage.delete('src-1', 'job-1');
  if (await storage.getRaw(ref) !== null) {
    return { passed: false, message: 'delete should remove the raw artifact' };
  }

  // --- RetrievalArtifact shape ---
  const artifact: RetrievalArtifact = {
    source_id: 'src-1',
    job_id: 'job-1',
    url: 'https://example.test/src-1',
    retrieved_at: new Date().toISOString(),
    parser_version: '1.0.0',
    normalizer_version: '1.0.0',
    content_type: 'text/plain',
    content_hash: 'sha256-of-empty',
    raw_size_bytes: 0,
    normalized_text_size_bytes: 0,
    storage_ref: ref,
    raw_available: true,
    normalized_text_available: true,
  };
  if (artifact.source_id !== 'src-1' || artifact.storage_ref !== ref) {
    return { passed: false, message: 'RetrievalArtifact should preserve identity fields' };
  }

  // --- Structured log envelope shape ---
  const logged: any[] = [];
  const original = console.log;
  console.log = (...args: any[]) => { logged.push(...args); };
  logEnvelope('stage', { request_id: 'req-1', user_id: 'usr-1', job_id: 'job-1', stage: 'PLANNING', status: 'success', duration_ms: 8 }, 'Planning stage completed');
  console.log = original;
  if (logged.length < 1) {
    return { passed: false, message: 'logEnvelope should emit a line' };
  }
  const parsed = logged[0];
  if (typeof parsed !== 'string') {
    return { passed: false, message: 'logEnvelope should JSON.stringify its output' };
  }
  const envelope = JSON.parse(parsed);
  if (envelope.event !== 'stage' || envelope.request_id !== 'req-1' || envelope.user_id !== 'usr-1' || envelope.job_id !== 'job-1' || envelope.stage !== 'PLANNING' || envelope.status !== 'success' || envelope.duration_ms !== 8 || envelope.message !== 'Planning stage completed') {
    return { passed: false, message: 'logEnvelope should preserve structured fields' };
  }

  console.log('[Cost/Artifact Integration] Cost governor + artifact persistence tests passed.');
  return { passed: true, message: 'Cost governor + artifact persistence integration tests passed.' };
}

async function run(): Promise<void> {
  const result = await runCostGovernorTests();
  if (!result.passed) {
    console.error('FAIL:', result.message);
    process.exit(1);
  }
}

run().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});

export const runCostArtifactTest = run;
