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
import { RealClaimVerifier, ContradictionEngine } from '../server/claim_engine.js';
import { loadEnvironmentConfig, findEnvironmentViolations, resolveEnvironmentName, APPLET_DEV_PROJECT_ID } from '../server/environment.js';
import { resolveModel } from '../server/gemini.js';
import { classifyDomainTier } from '../server/pipeline.js';
import { extractVerifiedMarketSizing, FinancialEngine } from '../server/financial.js';
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
  } as NodeJS.ProcessEnv;
  const descriptorOnly = loadEnvironmentConfig({ ...productionEnvBase, GEMINI_API_KEY: '' });
  if (!findEnvironmentViolations(descriptorOnly).some(message => message.includes('GEMINI_API_KEY'))) {
    return { passed: false, message: 'A descriptive source label must not satisfy production readiness without GEMINI_API_KEY' };
  }
  const keyPresent = loadEnvironmentConfig({ ...productionEnvBase, GEMINI_API_KEY: 'test-gemini-key' });
  if (findEnvironmentViolations(keyPresent).some(message => message.includes('GEMINI_API_KEY'))) {
    return { passed: false, message: 'A non-empty actual GEMINI_API_KEY should satisfy credential-presence validation' };
  }
  console.log('✔ Gemini production credential readiness is tied to GEMINI_API_KEY.');
  const unitEconomics = FinancialEngine.calculateUnitEconomics({
    arpu_annual: 1200,
    gross_margin_pct: 80,
    annual_churn_rate_pct: 10,
    cac: 400,
    sales_cycle_months: 3,
  });
  if (unitEconomics.ltv !== 9600 || unitEconomics.payback_period_months !== 5 ||
      unitEconomics.net_revenue_retention_pct !== null ||
      unitEconomics.rule_of_40_score !== null ||
      unitEconomics.sales_cycle_months !== 3) {
    return { passed: false, message: 'Unit economics must not fabricate NRR or Rule of 40 without expansion, growth, and operating-margin inputs' };
  }
  const fullySpecifiedEconomics = FinancialEngine.calculateUnitEconomics({
    arpu_annual: 1200,
    gross_margin_pct: 80,
    annual_churn_rate_pct: 10,
    cac: 400,
    sales_cycle_months: 3,
    expansion_rate_pct: 20,
    revenue_growth_pct: 30,
    operating_margin_pct: 10,
  });
  if (fullySpecifiedEconomics.net_revenue_retention_pct !== 110 || fullySpecifiedEconomics.rule_of_40_score !== 40) {
    return { passed: false, message: 'NRR and Rule of 40 must use explicit expansion, revenue growth, and operating margin' };
  }
  const scenarioInputs = FinancialEngine.generateScenarios(1000, 500, 80, 'USD', 200, 3);
  if (scenarioInputs.scenario_conservative.customer_count !== 100 ||
      scenarioInputs.scenario_base.customer_count !== 200 ||
      scenarioInputs.scenario_aggressive.customer_count !== 300 ||
      scenarioInputs.scenario_base.year_3_revenue !== 200000) {
    return { passed: false, message: 'Scenario revenue must derive from explicit customer-count assumptions, not fixed invented customer counts' };
  }
  const zeroShare = FinancialEngine.calculateMarketSizing({
    tam_current: 1000, tam_forecast: 1200, year_start: 2025, year_end: 2026,
    sam_share_pct: 0, som_share_pct: 0, currency: 'USD',
  });
  if (zeroShare.sam !== 0 || zeroShare.som !== 0) {
    return { passed: false, message: 'Market sizing must allow legitimate zero SAM/SOM shares without forcing a 1% floor' };
  }

  if (FinancialEngine.calculateCAGR(0, 100, 5) !== null ||
      FinancialEngine.calculateCAGR(100, 200, 0) !== null) {
    return { passed: false, message: 'Invalid CAGR inputs must be represented as unavailable, not zero growth' };
  }
  if (
    FinancialEngine.formatCurrency(1_000_000, 'USD') !== '$1.00M' ||
    FinancialEngine.formatCurrency(1_000_000, 'EUR') !== '€1.00M' ||
    FinancialEngine.formatCurrency(1_000_000, 'GBP') !== '£1.00M' ||
    FinancialEngine.formatCurrency(100_000_000, 'INR') !== '₹1.00 Cr' ||
    FinancialEngine.formatCurrency(1_000_000, 'JPY') !== '1,000,000 JPY'
  ) {
    return { passed: false, message: 'Currency formatting must preserve the explicit currency and never label EUR/GBP/unknown amounts as USD' };
  }

  const tenPercentChurnScenarios = FinancialEngine.generateScenarios(1000, 1000, 80, 'USD', 100, 2.8, 10);
  if (tenPercentChurnScenarios.scenario_base.ltv !== 8000) {
    return { passed: false, message: 'Scenario base-case LTV must use the live churn assumption supplied by the calculator' };
  }

  const invalidSizing = FinancialEngine.calculateMarketSizing({
    tam_current: 1000, tam_forecast: 1200, year_start: 2030, year_end: 2025,
    sam_share_pct: 40, som_share_pct: 10, currency: 'USD',
  });
  if (invalidSizing.cagr_pct !== null || invalidSizing.years !== 0) {
    return { passed: false, message: 'Market sizing must reject reversed forecast periods' };
  }

  const verifiedTam = makeClaim('clm-tam-verified', 1, []);
  verifiedTam.claim_type = 'MARKET_SIZE';
  verifiedTam.verification_status = 'SUPPORTED';
  verifiedTam.statement = 'The total addressable market was USD 8.4 billion in 2025 and is projected to reach USD 41.2 billion by 2030.';
  const verifiedCagr = makeClaim('clm-cagr-verified', 2, []);
  verifiedCagr.claim_type = 'MARKET_GROWTH';
  verifiedCagr.verification_status = 'CORROBORATED';
  verifiedCagr.statement = 'The market is expected to grow at a 37.4% CAGR from 2025 to 2030.';
  const verifiedSam = makeClaim('clm-sam-verified', 3, []);
  verifiedSam.claim_type = 'MARKET_SIZE';
  verifiedSam.verification_status = 'SUPPORTED';
  verifiedSam.statement = 'The serviceable available market (SAM) is USD 2.5 billion.';
  const verifiedSom = makeClaim('clm-som-verified', 4, []);
  verifiedSom.claim_type = 'MARKET_SIZE';
  verifiedSom.verification_status = 'SUPPORTED';
  verifiedSom.statement = 'The serviceable obtainable market (SOM) is USD 500 million.';
  const unverifiedFinancial = makeClaim('clm-tam-unverified', 5, []);
  unverifiedFinancial.claim_type = 'MARKET_SIZE';
  unverifiedFinancial.verification_status = 'INSUFFICIENT';
  unverifiedFinancial.statement = 'The total addressable market is USD 999 billion.';
  const verifiedSizing = extractVerifiedMarketSizing([
    verifiedTam, verifiedCagr, verifiedSam, verifiedSom, unverifiedFinancial,
  ]);
  if (verifiedSizing.tam_current !== 8_400_000_000 ||
      verifiedSizing.tam_forecast !== 41_200_000_000 ||
      verifiedSizing.cagr_pct !== 37.4 ||
      verifiedSizing.sam !== 2_500_000_000 ||
      verifiedSizing.som !== 500_000_000 ||
      verifiedSizing.currency !== 'USD' ||
      verifiedSizing.source_claim_ids.includes(unverifiedFinancial.id)) {
    return { passed: false, message: 'Financial metrics must be extracted only from supported claims with explicit currency and values' };
  }
  const forecastOnlyClaim = makeClaim('clm-forecast-only', 7, []);
  forecastOnlyClaim.claim_type = 'MARKET_SIZE';
  forecastOnlyClaim.verification_status = 'SUPPORTED';
  forecastOnlyClaim.statement = 'The TAM is projected to reach USD 4 billion by 2030.';
  const forecastOnlySizing = extractVerifiedMarketSizing([forecastOnlyClaim]);
  if (forecastOnlySizing.data_status !== 'SOURCE_BACKED' || forecastOnlySizing.tam_forecast !== 4_000_000_000 || forecastOnlySizing.tam_current !== null || forecastOnlySizing.year_start !== null || forecastOnlySizing.year_end !== 2030) {
    return { passed: false, message: 'A verified forecast-only market value must remain source-backed without inventing a base value' };
  }
  const ambiguousTamClaim = makeClaim('clm-tam-ambiguous', 8, []);
  ambiguousTamClaim.claim_type = 'MARKET_SIZE';
  ambiguousTamClaim.verification_status = 'SUPPORTED';
  ambiguousTamClaim.statement = 'The TAM includes USD 8 billion for enterprise and USD 4 billion for small business.';
  const ambiguousTam = extractVerifiedMarketSizing([ambiguousTamClaim]);
  if (ambiguousTam.tam_current !== null || ambiguousTam.tam_forecast !== null ||
      !ambiguousTam.limitations.some(note => note.includes('ambiguous base-to-forecast'))) {
    return { passed: false, message: 'Multiple market amounts without an explicit base-to-forecast relationship must not be misclassified as TAM and forecast' };
  }
  const currencylessClaim = makeClaim('clm-currencyless', 6, []);
  currencylessClaim.claim_type = 'MARKET_SIZE';
  currencylessClaim.verification_status = 'SUPPORTED';
  currencylessClaim.statement = 'The total addressable market is $8.4 billion.';
  const currencylessSizing = extractVerifiedMarketSizing([currencylessClaim]);
  if (currencylessSizing.tam_current !== null || currencylessSizing.currency !== null) {
    return { passed: false, message: 'Ambiguous dollar symbols must not be assumed to mean USD' };
  }

  const mismatchedBaseYear = makeClaim('clm-tam-base-2025', 9, []);
  mismatchedBaseYear.claim_type = 'MARKET_SIZE';
  mismatchedBaseYear.verification_status = 'SUPPORTED';
  mismatchedBaseYear.statement = 'The TAM was USD 100 million in 2025.';
  const mismatchedCagr = makeClaim('clm-cagr-2024-2030', 10, []);
  mismatchedCagr.claim_type = 'MARKET_GROWTH';
  mismatchedCagr.verification_status = 'SUPPORTED';
  mismatchedCagr.statement = 'The TAM CAGR was 10% from 2024 to 2030.';
  const mismatchedSizing = extractVerifiedMarketSizing([mismatchedBaseYear, mismatchedCagr]);
  if (
    mismatchedSizing.tam_current !== 100_000_000 ||
    mismatchedSizing.tam_forecast !== null ||
    mismatchedSizing.year_start !== 2025 ||
    mismatchedSizing.year_end !== null ||
    !mismatchedSizing.limitations.some(note => note.includes('CAGR period could not be matched'))
  ) {
    return { passed: false, message: 'A CAGR period beginning before the verified TAM baseline must not be applied to that baseline' };
  }

  const alignedCagr = makeClaim('clm-cagr-2025-2030', 11, []);
  alignedCagr.claim_type = 'MARKET_GROWTH';
  alignedCagr.verification_status = 'SUPPORTED';
  alignedCagr.statement = 'The TAM CAGR was 10% from 2025 to 2030.';
  const alignedSizing = extractVerifiedMarketSizing([mismatchedBaseYear, alignedCagr]);
  if (
    alignedSizing.tam_forecast !== 161_051_000 ||
    alignedSizing.year_start !== 2025 ||
    alignedSizing.year_end !== 2030
  ) {
    return { passed: false, message: 'A CAGR may extrapolate a verified TAM only when its stated start year matches the TAM baseline year' };
  }

  const cagrWithEarlierPercentage = makeClaim('clm-cagr-adjacent-percent', 12, []);
  cagrWithEarlierPercentage.claim_type = 'MARKET_GROWTH';
  cagrWithEarlierPercentage.verification_status = 'SUPPORTED';
  cagrWithEarlierPercentage.statement = 'The annual retention improved 14%, while the TAM CAGR was 10% from 2025 to 2030.';
  const cagrBoundedSizing = extractVerifiedMarketSizing([mismatchedBaseYear, cagrWithEarlierPercentage]);
  if (cagrBoundedSizing.cagr_pct !== 10 || cagrBoundedSizing.tam_forecast !== 161_051_000) {
    return { passed: false, message: 'CAGR extraction must bind to the percentage adjacent to the CAGR phrase, not an earlier unrelated percentage' };
  }

  console.log('✔ Market sizing accepts only verified claims and explicit, unambiguous currency values.');

  const trustedGovernment = classifyDomainTier('https://www.sec.gov/reports');
  const trustedPublisher = classifyDomainTier('research.bloomberg.com');
  const lookalikePublisher = classifyDomainTier('bloomberg.com.attacker.example');
  const unknownPublisher = classifyDomainTier('unlisted-research.example');
  const fakeGovernmentDomain = classifyDomainTier('reports.fake.gov.com');
  const fakeAcademicDomain = classifyDomainTier('research.fake.edu.com');
  const trustedUkGovernment = classifyDomainTier('department.gov.uk');
  const trustedUkUniversity = classifyDomainTier('research.example.ac.uk');
  if (trustedGovernment.tier !== 'TIER_A' || trustedPublisher.tier !== 'TIER_B' ||
      lookalikePublisher.reliability >= 70 || unknownPublisher.reliability >= 70 ||
      fakeGovernmentDomain.tier === 'TIER_A' || fakeAcademicDomain.tier === 'TIER_A' ||
      trustedUkGovernment.tier !== 'TIER_A' || trustedUkUniversity.tier !== 'TIER_A') {
    return { passed: false, message: 'Source credibility must use canonical host allowlists and keep unknown domains below the verification threshold' };
  }
  console.log('✔ Source credibility rejects lookalike domains and conservatively scores unknown publishers.');

  // Environment labels must never downgrade an explicitly production process.
  if (resolveEnvironmentName({ APP_ENV: 'prod', NODE_ENV: 'production' } as NodeJS.ProcessEnv) !== 'production') {
    return { passed: false, message: 'Equivalent production aliases must resolve consistently' };
  }
  let invalidEnvironmentRejected = false;
  try {
    resolveEnvironmentName({ APP_ENV: 'developmnt', NODE_ENV: 'production' } as NodeJS.ProcessEnv);
  } catch {
    invalidEnvironmentRejected = true;
  }
  if (!invalidEnvironmentRejected) {
    return { passed: false, message: 'An invalid APP_ENV must not downgrade NODE_ENV=production to development' };
  }
  let conflictingEnvironmentRejected = false;
  try {
    resolveEnvironmentName({ APP_ENV: 'development', NODE_ENV: 'production' } as NodeJS.ProcessEnv);
  } catch {
    conflictingEnvironmentRejected = true;
  }
  if (!conflictingEnvironmentRejected) {
    return { passed: false, message: 'Conflicting APP_ENV and NODE_ENV values must fail closed' };
  }
  if (resolveEnvironmentName({ APP_ENV: 'staging', NODE_ENV: 'production' } as NodeJS.ProcessEnv) !== 'staging') {
    return { passed: false, message: 'Staging may use production runtime mode while retaining isolated staging resources' };
  }
  const stagingApplet = loadEnvironmentConfig({
    APP_ENV: 'staging', NODE_ENV: 'staging',
    FIREBASE_PROJECT_ID: APPLET_DEV_PROJECT_ID,
    FIRESTORE_DATABASE_ID: 'staging-db',
    STORAGE_BUCKET: 'staging-bucket',
    FIREBASE_AUTH_DOMAIN: 'staging.firebaseapp.com',
  } as NodeJS.ProcessEnv);
  if (stagingApplet.allowViteDevServer || !findEnvironmentViolations(stagingApplet).some(v => v.includes(APPLET_DEV_PROJECT_ID))) {
    return { passed: false, message: 'Staging must reject the applet project and never mount the Vite development server' };
  }
  console.log('✔ Environment resolution rejects typos, conflicting labels, and applet reuse in staging.');


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


  // ===== 10. HTML ingestion regression tests =====
  const htmlParagraphs = [
    'The commercial market expanded steadily during the reporting period, with enterprise customers increasing their annual procurement budgets and prioritizing measurable operational efficiency improvements.',
    'Independent industry participants reported that infrastructure investment accelerated across major metropolitan regions, while procurement teams evaluated reliability, lifecycle cost, and interoperability before selecting vendors.',
    'The policy framework introduced additional compliance requirements for operators, including transparent reporting, periodic audits, and documented service-level commitments for critical infrastructure.',
    'Market participants also noted that regional differences in grid capacity, financing availability, and local permitting continue to influence the pace of deployment.',
  ];
  const htmlFixture = `<!doctype html><html><head><title>Market Outlook 2026</title></head><body><main>${htmlParagraphs.map(p => `<p>${p}</p>`).join('')}</main></body></html>`;
  const extractedHtml = RealDocumentFetcher.extractHtmlText(htmlFixture, 'https://example.com/report');
  if (!extractedHtml || htmlParagraphs.some(p => !extractedHtml.includes(p))) {
    return { passed: false, message: 'HTML extraction must preserve all substantial paragraphs in ordinary multi-paragraph pages' };
  }
  if (extractedHtml.indexOf(htmlParagraphs[0]) > extractedHtml.indexOf(htmlParagraphs[1])) {
    return { passed: false, message: 'HTML extraction must preserve document order after paragraph selection' };
  }

  const oneParagraphHtml = `<html><body><article><p>${htmlParagraphs[0]}</p></article></body></html>`;
  const oneParagraphText = RealDocumentFetcher.extractHtmlText(oneParagraphHtml, 'https://example.com/one');
  if (!oneParagraphText || !oneParagraphText.includes(htmlParagraphs[0])) {
    return { passed: false, message: 'HTML extraction must retain a single substantial paragraph' };
  }

  const tableHtml = '<html><body><table><tr><th>Year</th><th>Revenue</th></tr><tr><td>2024</td><td>₹120 crore</td></tr></table><p>' + htmlParagraphs[0] + '</p></body></html>';
  const tableText = RealDocumentFetcher.extractHtmlText(tableHtml, 'https://example.com/table');
  if (!tableText || !tableText.includes('Year') || !tableText.includes('Revenue') || !tableText.includes('₹120 crore')) {
    return { passed: false, message: 'HTML extraction must retain readable table cell values' };
  }

  const metadataHtml = '<html><head><title>Verified Report Title</title><meta property="article:published_time" content="2025-04-03T10:00:00Z"></head><body><p>Content</p></body></html>';
  if (RealDocumentFetcher.extractTitle(metadataHtml, 'https://example.com/fallback') !== 'Verified Report Title') {
    return { passed: false, message: 'HTML title extraction must use the original document title' };
  }
  const publishedDate = RealDocumentFetcher.extractPublicationDate(metadataHtml, new Headers());
  if (publishedDate !== '2025-04-03T10:00:00.000Z') {
    return { passed: false, message: 'Publication date extraction must read explicit article metadata' };
  }
  if (RealDocumentFetcher.extractPublicationDate('<html><body>no publication date</body></html>', new Headers({ 'last-modified': 'Wed, 21 Oct 2015 07:28:00 GMT' })) !== null) {
    return { passed: false, message: 'Last-Modified must not be misrepresented as a publication date' };
  }
  console.log('✔ HTML extraction preserves paragraphs, order, tables, titles, and verified publication metadata.');

  const reversedMetaHtml = '<html><head><meta content="2025-04-03T10:00:00Z" property="article:published_time"><meta content="Example Research" property="og:site_name"></head></html>';
  if (RealDocumentFetcher.extractPublicationDate(reversedMetaHtml, new Headers()) !== '2025-04-03T10:00:00.000Z') {
    return { passed: false, message: 'Publication metadata extraction must not depend on meta attribute order' };
  }
  if (RealDocumentFetcher.extractPublisher(reversedMetaHtml, 'https://example.com/report') !== 'Example Research') {
    return { passed: false, message: 'Publisher extraction must prefer explicit Open Graph site metadata' };
  }
  const graphHtml = '<script type="application/ld+json">{"@graph":[{"@type":"NewsArticle","datePublished":"2025-02-01T00:00:00Z"}]}</script>';
  if (RealDocumentFetcher.extractPublicationDate(graphHtml, new Headers()) !== '2025-02-01T00:00:00.000Z') {
    return { passed: false, message: 'Publication metadata extraction must support JSON-LD @graph structures' };
  }

  const csvText = RealDocumentFetcher.parseCsvToText('Company,Description,Revenue\r\nAcme,"Research, analytics and forecasting",120\r\nBeta,"Line one\nLine two with ""quoted"" text",240');
  if (!csvText.includes('Research, analytics and forecasting') || !csvText.includes('Line one\nLine two with "quoted" text') || !csvText.includes('120')) {
    return { passed: false, message: 'CSV extraction must preserve quoted commas, escaped quotes, and embedded newlines' };
  }
  console.log('✔ CSV extraction preserves quoted fields, escaped quotes, and multiline cells.');

  // Small, valid one-page PDF generated with ReportLab. The parser must read
  // actual PDF bytes rather than passing only a type-level or mocked check.
  const pdfFixtureBase64 = 'JVBERi0xLjMKJZOMi54gUmVwb3J0TGFiIEdlbmVyYXRlZCBQREYgZG9jdW1lbnQgKG9wZW5zb3VyY2UpCjEgMCBvYmoKPDwKL0YxIDIgMCBSCj4+CmVuZG9iagoyIDAgb2JqCjw8Ci9CYXNlRm9udCAvSGVsdmV0aWNhIC9FbmNvZGluZyAvV2luQW5zaUVuY29kaW5nIC9OYW1lIC9GMSAvU3VidHlwZSAvVHlwZTEgL1R5cGUgL0ZvbnQKPj4KZW5kb2JqCjMgMCBvYmoKPDwKL0NvbnRlbnRzIDcgMCBSIC9NZWRpYUJveCBbIDAgMCA2MTIgNzkyIF0gL1BhcmVudCA2IDAgUiAvUmVzb3VyY2VzIDw8Ci9Gb250IDEgMCBSIC9Qcm9jU2V0IFsgL1BERiAvVGV4dCAvSW1hZ2VCIC9JbWFnZUMgL0ltYWdlSSBdCj4+IC9Sb3RhdGUgMCAvVHJhbnMgPDwKCj4+IAogIC9UeXBlIC9QYWdlCj4+CmVuZG9iago0IDAgb2JqCjw8Ci9QYWdlTW9kZSAvVXNlTm9uZSAvUGFnZXMgNiAwIFIgL1R5cGUgL0NhdGFsb2cKPj4KZW5kb2JqCjUgMCBvYmoKPDwKL0F1dGhvciAoYW5vbnltb3VzKSAvQ3JlYXRpb25EYXRlIChEOjIwMjYxMTAxMTYyODE2KzAwJzAwJykgL0NyZWF0b3IgKGFub255bW91cykgL0tleXdvcmRzICgpIC9Nb2REYXRlIChEOjIwMjYxMTAxMTYyODE2KzAwJzAwJykgL1Byb2R1Y2VyIChSZXBvcnRMYWIgUERGIExpYnJhcnkgLSBcKG9wZW5zb3VyY2VcKSkgCiAgL1N1YmplY3QgKHVuc3BlY2lmaWVkKSAvVGl0bGUgKHVudGl0bGVkKSAvVHJhcHBlZCAvRmFsc2UKPj4KZW5kb2JqCjYgMCBvYmoKPDwKL0NvdW50IDEgL0tpZHMgWyAzIDAgUiBdIC9UeXBlIC9QYWdlcwo+PgplbmRvYmoKNyAwIG9iago8PAovRmlsdGVyIFsgL0FTQ0lJODVEZWNvZGUgL0ZsYXRlRGVjb2RlIF0gL0xlbmd0aCAxMTIKPj4Kc3RyZWFtCkdhcFFoMEU9RiwwVVxIM1RccE5ZVF5RS2s/dGM+SVAsO1cjVTFeMjNpaFBFTV8/Q1c0S0lTaTwhWzdgI09CX3NLISNJU0plO0JFYGA4bSoqciZmXShyMWBPZTluZVpbS2IsaHQtM1oiJWZwcm4rfj5lbmRzdHJlYW0KZW5kb2JqCnhyZWYKMCA4CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDA2MSAwMDAwMCBuIAowMDAwMDAwMDkyIDAwMDAwIG4gCjAwMDAwMDAxOTkgMDAwMDAgbiAKMDAwMDAwMDM5MiAwMDAwMCBuIAowMDAwMDAwNDYwIDAwMDAwIG4gCjAwMDAwMDA3MjEgMDAwMDAgbiAKMDAwMDAwMDc4MCAwMDAwMCBuIAp0cmFpbGVyCjw8Ci9JRCAKWzxiNzcyYTNjYzE5NDg0OGQ0ZDAzM2UyMDEwMzE1ZmRkNT48Yjc3MmEzY2MxOTQ4NDhkNGQwMzNlMjAxMDMxNWZkZDU+XQolIFJlcG9ydExhYiBnZW5lcmF0ZWQgUERGIGRvY3VtZW50IC0tIGRpZ2VzdCAob3BlbnNvdXJjZSkKCi9JbmZvIDUgMCBSCi9Sb290IDQgMCBSCi9TaXplIDgKPj4Kc3RhcnR4cmVmCjk4MgolJUVPRgo=';
  const pdfText = await RealDocumentFetcher.extractPdfText(Buffer.from(pdfFixtureBase64, 'base64'));
  if (!pdfText.includes('PDF extraction works')) {
    return { passed: false, message: 'The installed pdf-parse v2 API must extract text from a real PDF fixture' };
  }
  console.log('✔ PDF extraction succeeds through the installed pdf-parse API.');

  // ===== 11. Claim verification regression tests =====
  const recentDate = new Date().toISOString();
  const sourceA = makeSource('src-corroboration-a', { domain: 'research-a.example', published_at: recentDate });
  const sourceB = makeSource('src-corroboration-b', { domain: 'research-b.example', published_at: recentDate });
  const evidenceA = makeEvidence('ev-corroboration-a', sourceA.id);
  const evidenceB = makeEvidence('ev-corroboration-b', sourceB.id);
  evidenceA.provenance.document_hash = 'a'.repeat(64);
  evidenceB.provenance.document_hash = 'b'.repeat(64);
  const corroboratedClaim = makeClaim('clm-corroborated', 1, [evidenceA.id, evidenceB.id]);
  corroboratedClaim.statement = 'The market size is $100 million.';
  const corroborationResult = RealClaimVerifier.verifyAll(
    [corroboratedClaim], [sourceA, sourceB], [evidenceA, evidenceB],
  );
  if (corroborationResult.verifiedClaims[0]?.verification_status !== 'SUPPORTED') {
    return { passed: false, message: 'A recent, reliable claim supported by two independent domains must pass corroboration' };
  }

  const unsupportedClaim = makeClaim('clm-unsupported', 2, ['missing-evidence']);
  const unsupportedResult = RealClaimVerifier.verifyAll([unsupportedClaim], [sourceA], [evidenceA]);
  if (unsupportedResult.verifiedClaims[0]?.verification_status !== 'INSUFFICIENT') {
    return { passed: false, message: 'Claims with no resolvable supporting evidence must remain INSUFFICIENT' };
  }

  const conflictingClaimA = makeClaim('clm-conflict-a', 3, [evidenceA.id]);
  const conflictingClaimB = makeClaim('clm-conflict-b', 4, [evidenceB.id]);
  conflictingClaimA.statement = 'The market size is $100 million.';
  conflictingClaimB.statement = 'The market size is $500 million.';
  const conflictResult = ContradictionEngine.analyzeContradictions(
    [conflictingClaimA, conflictingClaimB], [evidenceA, evidenceB],
  );
  if (!conflictResult.contradictionsFound.some(conflict => conflict.claimId1 === conflictingClaimA.id && conflict.claimId2 === conflictingClaimB.id)) {
    return { passed: false, message: 'Contradiction analysis must identify materially divergent values for the same claim proposition' };
  }
  console.log('✔ Claim verifier enforces independent corroboration and unsupported-claim rejection; contradiction detection is exercised.');
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