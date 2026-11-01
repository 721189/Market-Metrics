/**
 * P1 integration tests for cost governor + artifact persistence wiring.
 *
 * These exercises are deterministic and do not require a real object storage
 * provider: InMemoryArtifactStorage is used by default.
 */

import { CostGovernor } from '../server/cost_governor.js';
import { InMemoryArtifactStorage, artifactRef, parseArtifactRef, RetrievalArtifact } from '../server/artifacts.js';
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

  // Retry budget is measured in retry attempts, never model output tokens.
  const retryGov = new CostGovernor({ maxRetries: 3 });
  retryGov.recordModelCall(100, 10000, 0.01);
  if (
    retryGov.allowRetry(0) !== null ||
    retryGov.allowRetry(1) !== null ||
    retryGov.allowRetry(2) !== null ||
    retryGov.allowRetry(3) !== 'Retry cap exceeded: 3 retries per operation' ||
    retryGov.allowRetry(-1) !== 'Retry count must be a non-negative integer' ||
    retryGov.allowRetry(1.5) !== 'Retry count must be a non-negative integer'
  ) {
    return { passed: false, message: 'allowRetry must enforce the retry-attempt count independently of output tokens' };
  }

  // --- Cost governor: budget enforcement ---
  const budgetGov = new CostGovernor({ requestBudgetUsd: 0.05 });
  budgetGov.recordFetch(100, 0.02);
  budgetGov.recordFetch(100, 0.02);
  budgetGov.recordFetch(100, 0.02);
  if (budgetGov.checkRequestBudget() !== 'Request budget exceeded: $0.05 per request') {
    return { passed: false, message: 'checkRequestBudget should fire when estimated cost exceeds budget' };
  }

  // --- SSRF address classification: special-purpose ranges fail closed --- 
  const privateAddressCases = [
    '127.0.0.1',
    '100.127.0.1',
    '192.0.2.10',
    '198.18.0.1',
    '203.0.113.8',
    '::1',
    'fc00::1',
    'fe80::1',
    '2001:db8::1',
    '2002::1',
    '3fff::1',
    '::ffff:127.0.0.1',
    '0:0:0:0:0:ffff:7f00:1',
  ];
  if (privateAddressCases.some(address => !RealDocumentFetcher.isPrivateIp(address))) {
    return { passed: false, message: 'Private, mapped-private, documentation, and special-purpose IP ranges must be blocked' };
  }
  const publicAddressCases = ['8.8.8.8', '1.1.1.1', '2001:4860:4860::8888', '2606:4700:4700::1111'];
  if (publicAddressCases.some(address => RealDocumentFetcher.isPrivateIp(address))) {
    return { passed: false, message: 'Globally-routable IPv4 and IPv6 addresses must remain fetchable' };
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

  // Job-scoped cleanup removes both artifact kinds for the selected job.
  // Other jobs' files must remain untouched.
  await storage.putRaw('src-2', 'job-2', 'https://example.test/src-2', 'text/plain', Buffer.from('other job'));
  await storage.putNormalizedText('src-2', 'job-2', 'other normalized content');
  await storage.putRaw('src-3', 'job-1', 'https://example.test/src-3', 'text/plain', Buffer.from('second source'));
  await storage.deleteJob('job-1');
  if (
    await storage.getRaw(ref) !== null ||
    await storage.getNormalizedText(textRef) !== null ||
    await storage.getRaw(artifactRef('src-3', 'job-1', 'raw')) !== null ||
    (await storage.getRaw(artifactRef('src-2', 'job-2', 'raw')))?.toString() !== 'other job'
  ) {
    return { passed: false, message: 'Job-scoped artifact cleanup must remove all artifacts for one job without touching another job' };
  }

  const parsedArtifactRef = parseArtifactRef(ref);
  if (
    parsedArtifactRef?.job_id !== 'job-1' ||
    parsedArtifactRef?.source_id !== 'src-1' ||
    parsedArtifactRef?.kind !== 'raw'
  ) {
    return { passed: false, message: 'Artifact references must preserve job_id and source_id path segments in their correct fields' };
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

    // --- Structured log envelope shape (production stdout-JSON path) ---
  // logEnvelope routes through logger.info -> emit() -> JSON-lines on stdout
  // ONLY when NODE_ENV=production (the real deployment path). This test must
  // exercise that production path, not the human-readable dev formatter, so we
  // force NODE_ENV=production locally, run the assertion, then restore it.
  const savedNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  const written: string[] = [];
  // In production mode emit() writes non-error levels (info/debug/warn) to
  // process.stdout. Capture it to validate the structured JSON path.
  const stream = process.stdout;
  const origWrite = stream.write.bind(stream);
  const capture = (chunk: any): boolean => {
    written.push(String(chunk));
    return true;
  };
  (stream as any).write = capture;
  try {
    logEnvelope(
      'stage',
      {
        request_id: 'req-1',
        user_id: 'usr-1',
        job_id: 'job-1',
        stage: 'PLANNING',
        status: 'success',
        duration_ms: 8,
      },
      'Planning stage completed',
    );
  } finally {
    (stream as any).write = origWrite;
    process.env.NODE_ENV = savedNodeEnv;
  }

  const raw = written.join('');
  // Production JSON-lines: one trimmed line per emit() call.
  const line = raw.trim().split('\n').pop();
  if (!line) {
    return { passed: false, message: 'logEnvelope should emit a line' };
  }
  const envelope = JSON.parse(line); // { timestamp, level, service, environment, event, message, ... }

  if (
    envelope.event !== 'stage' ||
    envelope.request_id !== 'req-1' ||
    envelope.user_id !== 'usr-1' ||
    envelope.job_id !== 'job-1' ||
    envelope.stage !== 'PLANNING' ||
    envelope.status !== 'success' ||
    envelope.duration_ms !== 8 ||
    envelope.message !== 'Planning stage completed'
  ) {
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
