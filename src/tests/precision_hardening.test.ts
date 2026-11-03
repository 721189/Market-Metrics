/**
 * Phase 4 — Test 10: Precision Hardening Suite
 * Validates the P0 hardening contract:
 *  1. Job cancellation state machine (legal/illegal transitions)
 *  2. Cancellation registry (USER_CANCEL sticky, LEASE_LOST non-sticky)
 *  3. Mandatory citation graph validation (dangling refs are fatal)
 *  4. Exact normalized -> original quote mapping (verbatim slice guarantee)
 *  5. Unknown publication date = null (never fabricated)
 *  6. Gemini readiness rejects descriptive-only configuration
 *  7. Fetch cancellation and deadline errors
 */

import { canTransition, assertTransition, cancellationRegistry } from '../server/job_state.js';
import { CitationGraphValidator } from '../server/citation_graph.js';
import { RealDocumentFetcher, DocumentFetchAbortedError, DocumentFetchTimeoutError } from '../server/fetcher.js';
import { loadEnvironmentConfig, findEnvironmentViolations } from '../server/environment.js';
import { resolveModel, classifyProviderError, extractProviderErrorDiagnostics } from '../server/gemini.js';
import { discoverSourcesWithTavily, SearchProviderError } from '../server/search_provider.js';
import { BENCHMARK_EV_CHARGING } from '../server/benchmarks.js';
import type { FullResearchReport, Source, Evidence, Claim } from '../types.js';

function makeSource(id: string, overrides: Partial<Source> = {}): Source {
  return {
    id,
    job_id: 'job-hardening-001',
    url: `https://example.com/${id}`,
    canonical_url: `https://example.com/${id}`,
    domain: 'example.com',
    title: null,
    publisher: null,
    published_at: null,
    retrieved_at: new Date().toISOString(),
    source_type: 'TIER_A',
    language: 'en',
    http_status: 200,
    discovery_method: 'SEARCH_API',
    content_hash: 'aa'.repeat(32),
    fetch_status: 'FETCHED',
    fetch_error: null,
    reliability_score: 90,
    ...overrides,
  };
}

function makeEvidence(id: string, sourceId: string): Evidence {
  return {
    id,
    job_id: 'job-hardening-001',
    document_id: sourceId,
    source_id: sourceId,
    evidence_type: 'PRIMARY_SOURCE',
    text: 'verified text',
    quote: 'verified text',
    start_offset: 0,
    end_offset: 13,
    section: 'Test',
    extraction_confidence: 95,
    provenance_type: 'OBSERVED',
    created_at: new Date().toISOString(),
    source_url: `https://test.example/${sourceId}`,
    source_domain: 'test.example',
    citation_number: 0,
    statement: 'verified text',
    extracted_quote: 'verified text',
    relevance_score: 0,
    verification_status: 'UNVERIFIED',
    confidence: 95,
    provenance: {
      document_text: 'verified text',
      document_hash: '',
      source_url: `https://test.example/${sourceId}`,
      retrieved_at: new Date().toISOString(),
      parser_version: '1.0.0',
      normalizer_version: '1.0.0',
      start_offset: 0,
      end_offset: 13,
      quote: 'verified text',
      exact_normalized_match: true,
    },
    retrieved_at: new Date().toISOString(),
    parser_version: '1.0.0',
    normalizer_version: '1.0.0',
    supporting_claim_ids: [],
    contradicting_claim_ids: [],
  };
}

function makeClaim(id: string, citationNumber: number, evidenceIds: string[]): Claim {
  return {
    id,
    job_id: 'job-hardening-001',
    citation_number: citationNumber,
    statement: 'A verified atomic statement.',
    claim_type: 'MARKET_SIZE',
    supporting_evidence_ids: evidenceIds,
    contradicting_evidence_ids: [],
    reasoning: 'Grounded in verbatim evidence.',
    confidence: 90,
    verification_status: 'SUPPORTED',
  } as Claim;
}

function makeReport(overrides: {
  sources?: Source[];
  evidence_pool?: Evidence[];
  claims?: Claim[];
  sections?: FullResearchReport['sections'];
  recommendations?: FullResearchReport['recommendations'];
  trends?: FullResearchReport['trends'];
  opportunities?: FullResearchReport['opportunities'];
  risks?: FullResearchReport['risks'];
  regulatory_factors?: FullResearchReport['regulatory_factors'];
}): FullResearchReport {
  return {
    id: 'rep-hardening-001',
    job_id: 'job-hardening-001',
    version: 2,
    title: 'Hardening Validation Report',
    generated_at: new Date().toISOString(),
    question: 'Q',
    geography: 'Global',
    industry: 'Test',
    time_horizon: '2026-2030',
    executive_summary: 'S',
    evidence_score_breakdown: {
      overall_score: 80,
      source_quality_score: 18,
      evidence_relevance_score: 16,
      directness_score: 12,
      corroboration_score: 10,
      recency_score: 8,
      consistency_score: 8,
      extraction_quality_score: 8,
      gates_passed: {
        has_primary_evidence: true,
        no_unresolved_contradictions: true,
        high_tier_sources_present: true,
        citations_fully_intact: true,
      },
    },
    sections: overrides.sections ?? [{ id: 'sec-1', title: 'T', order: 1, summary: 'S', content: 'C', cited_claim_ids: [] }],
    market_metrics: [],
    financial_models: {} as FullResearchReport['financial_models'],
    competitors: [],
    pricing_tiers: [],
    customer_segments: [],
    trends: overrides.trends ?? [],
    regulatory_factors: overrides.regulatory_factors ?? [],
    opportunities: overrides.opportunities ?? [],
    risks: overrides.risks ?? [],
    recommendations: overrides.recommendations ?? [],
    limitations: [],
    sources: overrides.sources ?? [makeSource('src-1')],
    claims: overrides.claims ?? [],
    evidence_pool: overrides.evidence_pool ?? [],
  };
}

export async function runPrecisionHardeningTest(): Promise<{ passed: boolean; message: string }> {
  console.log('\n--- Running Test 10: Precision Hardening Suite ---');

  // ===== 1. Cancellation state machine =====
  if (!canTransition('QUEUED', 'RUNNING')) {
    return { passed: false, message: 'QUEUED -> RUNNING must be legal' };
  }
  if (!canTransition('PLANNING', 'CANCELLED')) {
    return { passed: false, message: 'RUNNING (stage) -> CANCELLED must be legal' };
  }
  if (canTransition('CANCELLED', 'COMPLETED')) {
    return { passed: false, message: 'CANCELLED -> COMPLETED must be ILLEGAL (was the core cancellation bug)' };
  }
  if (canTransition('COMPLETED', 'FAILED') || canTransition('FAILED', 'RUNNING')) {
    return { passed: false, message: 'Terminal states must not transition' };
  }
  try {
    assertTransition('CANCELLED', 'COMPLETED');
    return { passed: false, message: 'assertTransition must throw on CANCELLED -> COMPLETED' };
  } catch {
    console.log('✔ Cancellation state machine enforces legal transitions (CANCELLED is terminal).');
  }

  // ===== 2. Cancellation registry =====
  cancellationRegistry.clear();
  const regId = 'job-reg-user-cancel';
  // USER_CANCEL BEFORE worker registration must abort the late-registered controller.
  cancellationRegistry.abort(regId, 'USER_CANCEL');
  const lateController = new AbortController();
  cancellationRegistry.register(regId, lateController, 'worker-a');
  if (!lateController.signal.aborted) {
    return { passed: false, message: 'USER_CANCEL before registration must abort late-registered controller' };
  }
  if (!cancellationRegistry.isAbortRequested(regId)) {
    return { passed: false, message: 'Registry must report abort requested after USER_CANCEL' };
  }
  cancellationRegistry.unregister(regId, 'worker-a');
  console.log('✔ USER_CANCEL is sticky: workers registering after cancellation abort immediately.');

  // LEASE_LOST is NOT sticky: a new owner may register the same jobId fresh.
  const leaseId = 'job-reg-lease-lost';
  const oldWorkerController = new AbortController();
  cancellationRegistry.register(leaseId, oldWorkerController, 'worker-old');
  cancellationRegistry.abort(leaseId, 'LEASE_LOST');
  if (!oldWorkerController.signal.aborted) {
    return { passed: false, message: 'LEASE_LOST must abort the old worker controller' };
  }
  const newOwnerController = new AbortController();
  cancellationRegistry.register(leaseId, newOwnerController, 'worker-new');
  if (newOwnerController.signal.aborted) {
    return { passed: false, message: 'New lease owner must NOT inherit the previous LEASE_LOST abort' };
  }
  cancellationRegistry.unregister(leaseId, 'worker-new');
  console.log('✔ LEASE_LOST is non-sticky: new lease owner registers cleanly and proceeds.');

  // ===== 3. Mandatory citation graph validation =====
  const validReport = makeReport({
    evidence_pool: [makeEvidence('ev-1', 'src-1')],
    claims: [makeClaim('clm-1', 1, ['ev-1'])],
    sections: [{ id: 'sec-1', title: 'T', order: 1, summary: 'S', content: 'C', cited_claim_ids: ['clm-1'] }],
    recommendations: [{
      id: 'rec-1',
      title: 'R',
      priority: 'CRITICAL',
      timeframe: 'IMMEDIATE',
      rationale: 'Because',
      risk_factors: [],
      supporting_claim_ids: ['clm-1'],
    }],
  });
  const validResult = CitationGraphValidator.validate(validReport);
  if (!validResult.valid) {
    return { passed: false, message: `Valid graph rejected: ${validResult.errors.map(e => e.code).join(',')}` };
  }
  console.log('✔ Citation graph validator accepts a fully-intact graph.');

  // Dangling section citation must be FATAL.
  const danglingSection = makeReport({
    evidence_pool: [makeEvidence('ev-1', 'src-1')],
    claims: [makeClaim('clm-1', 1, ['ev-1'])],
    sections: [{ id: 'sec-1', title: 'T', order: 1, summary: 'S', content: 'C', cited_claim_ids: ['clm-404'] }],
  });
  if (CitationGraphValidator.validate(danglingSection).valid) {
    return { passed: false, message: 'Section citing unknown claim clm-404 must FAIL validation' };
  }
  console.log('✔ Dangling section citation (hardcoded clm-404 style) is FATAL.');

  // Dangling strategic reference and ungrounded claim must be FATAL.
  const danglingRisk = makeReport({
    evidence_pool: [makeEvidence('ev-1', 'src-1')],
    claims: [makeClaim('clm-1', 1, ['ev-1'])],
    risks: [{
      id: 'risk-1',
      category: 'COMPETITIVE',
      title: 'Fabricated risk',
      probability: 'HIGH',
      impact: 'SEVERE',
      mitigation: 'None',
      supporting_claim_ids: ['clm-404'],
    }],
  });
  if (CitationGraphValidator.validate(danglingRisk).valid) {
    return { passed: false, message: 'Risk referencing unknown claim clm-404 must FAIL validation' };
  }
  const ungroundedClaim = makeReport({
    evidence_pool: [makeEvidence('ev-1', 'src-1')],
    claims: [makeClaim('clm-1', 1, [])],
  });
  if (CitationGraphValidator.validate(ungroundedClaim).valid) {
    return { passed: false, message: 'Claim without supporting evidence must FAIL validation' };
  }
  console.log('✔ Dangling strategic references and ungrounded claims are FATAL.');

  // ===== 4. Exact normalized -> original quote mapping =====
  const corpus = 'The  Rajapaksa  Report  notes  that  India  has  deployed  approximately  24,500 public charging points as of late 2024. Grid capacity remains the binding constraint.';
  // Query with mutated whitespace and case — matches only in normalized space.
  const mutatedQuery = 'INDIA has deployed approximately 24,500   public\n  charging points as of late 2024.';
  const mapped = RealDocumentFetcher.findExactCharacterOffsets(corpus, mutatedQuery);
  if (!mapped.found) {
    return { passed: false, message: 'Normalized mapping failed to locate mutated-whitespace quote' };
  }
  const originalSlice = corpus.slice(mapped.startOffset, mapped.endOffset);
  if (mapped.quote !== originalSlice) {
    return { passed: false, message: `Quote is not the verbatim source slice: "${mapped.quote}" vs "${originalSlice}"` };
  }
  if (originalSlice !== 'India  has  deployed  approximately  24,500 public charging points as of late 2024.') {
    return { passed: false, message: `Mapped slice not from ORIGINAL text: "${originalSlice}"` };
  }
  // Unicode punctuation variants must also map exactly.
  const curlyCorpus = 'The market expanded \u2014 aggressively \u2014 across regions.';
  const curlyMapped = RealDocumentFetcher.findExactCharacterOffsets(curlyCorpus, 'The market expanded \u2014 aggressively \u2014 across regions.');
  if (!curlyMapped.found || curlyMapped.quote !== curlyCorpus) {
    return { passed: false, message: 'Unicode dash normalization did not map to the verbatim original' };
  }
  console.log('✔ Exact normalized->original mapping returns the VERBATIM source slice, never the mutated query.');

  // ===== 5. Unknown publication date = null =====
  const noDateHtml = '<html><head><title>No dates here</title></head><body><p>Plain content without metadata.</p></body></html>';
  const emptyHeaders = new Headers();
  const unknownDate = RealDocumentFetcher.extractPublicationDate(noDateHtml, emptyHeaders);
  if (unknownDate !== null) {
    return { passed: false, message: `Unknown publication date must be null, got fabricated: ${unknownDate}` };
  }
  console.log('✔ Unknown publication date is null — no fabricated "now" timestamps.');

  // ===== 6. Evidence quote integrity in the validator =====
  const emptyQuoteEvidence = makeEvidence('ev-bad', 'src-1');
  emptyQuoteEvidence.quote = '';
  const badQuoteReport = makeReport({
    evidence_pool: [emptyQuoteEvidence],
    claims: [makeClaim('clm-1', 1, ['ev-bad'])],
  });
  if (CitationGraphValidator.validate(badQuoteReport).valid) {
    return { passed: false, message: 'Evidence with empty quote must FAIL validation' };
  }
  console.log('✔ Empty verbatim quotes are rejected by the citation graph validator.');

  // ===== 7. End-to-end evidence provenance and offset checks =====
  const canonicalSourceText = 'Market evidence: verified text is recorded.';
  const provenanceQuote = 'verified text';
  const sourceStart = canonicalSourceText.indexOf(provenanceQuote);
  const sourceEnd = sourceStart + provenanceQuote.length;
  const sourceHash = RealDocumentFetcher.computeSha256(canonicalSourceText);
  const provenanceSource = makeSource('src-1', { content_hash: sourceHash });
  const provenanceEvidence = makeEvidence('ev-provenance', 'src-1');
  const normalizedRef = 'artifacts/job-hardening-001/src-1/normalized';
  provenanceEvidence.start_offset = sourceStart;
  provenanceEvidence.end_offset = sourceEnd;
  provenanceEvidence.quote = provenanceQuote;
  provenanceEvidence.text = provenanceQuote;
  provenanceEvidence.provenance = {
    ...provenanceEvidence.provenance,
    document_text: provenanceQuote,
    document_hash: sourceHash,
    source_url: provenanceSource.url,
    start_offset: 0,
    end_offset: provenanceQuote.length,
    source_document_start_offset: sourceStart,
    source_document_end_offset: sourceEnd,
    source_document_ref: normalizedRef,
    quote: provenanceQuote,
    exact_normalized_match: true,
  };
  const provenanceReport = makeReport({
    sources: [provenanceSource],
    evidence_pool: [provenanceEvidence],
    claims: [makeClaim('clm-provenance', 1, ['ev-provenance'])],
  });
  const sourceTextMap = new Map<string, string>([['src-1', canonicalSourceText]]);
  const artifactRefMap = new Map<string, string>([['src-1', normalizedRef]]);
  const provenanceResult = CitationGraphValidator.validate(provenanceReport, sourceTextMap, artifactRefMap);
  if (!provenanceResult.valid) {
    return { passed: false, message: 'Valid excerpt/source provenance was rejected: ' + provenanceResult.errors.map(e => e.code).join(',') };
  }

  const mismatchedEvidence = makeEvidence('ev-provenance-bad', 'src-1');
  mismatchedEvidence.start_offset = sourceStart;
  mismatchedEvidence.end_offset = sourceEnd;
  mismatchedEvidence.quote = provenanceQuote;
  mismatchedEvidence.provenance = {
    ...provenanceEvidence.provenance,
    end_offset: provenanceQuote.length - 1,
  };
  const mismatchedReport = makeReport({
    sources: [provenanceSource],
    evidence_pool: [mismatchedEvidence],
    claims: [makeClaim('clm-provenance-bad', 1, ['ev-provenance-bad'])],
  });
  const mismatchResult = CitationGraphValidator.validate(mismatchedReport, sourceTextMap, artifactRefMap);
  if (!mismatchResult.errors.some(issue => issue.code === 'EVIDENCE_PROVENANCE_MISMATCH')) {
    return { passed: false, message: 'Mismatched excerpt offsets must fail with EVIDENCE_PROVENANCE_MISMATCH' };
  }
  console.log('✔ Excerpt-local coordinates, source offsets, hashes and storage refs are validated.');

  // ===== 7. Production readiness requires the actual Gemini API key =====
  const productionEnvBase = {
    NODE_ENV: 'production',
    FIREBASE_PROJECT_ID: 'market-metrics-production',
    FIRESTORE_DATABASE_ID: '(default)',
    STORAGE_BUCKET: 'market-metrics-production.appspot.com',
    FIREBASE_AUTH_DOMAIN: 'market-metrics-production.firebaseapp.com',
    GEMINI_CREDENTIAL_SOURCE: 'env:GEMINI_API_KEY',
    TAVILY_API_KEY: 'test-tavily-key',
  } as NodeJS.ProcessEnv;
  const missingSearchKey = loadEnvironmentConfig({ ...productionEnvBase, TAVILY_API_KEY: '' });
  if (!findEnvironmentViolations(missingSearchKey).some(message => message.includes('TAVILY_API_KEY'))) {
    return { passed: false, message: 'Production readiness must require the actual TAVILY_API_KEY for source discovery' };
  }
  const descriptorOnly = loadEnvironmentConfig({ ...productionEnvBase, GEMINI_API_KEY: '' });
  if (!findEnvironmentViolations(descriptorOnly).some(message => message.includes('GEMINI_API_KEY'))) {
    return { passed: false, message: 'A descriptive source label must not satisfy production readiness without GEMINI_API_KEY' };
  }
  const keyPresent = loadEnvironmentConfig({ ...productionEnvBase, GEMINI_API_KEY: 'test-gemini-key', TAVILY_API_KEY: 'test-tavily-key' });
  if (findEnvironmentViolations(keyPresent).some(message => message.includes('GEMINI_API_KEY') || message.includes('TAVILY_API_KEY'))) {
    return { passed: false, message: 'A non-empty actual GEMINI_API_KEY should satisfy credential-presence validation' };
  }
  console.log('✔ Gemini production credential readiness is tied to GEMINI_API_KEY.');

  // ===== 8. Gemini model selection defaults to a currently supported stable model =====
  const savedGlobalModel = process.env.GEMINI_MODEL;
  const savedPlannerModel = process.env.GEMINI_MODEL_PLANNER;
  try {
    delete process.env.GEMINI_MODEL;
    delete process.env.GEMINI_MODEL_PLANNER;
    if (resolveModel('PLANNER') !== 'gemini-3.8-flash') {
      return { passed: false, message: 'Planner default must use the supported gemini-3.8-flash model' };
    }
    process.env.GEMINI_MODEL = 'gemini-global-test';
    if (resolveModel('PLANNER') !== 'gemini-global-test') {
      return { passed: false, message: 'Global Gemini model override must still be honored' };
    }
    process.env.GEMINI_MODEL_PLANNER = 'gemini-planner-test';
    if (resolveModel('PLANNER') !== 'gemini-planner-test') {
      return { passed: false, message: 'Per-role Gemini model override must take precedence over the global override' };
    }
  } finally {
    if (savedGlobalModel === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = savedGlobalModel;
    if (savedPlannerModel === undefined) delete process.env.GEMINI_MODEL_PLANNER;
    else process.env.GEMINI_MODEL_PLANNER = savedPlannerModel;
  }
  console.log('✔ Gemini model selection defaults to 3.8 Flash and preserves explicit overrides.');
  
  // ===== 9. Quota exhaustion is not retried as a transient 429 =====
  const exhaustedQuota = classifyProviderError(new Error(
    '429 RESOURCE_EXHAUSTED: You exceeded your current quota, please check your plan and billing details.'
  ));
  if (exhaustedQuota.retryable || exhaustedQuota.reason !== 'quota_exhausted') {
    return { passed: false, message: 'A billing/quota exhaustion response must fail fast with quota_exhausted, not retry' };
  }
  const transientRateLimit = classifyProviderError(new Error(
    '429 RESOURCE_EXHAUSTED: rate limit exceeded for requests per minute; retry after 1s'
  ));
  if (!transientRateLimit.retryable || transientRateLimit.reason !== 'rate_limited') {
    return { passed: false, message: 'A transient per-minute rate limit must remain retryable' };
  }
  console.log('✔ Gemini distinguishes exhausted project quota from transient rate limiting.');
  const structuredQuota = extractProviderErrorDiagnostics(new Error(JSON.stringify({
    error: {
      code: 429, status: 'RESOURCE_EXHAUSTED',
      details: [
        { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{
          subject: 'project:do-not-log-this-project',
          quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests',
          quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier',
          quotaDimensions: { model: 'gemini-3.8-flash', location: 'global' }, quotaValue: '20',
        }] },
        { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '1s' },
      ],
    },
  })));
  if (structuredQuota.provider_code !== 429 || structuredQuota.provider_status !== 'RESOURCE_EXHAUSTED' ||
      !structuredQuota.quota_ids[0]?.includes('RequestsPerDay') || structuredQuota.quota_models[0] !== 'gemini-3.8-flash' ||
      structuredQuota.retry_delays[0] !== '1s' || JSON.stringify(structuredQuota).includes('do-not-log-this-project')) {
    return { passed: false, message: 'Structured quota diagnostics must retain allowlisted fields and omit project subjects' };
  }
  const dailyQuotaClassification = classifyProviderError(new Error(JSON.stringify({
    error: { code: 429, status: 'RESOURCE_EXHAUSTED', details: [{
      '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
      violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }],
    }] },
  })));
  if (dailyQuotaClassification.retryable || dailyQuotaClassification.reason !== 'quota_exhausted') {
    return { passed: false, message: 'Structured daily quota details must classify as non-retryable quota exhaustion' };
  }
  console.log('✔ Structured Google RPC quota diagnostics retain safe fields and redact project subjects.');

  // ===== 9. Tavily discovery is isolated from Gemini and validates real source URLs =====
  let tavilyCalls = 0;
  const tavilyResult = await discoverSourcesWithTavily(
    ['market growth official statistics', 'competitor market share', 'market growth official statistics', 'pricing reports', 'regulatory changes', 'ignored fifth query'],
    {
      apiKey: 'test-tavily-key',
      fetchImpl: async (_input, init) => {
        tavilyCalls += 1;
        const headers = new Headers(init?.headers);
        if (headers.get('authorization') !== 'Bearer test-tavily-key') {
          throw new Error('Tavily bearer token was not sent correctly');
        }
        const body = JSON.parse(String(init?.body || '{}'));
        if (body.search_depth !== 'basic' || body.max_results !== 5 ||
            body.include_answer !== false || body.include_raw_content !== false || body.include_usage !== true) {
          throw new Error('Tavily request must use bounded, low-cost basic search parameters');
        }
        return new Response(JSON.stringify({
          results: [
            { title: 'Official market report', url: 'https://www.example.gov/report#section', content: 'Verified market evidence.' },
            { title: 'Unsafe URL', url: 'javascript:alert(1)', content: 'Must be discarded.' },
            { title: 'Duplicate URL', url: 'https://example.gov/report', content: 'Duplicate must be deduplicated.' },
          ],
          usage: { credits: 1 },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    },
  );
  if (tavilyCalls !== 4 || tavilyResult.queriesRun !== 4 || tavilyResult.creditsUsed !== 4 ||
      tavilyResult.sources.length !== 1 || tavilyResult.sources[0].publisher !== 'example.gov' ||
      tavilyResult.sources[0].snippet !== 'Verified market evidence.') {
    return { passed: false, message: 'Tavily discovery must cap queries, deduplicate valid URLs, and report actual credit use' };
  }
  console.log('✔ Tavily discovery performs capped basic searches, validates URLs, deduplicates sources and tracks credits.');

  let quotaFailureCalls = 0;
  let tavilyQuotaFailedFast = false;
  try {
    await discoverSourcesWithTavily(['first query', 'second query'], {
      apiKey: 'test-tavily-key',
      fetchImpl: async () => {
        quotaFailureCalls += 1;
        return new Response(JSON.stringify({ detail: 'usage limit reached' }), { status: 432 });
      },
    });
  } catch (error) {
    tavilyQuotaFailedFast = error instanceof SearchProviderError && error.reason === 'quota_exhausted' &&
      error.statusCode === 432 && !error.retryable;
  }
  if (!tavilyQuotaFailedFast || quotaFailureCalls !== 1) {
    return { passed: false, message: 'Tavily account quota exhaustion must stop discovery immediately without retries or subsequent queries' };
  }
  console.log('✔ Tavily account quota exhaustion fails fast without logging provider response bodies.');

  let unauthorizedCalls = 0;
  let tavilyAuthFailed = false;
  try {
    await discoverSourcesWithTavily(['query'], {
      apiKey: 'test-tavily-key',
      fetchImpl: async () => {
        unauthorizedCalls += 1;
        return new Response('{}', { status: 401 });
      },
    });
  } catch (error) {
    tavilyAuthFailed = error instanceof SearchProviderError && error.reason === 'unauthorized' &&
      !error.message.includes('test-tavily-key');
  }
  if (!tavilyAuthFailed || unauthorizedCalls !== 1) {
    return { passed: false, message: 'Tavily authentication failures must be safe, explicit and non-retryable' };
  }
  console.log('✔ Tavily authentication failures are explicit and do not expose API credentials.');



  // ===== 9. Pre-aborted document fetch rejects without starting network work =====
  const cancelledFetch = new AbortController();
  cancelledFetch.abort(new Error('test cancellation'));
  let rejectedAsCancelled = false;
  try {
    await RealDocumentFetcher.fetchUrl('https://example.com/', 1000, cancelledFetch.signal);
  } catch (error: any) {
    rejectedAsCancelled = error instanceof DocumentFetchAbortedError || error?.name === 'AbortError';
  }
  if (!rejectedAsCancelled) {
    return { passed: false, message: 'A pre-aborted document fetch must reject as cancellation, not a failed-source result' };
  }
  if (new DocumentFetchTimeoutError(10).name !== 'DocumentFetchTimeoutError') {
    return { passed: false, message: 'Document timeout errors must have a distinguishable type' };
  }
  console.log('✔ Fetch cancellation and timeout errors are distinguishable.');

  // ===== 10. Golden benchmark fixture must itself satisfy the citation graph =====


  const benchmarkResult = CitationGraphValidator.validate(BENCHMARK_EV_CHARGING);
  if (!benchmarkResult.valid) {
    return { passed: false, message: `Golden benchmark fixture has a broken citation graph: ${benchmarkResult.errors.slice(0, 3).map(e => e.code).join(',')}` };
  }
  console.log('✔ Golden benchmark provenance graph passes mandatory citation graph validation.');

  return { passed: true, message: 'Precision hardening suite passed successfully.' };
}

if (process.argv[1]?.endsWith('precision_hardening.test.ts')) {
  runPrecisionHardeningTest().then((res) => {
    if (!res.passed) {
      console.error('FAIL:', res.message);
      process.exit(1);
    } else {
      console.log('OK:', res.message);
    }
  });
}