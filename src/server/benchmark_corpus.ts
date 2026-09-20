/**
 * Deterministic benchmark corpus (spec item 19)
 * ---------------------------------------------------------------------------
 * "Tests pass" is not a quality claim. This module defines a FROZEN corpus and
 * the measurable metrics a run against it must produce: citation precision and
 * recall, claim extraction precision and recall, quote accuracy, contradiction
 * precision and recall, numeric accuracy, grounding rate, and hallucination
 * rate.
 *
 * Design constraints (deliberate):
 *
 *   1. Frozen. The corpus is a pure function of its declared parameters. No
 *      network, no clock, no randomness, no model. Two runs on two machines
 *      produce byte-identical documents, facts, and metrics.
 *   2. Verbatim or it does not exist. Every fact carries the exact character
 *      slice it came from, and the corpus is validated to contain that slice. A
 *      fact whose quote is not a real substring of its document is a corpus bug,
 *      not a passing test.
 *   3. Failures are declared, not accidental. Known-bad inputs (mutated quotes,
 *      drifted values, invented and dropped claims) are enumerated explicitly,
 *      so each metric can be shown to DETECT the defect instead of merely
 *      scoring well on easy data.
 *   4. Contradictions are separated from extraction. Divergent-value fixtures
 *      live apart from the extraction corpus so each metric has one meaning.
 *
 * Domain names use the reserved `.example` TLD: this corpus must never cause a
 * real outbound request, even if a test is misconfigured.
 */

import { createHash } from 'crypto';
import type { Claim, ClaimType, Evidence, Source, VerificationStatus } from '../types.js';

export const BENCHMARK_CORPUS_VERSION = '1.0.0';

/** A fact the corpus asserts is present in a document, with its exact slice. */
export interface FrozenFact {
  /** Stable proposition key: `<industry>|<region>|<year>|<METRIC>`. */
  key: string;
  /** Verbatim character slice of the owning document's text. */
  quote: string;
  /** Canonical numeric value in base units (e.g. USD, not USD-billions). */
  value: number;
  /** Canonical unit as the numeric normalizer reports it: USD, %, COUNT. */
  unit: string;
  entity: string;
  metric: string;
  geography: string;
  period: string;
  claim_type: ClaimType;
}

export interface FrozenDocument {
  id: string;
  source_id: string;
  url: string;
  domain: string;
  /** null when the publisher states no date — never a fabricated timestamp. */
  published_at: string | null;
  text: string;
  /** SHA-256 of `text`, so provenance is content-addressed. */
  content_hash: string;
  facts: FrozenFact[];
}

/**
 * Corpus axes. Sizes were chosen to land inside the spec's 50-100 document
 * target while keeping every cell independently checkable:
 *   4 industries x 4 regions x 3 years x 2 publishers = 96 documents.
 */
export const BENCHMARK_INDUSTRIES = [
  'Solid State Battery',
  'Edge AI Chips',
  'Industrial Robotics',
  'Grid Storage',
] as const;

export const BENCHMARK_REGIONS = ['Global', 'India', 'Germany', 'Japan'] as const;

export const BENCHMARK_YEARS = [2023, 2024, 2025] as const;

export const BENCHMARK_PUBLISHERS = [
  { name: 'Meridian Research', domain: 'meridian-research.example' },
  { name: 'Arclight Analytics', domain: 'arclight-analytics.example' },
] as const;

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** SHA-256 of a document body. Content addressing, not a fabricated marker. */
export function contentHash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Stable pseudo-random value in [0, 1) derived from a seed. Deterministic
 * across processes and machines, unlike Math.random().
 */
export function deterministicUnit(seed: string): number {
  const digest = createHash('sha256').update(seed, 'utf8').digest();
  return digest.readUInt32BE(0) / 0x100000000;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}


/** Market size in USD billions for a cell. Deterministic and bounded 2..42. */
function sizeBillions(industry: string, region: string, year: number, publisherIndex: number): number {
  const base = 2 + deterministicUnit(`${industry}|${region}|${year}|size`) * 40;
  // Publisher 1 reports a slightly different reading of the SAME proposition
  // (a normal analyst divergence, far under the 3x contradiction threshold).
  return publisherIndex === 0 ? round1(base) : round1(base * 1.08);
}

/** Year-over-year growth in percent for a cell. Identical across publishers. */
function growthPercent(industry: string, region: string, year: number): number {
  return round1(5 + deterministicUnit(`${industry}|${region}|${year}|growth`) * 30);
}

function buildDocument(
  industry: string,
  region: string,
  year: number,
  publisherIndex: number,
): FrozenDocument {
  const publisher = BENCHMARK_PUBLISHERS[publisherIndex];
  const size = sizeBillions(industry, region, year, publisherIndex);
  const growth = growthPercent(industry, region, year);

  // The quotes are whole sentences, so they are rich inputs for deterministic
  // relevance scoring (term overlap) while still being exact substrings.
  const sizeQuote = `The ${industry} market in ${region} reached $${size.toFixed(1)}B in ${year}, according to ${publisher.name}.`;
  const growthQuote = `The ${industry} market in ${region} grew ${growth.toFixed(1)}% year over year in ${year}, according to ${publisher.name}.`;
  const text = `${sizeQuote} ${growthQuote}`;

  const facts: FrozenFact[] = [
    {
      key: `${industry}|${region}|${year}|MARKET_SIZE`,
      quote: sizeQuote,
      value: size * 1e9,
      unit: 'USD',
      entity: industry,
      metric: 'MARKET_SIZE',
      geography: region,
      period: String(year),
      claim_type: 'MARKET_SIZE',
    },
    {
      key: `${industry}|${region}|${year}|MARKET_GROWTH`,
      quote: growthQuote,
      value: growth,
      unit: '%',
      entity: industry,
      metric: 'MARKET_GROWTH',
      geography: region,
      period: String(year),
      claim_type: 'MARKET_GROWTH',
    },
  ];

  return {
    id: `doc_${slug(industry)}_${slug(region)}_${year}_p${publisherIndex}`,
    source_id: `src_${slug(industry)}_${slug(region)}_${year}_p${publisherIndex}`,
    url: `https://${publisher.domain}/${slug(industry)}/${slug(region)}/${year}`,
    domain: publisher.domain,
    published_at: `${year}-06-15T00:00:00.000Z`,
    text,
    content_hash: contentHash(text),
    facts,
  };
}

/** The frozen corpus: 96 documents, 192 facts. */
export const BENCHMARK_DOCUMENTS: FrozenDocument[] = (() => {
  const documents: FrozenDocument[] = [];
  for (const industry of BENCHMARK_INDUSTRIES) {
    for (const region of BENCHMARK_REGIONS) {
      for (const year of BENCHMARK_YEARS) {
        for (let publisherIndex = 0; publisherIndex < BENCHMARK_PUBLISHERS.length; publisherIndex++) {
          documents.push(buildDocument(industry, region, year, publisherIndex));
        }
      }
    }
  }
  return documents;
})();

/** Every fact in the corpus, flattened. */
export const BENCHMARK_FACTS: FrozenFact[] = BENCHMARK_DOCUMENTS.flatMap((doc) => doc.facts);

/**
 * Unique propositions. Two publishers describing one proposition yield ONE
 * expected claim — the reference (publisher 0) reading — because claim
 * extraction resolves multiple sources to a single claim.
 */
export const BENCHMARK_EXPECTED_CLAIMS: FrozenFact[] = (() => {
  const byKey = new Map<string, FrozenFact>();
  for (const fact of BENCHMARK_FACTS) {
    if (!byKey.has(fact.key)) byKey.set(fact.key, fact);
  }
  return Array.from(byKey.values());
})();



/* -------------------------------------------------------------------------- */
/* Declared defects and metric floors                                          */
/* -------------------------------------------------------------------------- */

export type PerturbationKind = 'MUTATED_QUOTE' | 'DRIFTED_VALUE' | 'DROPPED_CLAIM' | 'INVENTED_CLAIM';

export interface Perturbation {
  /** Corpus fact key this defect applies to. */
  fact_key: string;
  kind: PerturbationKind;
  /** Human-readable reason, so a regression is diagnosable from the diff. */
  detail: string;
}

/** A clean run: every expected claim is extracted correctly. */
export const BENCHMARK_CLEAN_RUN: Perturbation[] = [];

/**
 * A declared-defect run. Each entry targets one metric so a failure names the
 * exact metric that stopped detecting the defect.
 */
export const BENCHMARK_DEFECT_INJECTION: Perturbation[] = [
  {
    fact_key: 'Solid State Battery|Global|2023|MARKET_SIZE',
    kind: 'MUTATED_QUOTE',
    detail: 'quote re-typed with different casing/whitespace: must fail verbatim quote accuracy',
  },
  {
    fact_key: 'Edge AI Chips|India|2024|MARKET_SIZE',
    kind: 'MUTATED_QUOTE',
    detail: 'quote truncated mid-sentence: must fail verbatim quote accuracy',
  },
  {
    fact_key: 'Industrial Robotics|Japan|2025|MARKET_GROWTH',
    kind: 'DRIFTED_VALUE',
    detail: 'value shifted 25%: must exceed the 0.5% tolerance and fail numeric accuracy',
  },
  {
    fact_key: 'Grid Storage|Germany|2023|MARKET_SIZE',
    kind: 'DROPPED_CLAIM',
    detail: 'expected claim not extracted: must reduce claim recall',
  },
  {
    fact_key: 'Grid Storage|Japan|2024|MARKET_GROWTH',
    kind: 'DROPPED_CLAIM',
    detail: 'expected claim not extracted: must reduce claim recall',
  },
];

/**
 * Claims the corpus does NOT contain. A run that reports these is fabricating.
 */
export const BENCHMARK_INVENTED_CLAIMS: Array<{
  key: string;
  statement: string;
  value: number;
  unit: string;
}> = [
  {
    key: 'Unobtainium Mining|Global|2031|MARKET_SIZE',
    statement: 'The Unobtainium Mining market in Global reached $999.9B in 2031, according to an unnamed report.',
    value: 999.9e9,
    unit: 'USD',
  },
];

/** Metric floors a run must clear. These are minimums, not targets. */
export interface BenchmarkThresholds {
  min_documents: number;
  clean_claim_recall: number;
  clean_claim_precision: number;
  clean_quote_accuracy: number;
  clean_numeric_accuracy: number;
  clean_grounding_rate: number;
  clean_hallucination_rate: number;
  defect_quote_accuracy_max: number;
  defect_claim_recall_max: number;
  defect_numeric_accuracy_max: number;
  contradiction_precision: number;
  contradiction_recall: number;
}

export const BENCHMARK_THRESHOLDS: BenchmarkThresholds = {
  min_documents: 50,
  // A correct run must be perfect on all of these; anything less is a defect.
  clean_claim_recall: 1,
  clean_claim_precision: 1,
  clean_quote_accuracy: 1,
  clean_numeric_accuracy: 1,
  clean_grounding_rate: 1,
  clean_hallucination_rate: 0,
  // A run with declared defects must FAIL these — proof the metric has teeth.
  defect_quote_accuracy_max: 0.99,
  defect_claim_recall_max: 0.99,
  defect_numeric_accuracy_max: 0.99,
  // Same-proposition comparison only: exact on the declared fixture set.
  contradiction_precision: 1,
  contradiction_recall: 1,
};


/* -------------------------------------------------------------------------- */
/* Fixture builders                                                            */
/* -------------------------------------------------------------------------- */

export const BENCHMARK_JOB_ID = 'job_benchmark_corpus';

/** Builds a fully-typed Source. Fields with no real value stay null. */
export function mkSource(overrides: Partial<Source> & { id: string; domain: string }): Source {
  return {
    job_id: BENCHMARK_JOB_ID,
    url: `https://${overrides.domain}/report`,
    canonical_url: `https://${overrides.domain}/report`,
    title: 'Benchmark source',
    publisher: null,
    published_at: '2025-01-15T00:00:00.000Z',
    retrieved_at: '2026-01-15T00:00:00.000Z',
    source_type: 'TIER_B',
    language: 'en',
    http_status: 200,
    discovery_method: 'SEARCH_API',
    content_hash: contentHash(`${overrides.id}-body`),
    fetch_status: 'FETCHED',
    fetch_error: null,
    reliability_score: 90,
    ...overrides,
  };
}

/** Builds a fully-typed Evidence item with a verbatim, content-addressed slice. */
export function mkEvidence(
  claimId: string,
  source: Source,
  overrides: Partial<Evidence> = {},
): Evidence {
  const documentText = `The benchmark market in Global reached $4.2B in 2024, according to ${source.domain}.`;
  const startOffset = 0;
  const endOffset = documentText.length;
  const quote = documentText.slice(startOffset, endOffset);
  return {
    id: `ev_${claimId}_${source.id}`,
    job_id: BENCHMARK_JOB_ID,
    document_id: `doc_${source.id}`,
    source_id: source.id,
    evidence_type: 'PRIMARY_SOURCE',
    text: documentText,
    quote,
    start_offset: startOffset,
    end_offset: endOffset,
    section: 'Market Overview',
    extraction_confidence: 95,
    provenance_type: 'OBSERVED',
    created_at: '2026-01-15T00:00:00.000Z',
    source_url: source.url,
    source_domain: source.domain,
    citation_number: 1,
    statement: quote,
    extracted_quote: quote,
    relevance_score: 80,
    verification_status: 'UNVERIFIED',
    confidence: 95,
    provenance: {
      document_text: documentText,
      document_hash: contentHash(documentText),
      source_url: source.url,
      retrieved_at: '2026-01-15T00:00:00.000Z',
      parser_version: 'benchmark-parser-1',
      normalizer_version: 'benchmark-normalizer-1',
      start_offset: startOffset,
      end_offset: endOffset,
      quote,
      exact_normalized_match: true,
    },
    retrieved_at: '2026-01-15T00:00:00.000Z',
    parser_version: 'benchmark-parser-1',
    normalizer_version: 'benchmark-normalizer-1',
    supporting_claim_ids: [claimId],
    contradicting_claim_ids: [],
    ...overrides,
  };
}

/** Builds a fully-typed Claim. */
export function mkClaim(overrides: Partial<Claim> & { id: string; statement: string }): Claim {
  return {
    job_id: BENCHMARK_JOB_ID,
    claim_type: 'MARKET_SIZE',
    verification_status: 'UNVERIFIED',
    confidence: 90,
    reasoning: 'benchmark fixture',
    provenance_type: 'OBSERVED',
    created_at: '2026-01-15T00:00:00.000Z',
    supporting_evidence_ids: [],
    contradicting_evidence_ids: [],
    ...overrides,
  };
}


/* -------------------------------------------------------------------------- */
/* Contradiction fixtures: comparability is DECLARED, so precision and recall   */
/* are exact numbers rather than opinions.                                     */
/* -------------------------------------------------------------------------- */

const PROPOSITION_DEFAULTS = {
  entity: 'Solid State Battery',
  metric: 'MARKET_SIZE',
  geography: 'Global',
  time_period: '2024',
  provenance_type: 'OBSERVED' as const,
};

function propositionClaim(id: string, statement: string, overrides: Partial<Claim> = {}): Claim {
  return mkClaim({
    id,
    statement,
    claim_type: 'MARKET_SIZE',
    ...PROPOSITION_DEFAULTS,
    ...overrides,
  });
}

export interface PropositionFixture {
  id: string;
  claim: Claim;
  /** Id of the claim this one TRULY contradicts, or null. */
  contradicts: string | null;
  rationale: string;
}

/**
 * Every pair below is constructed so that exactly ONE dimension varies (plus the
 * numeric value, which diverges by ~4.4x in every pair). Pairs that vary
 * anything other than the value are different propositions and must NOT be
 * reported as contradictions.
 */
export const BENCHMARK_PROPOSITION_FIXTURES: PropositionFixture[] = [
  // ---- TRUE contradiction (entity: Solid State Battery) ----
  {
    id: 'true-tam-2024-a',
    claim: propositionClaim('true-tam-2024-a', 'The solid state battery market in Global reached $4.2B in 2024.'),
    contradicts: 'true-tam-2024-b',
    rationale: 'same proposition (type/entity/metric/geography/period/unit/method), value diverges 4.4x -> REAL contradiction',
  },
  {
    id: 'true-tam-2024-b',
    claim: propositionClaim('true-tam-2024-b', 'The solid state battery market in Global reached $18.5B in 2024.'),
    contradicts: 'true-tam-2024-a',
    rationale: 'mirror of the real contradiction pair',
  },

  // ---- DECOY: geography differs (entity: Edge AI Chips) ----
  {
    id: 'decoy-geography-global',
    claim: propositionClaim('decoy-geography-global', 'The edge AI chips market in Global reached $4.2B in 2024.', { entity: 'Edge AI Chips' }),
    contradicts: null,
    rationale: 'different geography (Global vs India): legitimate difference, NOT a contradiction',
  },
  {
    id: 'decoy-geography-india',
    claim: propositionClaim('decoy-geography-india', 'The edge AI chips market in India reached $18.5B in 2024.', { entity: 'Edge AI Chips', geography: 'India' }),
    contradicts: null,
    rationale: 'different geography: NOT a contradiction',
  },

  // ---- DECOY: period differs (entity: Industrial Robotics) ----
  {
    id: 'decoy-period-2024',
    claim: propositionClaim('decoy-period-2024', 'The industrial robotics market in Global reached $4.2B in 2024.', { entity: 'Industrial Robotics' }),
    contradicts: null,
    rationale: 'different period (2024 vs 2025): legitimate growth, NOT a contradiction',
  },
  {
    id: 'decoy-period-2025',
    claim: propositionClaim('decoy-period-2025', 'The industrial robotics market in Global reached $18.5B in 2025.', { entity: 'Industrial Robotics', time_period: '2025' }),
    contradicts: null,
    rationale: 'different period: NOT a contradiction',
  },

  // ---- DECOY: metric differs (entity: Grid Storage) ----
  {
    id: 'decoy-metric-tam',
    claim: propositionClaim('decoy-metric-tam', 'The grid storage market in Global reached $4.2B in 2024.', { entity: 'Grid Storage', metric: 'TAM' }),
    contradicts: null,
    rationale: 'TAM vs SAM are different measures: NOT a contradiction',
  },
  {
    id: 'decoy-metric-sam',
    claim: propositionClaim('decoy-metric-sam', 'The grid storage market in Global reached $18.5B in 2024.', { entity: 'Grid Storage', metric: 'SAM' }),
    contradicts: null,
    rationale: 'SAM vs TAM: NOT a contradiction',
  },

  // ---- DECOY: unit differs (entity: Perovskite Solar) ----
  {
    id: 'decoy-unit-usd',
    claim: propositionClaim('decoy-unit-usd', 'The perovskite solar market in Global reached $4.2B in 2024.', { entity: 'Perovskite Solar' }),
    contradicts: null,
    rationale: 'currency amount vs percentage: different units, NOT comparable',
  },
  {
    id: 'decoy-unit-percent',
    claim: propositionClaim('decoy-unit-percent', 'The perovskite solar market in Global reached 18.5% in 2024.', { entity: 'Perovskite Solar' }),
    contradicts: null,
    rationale: 'percentage vs currency: NOT comparable',
  },

  // ---- DECOY: provenance class differs (entity: Quantum Sensing) ----
  {
    id: 'decoy-provenance-observed',
    claim: propositionClaim('decoy-provenance-observed', 'The quantum sensing market in Global reached $4.2B in 2024.', { entity: 'Quantum Sensing' }),
    contradicts: null,
    rationale: 'observed vs assumed are different methodology classes: NOT comparable',
  },
  {
    id: 'decoy-provenance-assumed',
    claim: propositionClaim('decoy-provenance-assumed', 'The quantum sensing market in Global reached $18.5B in 2024.', { entity: 'Quantum Sensing', provenance_type: 'ASSUMED' }),
    contradicts: null,
    rationale: 'assumed vs observed: NOT comparable',
  },
];

/** Pairs the engine MUST report. */
export const BENCHMARK_EXPECTED_CONTRADICTIONS: Array<{ a: string; b: string }> =
  BENCHMARK_PROPOSITION_FIXTURES
    .filter((fixture) => fixture.contradicts !== null)
    .map((fixture) => ({ a: fixture.id, b: fixture.contradicts as string }));

/** Pairs the engine must NEVER report. */
export const BENCHMARK_DECOY_PAIRS: Array<{ a: string; b: string }> = (() => {
  const decoys = BENCHMARK_PROPOSITION_FIXTURES.filter((f) => f.contradicts === null).map((f) => f.id);
  const pairs: Array<{ a: string; b: string }> = [];
  for (let i = 0; i < decoys.length; i++) {
    for (let j = i + 1; j < decoys.length; j++) {
      pairs.push({ a: decoys[i], b: decoys[j] });
    }
  }
  return pairs;
})();


/* -------------------------------------------------------------------------- */
/* Verification-ladder fixtures (spec item 6)                                  */
/* -------------------------------------------------------------------------- */

export interface VerificationFixture {
  id: string;
  claim: Claim;
  sources: Source[];
  evidence: Evidence[];
  expect_status: VerificationStatus;
  rationale: string;
}

function verificationFixture(
  id: string,
  expect: VerificationStatus,
  rationale: string,
  spec: {
    claimOverrides?: Partial<Claim>;
    sources: Array<Partial<Source> & { id: string; domain: string }>;
    evidenceOverrides?: Partial<Evidence>;
    withEvidence?: boolean;
  },
): VerificationFixture {
  const sources = spec.sources.map((sourceSpec) => mkSource(sourceSpec));
  const claim = mkClaim({
    id,
    statement: 'The solid state battery market in Global reached $4.2B in 2024.',
    claim_type: 'MARKET_SIZE',
    ...PROPOSITION_DEFAULTS,
    ...(spec.claimOverrides || {}),
  });
  const evidence = spec.withEvidence === false
    ? []
    : sources.map((source) => mkEvidence(id, source, spec.evidenceOverrides || {}));
  claim.supporting_evidence_ids = evidence.map((item) => item.id);
  return { id, claim, sources, evidence, expect_status: expect, rationale };
}

/**
 * One fixture per rung of the ladder. Together they prove CONTRADICTION-CHECKED
 * — and therefore SUPPORTED — is only reachable by clearing every gate, rather
 * than being the default state.
 */
export const BENCHMARK_VERIFICATION_FIXTURES: VerificationFixture[] = [
  verificationFixture('v-insufficient', 'INSUFFICIENT', 'nothing supports the claim', {
    sources: [{ id: 'src-none', domain: 'none.example' }],
    withEvidence: false,
  }),
  verificationFixture('v-extracted', 'EXTRACTED', 'evidence lacks a verbatim quote, so it never reaches EVIDENCE-MATCHED', {
    sources: [
      { id: 'src-a1', domain: 'alpha.example' },
      { id: 'src-a2', domain: 'beta.example' },
    ],
    evidenceOverrides: { quote: '' },
  }),
  verificationFixture('v-evidence-matched', 'EVIDENCE-MATCHED', 'sources have known but inadequate reliability', {
    sources: [
      { id: 'src-b1', domain: 'alpha.example', reliability_score: 50 },
      { id: 'src-b2', domain: 'beta.example', reliability_score: 45 },
    ],
  }),
  verificationFixture('v-source-assessed', 'SOURCE-ASSESSED', 'a supporting source has an UNKNOWN publication date: no temporal credit', {
    sources: [
      { id: 'src-c1', domain: 'alpha.example', published_at: '2025-01-15T00:00:00.000Z' },
      { id: 'src-c2', domain: 'beta.example', published_at: null },
    ],
  }),
  verificationFixture('v-source-assessed-stale', 'SOURCE-ASSESSED', 'supporting source is outside the recency window', {
    sources: [
      { id: 'src-c3', domain: 'alpha.example', published_at: '2001-01-15T00:00:00.000Z' },
      { id: 'src-c4', domain: 'beta.example', published_at: '2025-01-15T00:00:00.000Z' },
    ],
  }),
  verificationFixture('v-contradiction-checked', 'CONTRADICTION-CHECKED', 'every gate passes except independent corroboration (single domain)', {
    sources: [{ id: 'src-d1', domain: 'alpha.example' }],
  }),
  verificationFixture('v-corroborated', 'CORROBORATED', 'all gates pass but extraction confidence is below the support bar', {
    sources: [
      { id: 'src-e1', domain: 'alpha.example' },
      { id: 'src-e2', domain: 'beta.example' },
    ],
    claimOverrides: { confidence: 60 },
  }),
  verificationFixture('v-supported', 'SUPPORTED', 'every gate cleared: real quote, reliable sources, known recent dates, two domains, high confidence', {
    sources: [
      { id: 'src-f1', domain: 'alpha.example', reliability_score: 92, published_at: '2024-06-15T00:00:00.000Z' },
      { id: 'src-f2', domain: 'beta.example', reliability_score: 88, published_at: '2025-06-15T00:00:00.000Z' },
    ],
  }),
  verificationFixture('v-contradicted', 'CONTRADICTED', 'conflicting evidence exists for the claim', {
    sources: [
      { id: 'src-g1', domain: 'alpha.example' },
      { id: 'src-g2', domain: 'beta.example' },
    ],
    claimOverrides: { contradicting_evidence_ids: ['ev_conflict_1'] },
  }),
];

/**
 * Regression guard for the count-derived relevance bug: a large pool of ENTIRELY
 * IRRELEVANT evidence must not produce a high relevance score. The previous
 * implementation returned 20/20 for any pool of >= 10 documents.
 */
export const BENCHMARK_IRRELEVANT_EVIDENCE_COUNT = 12;

export function buildIrrelevantEvidenceFixture(): VerificationFixture {
  const sources = Array.from({ length: BENCHMARK_IRRELEVANT_EVIDENCE_COUNT }, (_, index) =>
    mkSource({ id: `src-irrelevant-${index}`, domain: `irrelevant-${index}.example` }));
  const claim = mkClaim({
    id: 'irrelevant-pool-claim',
    statement: 'The solid state battery market in Global reached $4.2B in 2024.',
    claim_type: 'MARKET_SIZE',
    ...PROPOSITION_DEFAULTS,
  });
  const evidence = sources.map((source, index) => mkEvidence(claim.id, source, {
    id: `ev_irrelevant_${index}`,
    quote: 'Banana export volumes in Peru rose steadily across the harvest season.',
    statement: 'Banana export volumes in Peru rose steadily across the harvest season.',
    text: 'Banana export volumes in Peru rose steadily across the harvest season.',
    section: 'Agriculture',
  }));
  claim.supporting_evidence_ids = evidence.map((item) => item.id);
  return {
    id: 'irrelevant-pool',
    claim,
    sources,
    evidence,
    // The ladder is structural (offsets, source quality, dates, corroboration),
    // so twelve irrelevant-but-well-formed sources DO reach SUPPORTED. That is
    // intended and is exactly why relevance is scored separately: the test
    // asserts the relevance number stays near zero while the status does not.
    expect_status: 'SUPPORTED',
    rationale: 'irrelevant evidence must not inflate the relevance dimension',
  };
}

