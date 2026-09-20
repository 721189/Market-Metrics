/**
 * Phase 4 - Deterministic Benchmark Corpus Test (spec item 19)
 * ---------------------------------------------------------------------------
 * Runs the frozen corpus and asserts the MEASURABLE metrics, not just "no
 * exception was thrown":
 *
 *   claim extraction precision / recall      (clean and defect runs)
 *   citation precision / recall
 *   quote accuracy                           (verbatim slice at exact offsets)
 *   numeric accuracy                         (relative tolerance)
 *   contradiction precision / recall         (same-proposition comparison only)
 *   grounding rate / hallucination rate
 *   verification ladder                      (SUPPORTED must be earned)
 *
 * Every threshold is asserted in both directions: a CLEAN run must score
 * perfectly, and a run with DECLARED DEFECTS must fail — that second half is
 * what proves each metric actually detects the defect it claims to measure.
 */

import {
  BENCHMARK_DOCUMENTS,
  BENCHMARK_FACTS,
  BENCHMARK_EXPECTED_CLAIMS,
  BENCHMARK_CORPUS_VERSION,
  BENCHMARK_THRESHOLDS,
  BENCHMARK_CLEAN_RUN,
  BENCHMARK_DEFECT_INJECTION,
  BENCHMARK_INVENTED_CLAIMS,
  BENCHMARK_PROPOSITION_FIXTURES,
  BENCHMARK_EXPECTED_CONTRADICTIONS,
  BENCHMARK_DECOY_PAIRS,
  BENCHMARK_VERIFICATION_FIXTURES,
  buildIrrelevantEvidenceFixture,
  contentHash,
  type Perturbation,
} from '../server/benchmark_corpus.js';
import {
  evaluateRun,
  verifyVerbatimQuote,
  type ExtractedClaim,
  type RunMetrics,
} from '../server/evaluation.js';
import { ContradictionEngine, NumericNormalizer, RealClaimVerifier } from '../server/claim_engine.js';

export interface SimulatedRun {
  extracted_claims: ExtractedClaim[];
  report_claim_keys: string[];
  notes: string[];
}

/**
 * Deterministic stand-in for the extraction stage.
 *
 * It reproduces the corpus with the DECLARED perturbations applied, so the
 * metrics measure known ground truth instead of a model's mood. Nothing here is
 * random: the same inputs always produce the same claims.
 */
export function simulateRun(
  perturbations: Perturbation[],
  options: { inventClaim?: boolean; phantomReportKey?: string } = {},
): SimulatedRun {
  const dropped = new Set(perturbations.filter((p) => p.kind === 'DROPPED_CLAIM').map((p) => p.fact_key));
  const mutated = new Set(perturbations.filter((p) => p.kind === 'MUTATED_QUOTE').map((p) => p.fact_key));
  const drifted = new Set(perturbations.filter((p) => p.kind === 'DRIFTED_VALUE').map((p) => p.fact_key));
  const notes: string[] = [];

  const extracted: ExtractedClaim[] = [];
  for (const fact of BENCHMARK_EXPECTED_CLAIMS) {
    if (dropped.has(fact.key)) {
      notes.push(`dropped claim: ${fact.key}`);
      continue;
    }
    const document = BENCHMARK_DOCUMENTS.find((doc) => doc.facts.some((f) => f.key === fact.key));
    if (!document) continue;

    const startOffset = document.text.indexOf(fact.quote);
    const endOffset = startOffset + fact.quote.length;
    let quote = document.text.slice(startOffset, endOffset);
    let value: number | null = fact.value;

    if (mutated.has(fact.key)) {
      // The classic model failure: the span is re-typed rather than sliced, so
      // the stored quote no longer equals the document at those coordinates.
      quote = `  ${quote.toUpperCase()}  `;
      notes.push(`mutated quote: ${fact.key}`);
    }
    if (drifted.has(fact.key)) {
      value = fact.value * 1.25;
      notes.push(`drifted value: ${fact.key}`);
    }

    extracted.push({
      key: fact.key,
      value,
      unit: fact.unit,
      metric: fact.metric,
      entity: fact.entity,
      geography: fact.geography,
      period: fact.period,
      quote: { document_text: document.text, start_offset: startOffset, end_offset: endOffset, quote },
      citation_number: extracted.length + 1,
      evidence_backed: true,
    });
  }

  if (options.inventClaim) {
    for (const invented of BENCHMARK_INVENTED_CLAIMS) {
      extracted.push({
        key: invented.key,
        value: invented.value,
        unit: invented.unit,
        metric: 'MARKET_SIZE',
        entity: 'Unobtainium Mining',
        geography: 'Global',
        period: '2031',
        quote: { document_text: '', start_offset: -1, end_offset: -1, quote: invented.statement },
        citation_number: extracted.length + 1,
        evidence_backed: false,
      });
      notes.push(`invented claim: ${invented.key}`);
    }
  }

  const reportClaimKeys = extracted.filter((claim) => claim.evidence_backed).map((claim) => claim.key);
  if (options.phantomReportKey) {
    reportClaimKeys.push(options.phantomReportKey);
    notes.push(`report cites a claim that was never extracted: ${options.phantomReportKey}`);
  }

  return { extracted_claims: extracted, report_claim_keys: reportClaimKeys, notes };
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function reportMetrics(label: string, metrics: RunMetrics): void {
  console.log(`   [${label}] claim P/R/F1 ${pct(metrics.claim_precision)}/${pct(metrics.claim_recall)}/${pct(metrics.claim_f1)}`);
  console.log(`   [${label}] citation P/R ${pct(metrics.citation_precision)}/${pct(metrics.citation_recall)} | quote ${pct(metrics.quote_accuracy)} | numeric ${pct(metrics.numeric_accuracy)}`);
  console.log(`   [${label}] contradiction P/R ${pct(metrics.contradiction_precision)}/${pct(metrics.contradiction_recall)} | grounding ${pct(metrics.grounding_rate)} | hallucination ${pct(metrics.hallucination_rate)}`);
}


const TOLERANCE = 0.005; // 0.5% relative, matching the evaluation default

function assert(condition: boolean, invariant: string): void {
  if (!condition) throw new Error(`INVARIANT VIOLATED: ${invariant}`);
}

export async function runBenchmarkCorpusTest(): Promise<{ passed: boolean; message: string }> {
  console.log('\n--- Running Test 11: Deterministic Benchmark Corpus ---');
  console.log(`   corpus version ${BENCHMARK_CORPUS_VERSION}`);

  /* ---------------- Phase A: corpus integrity ---------------- */
  assert(
    BENCHMARK_DOCUMENTS.length >= BENCHMARK_THRESHOLDS.min_documents,
    `corpus must contain at least ${BENCHMARK_THRESHOLDS.min_documents} frozen documents, found ${BENCHMARK_DOCUMENTS.length}`,
  );
  console.log(`   corpus: ${BENCHMARK_DOCUMENTS.length} documents, ${BENCHMARK_FACTS.length} facts, ${BENCHMARK_EXPECTED_CLAIMS.length} unique propositions`);

  for (const document of BENCHMARK_DOCUMENTS) {
    assert(document.content_hash === contentHash(document.text), `document ${document.id} content hash is not content-addressed`);
    const seen = new Set<string>();
    for (const fact of document.facts) {
      assert(!seen.has(fact.key), `document ${document.id} declares fact ${fact.key} twice`);
      seen.add(fact.key);

      const offset = document.text.indexOf(fact.quote);
      assert(offset >= 0, `fact ${fact.key} quote is NOT a verbatim slice of ${document.id}`);
      assert(document.text.slice(offset, offset + fact.quote.length) === fact.quote, `fact ${fact.key} slice mismatch at exact offsets`);

      const normalized = NumericNormalizer.normalize(fact.quote);
      assert(!!normalized, `fact ${fact.key} is not numerically parseable: "${fact.quote}"`);
      assert(normalized!.unit === fact.unit, `fact ${fact.key} unit mismatch: corpus=${fact.unit} normalizer=${normalized!.unit}`);
      const relativeError = Math.abs(normalized!.value - fact.value) / fact.value;
      assert(relativeError <= TOLERANCE, `fact ${fact.key} value mismatch: corpus=${fact.value} normalizer=${normalized!.value}`);
    }
  }
  console.log('   corpus integrity: every fact is a verbatim, numerically-parsed slice at exact offsets');

  for (const invented of BENCHMARK_INVENTED_CLAIMS) {
    assert(
      !BENCHMARK_EXPECTED_CLAIMS.some((fact) => fact.key === invented.key),
      `invented claim ${invented.key} must NOT exist anywhere in the corpus`,
    );
  }

  /* ---------------- Contradiction graph (evaluated once, measured in both runs) ---------------- */
  const propositionClaims = BENCHMARK_PROPOSITION_FIXTURES.map((fixture) => fixture.claim);
  const analysis = ContradictionEngine.analyzeContradictions(propositionClaims, []);
  const detectedPairs = new Set(
    analysis.contradictionsFound
      .filter((entry) => !!entry.claimId2)
      .map((entry) => [entry.claimId1, entry.claimId2 as string].sort().join('::')),
  );
  const expectedPairs = new Set(
    BENCHMARK_EXPECTED_CONTRADICTIONS.map((pair) => [pair.a, pair.b].sort().join('::')),
  );
  const detectedContradictionPairs = analysis.contradictionsFound
    .filter((entry) => !!entry.claimId2)
    .map((entry) => ({ a: entry.claimId1, b: entry.claimId2 as string }));

  /* ---------------- Phase B: a clean run must be perfect ---------------- */
  const clean = simulateRun(BENCHMARK_CLEAN_RUN);
  const cleanMetrics = evaluateRun({
    expected_claims: BENCHMARK_EXPECTED_CLAIMS,
    extracted_claims: clean.extracted_claims,
    expected_contradictions: BENCHMARK_EXPECTED_CONTRADICTIONS,
    detected_contradictions: detectedContradictionPairs,
    report_claim_keys: clean.report_claim_keys,
  });
  reportMetrics('clean', cleanMetrics);

  assert(cleanMetrics.claim_recall >= BENCHMARK_THRESHOLDS.clean_claim_recall, `clean claim recall ${cleanMetrics.claim_recall} below floor`);
  assert(cleanMetrics.claim_precision >= BENCHMARK_THRESHOLDS.clean_claim_precision, `clean claim precision ${cleanMetrics.claim_precision} below floor`);
  assert(cleanMetrics.quote_accuracy >= BENCHMARK_THRESHOLDS.clean_quote_accuracy, `clean quote accuracy ${cleanMetrics.quote_accuracy} below floor`);
  assert(cleanMetrics.numeric_accuracy >= BENCHMARK_THRESHOLDS.clean_numeric_accuracy, `clean numeric accuracy ${cleanMetrics.numeric_accuracy} below floor`);
  assert(cleanMetrics.grounding_rate >= BENCHMARK_THRESHOLDS.clean_grounding_rate, `clean grounding rate ${cleanMetrics.grounding_rate} below floor`);
  assert(cleanMetrics.hallucination_rate <= BENCHMARK_THRESHOLDS.clean_hallucination_rate, `clean run fabricated claims: rate ${cleanMetrics.hallucination_rate}`);
  assert(cleanMetrics.citation_precision >= 1, `clean citation precision ${cleanMetrics.citation_precision} below floor`);
  assert(cleanMetrics.citation_recall >= 1, `clean citation recall ${cleanMetrics.citation_recall} below floor`);

  /* ---------------- Phase C: declared defects must be DETECTED ---------------- */
  const defect = simulateRun(BENCHMARK_DEFECT_INJECTION, {
    inventClaim: true,
    phantomReportKey: 'phantom|proposition|never|extracted',
  });
  const defectMetrics = evaluateRun({
    expected_claims: BENCHMARK_EXPECTED_CLAIMS,
    extracted_claims: defect.extracted_claims,
    expected_contradictions: BENCHMARK_EXPECTED_CONTRADICTIONS,
    detected_contradictions: detectedContradictionPairs,
    report_claim_keys: defect.report_claim_keys,
  });
  reportMetrics('defect', defectMetrics);
  for (const note of defect.notes) console.log(`   defect injected: ${note}`);

  assert(
    defectMetrics.quote_accuracy <= BENCHMARK_THRESHOLDS.defect_quote_accuracy_max,
    `quote accuracy failed to detect re-typed quotes (${defectMetrics.quote_accuracy})`,
  );
  assert(
    defectMetrics.claim_recall <= BENCHMARK_THRESHOLDS.defect_claim_recall_max,
    `claim recall failed to detect dropped claims (${defectMetrics.claim_recall})`,
  );
  assert(
    defectMetrics.numeric_accuracy <= BENCHMARK_THRESHOLDS.defect_numeric_accuracy_max,
    `numeric accuracy failed to detect a drifted value (${defectMetrics.numeric_accuracy})`,
  );
  assert(
    defectMetrics.hallucination_rate > 0,
    'hallucination rate failed to detect an invented claim',
  );
  assert(
    defectMetrics.grounding_rate < 1,
    'grounding rate failed to detect a report citing a claim that was never extracted',
  );
  console.log('   every declared defect was detected by its metric');


  /* ---------------- Phase D: contradiction precision / recall ---------------- */
  const decoyPairKeys = BENCHMARK_DECOY_PAIRS.map((pair) => [pair.a, pair.b].sort().join('::'));

  assert(expectedPairs.size === 1, `fixture set must declare exactly one true contradiction pair, found ${expectedPairs.size}`);
  assert(decoyPairKeys.length >= 40, `fixture set must exercise at least 40 non-contradiction pairs, found ${decoyPairKeys.length}`);

  for (const key of expectedPairs) {
    assert(detectedPairs.has(key), `declared contradiction was MISSED: ${key}`);
  }
  const falsePositives = Array.from(detectedPairs).filter((key) => !expectedPairs.has(key));
  assert(
    falsePositives.length === 0,
    `FALSE contradictions reported (different propositions compared as if identical): ${falsePositives.join(', ')}`,
  );

  const contradictionTruePositives = Array.from(detectedPairs).filter((key) => expectedPairs.has(key)).length;
  const contradictionPrecision = detectedPairs.size > 0 ? contradictionTruePositives / detectedPairs.size : 1;
  const contradictionRecall = contradictionTruePositives / expectedPairs.size;
  assert(contradictionPrecision >= BENCHMARK_THRESHOLDS.contradiction_precision, `contradiction precision ${contradictionPrecision} below floor`);
  assert(contradictionRecall >= BENCHMARK_THRESHOLDS.contradiction_recall, `contradiction recall ${contradictionRecall} below floor`);
  console.log(`   contradiction precision ${pct(contradictionPrecision)} recall ${pct(contradictionRecall)} across ${decoyPairKeys.length} decoy pairs (geography/period/metric/unit/provenance)`);

  /* ---------------- Phase E: the verification ladder ---------------- */
  const ladderStatuses = new Set<string>();
  for (const fixture of BENCHMARK_VERIFICATION_FIXTURES) {
    const outcome = RealClaimVerifier.verifyAll([fixture.claim], fixture.sources, fixture.evidence);
    const actual = outcome.verifiedClaims[0].verification_status;
    ladderStatuses.add(actual);
    assert(
      actual === fixture.expect_status,
      `${fixture.id}: expected ${fixture.expect_status} but got ${actual} — ${fixture.rationale}`,
    );
    console.log(`   ladder ${fixture.id} -> ${actual}`);
  }
  assert(ladderStatuses.size >= 7, `ladder must produce distinct statuses across its rungs, saw ${ladderStatuses.size}`);
  assert(
    ladderStatuses.has('SUPPORTED') && ladderStatuses.has('INSUFFICIENT') && ladderStatuses.has('CONTRADICTED'),
    'ladder must reach SUPPORTED, INSUFFICIENT, and CONTRADICTED',
  );
  console.log(`   ladder rungs exercised: ${Array.from(ladderStatuses).join(', ')}`);

  /* ---------------- Phase F: relevance must not be count-derived ---------------- */
  const irrelevant = buildIrrelevantEvidenceFixture();
  const irrelevantOutcome = RealClaimVerifier.verifyAll([irrelevant.claim], irrelevant.sources, irrelevant.evidence);
  const irrelevantRelevance = irrelevantOutcome.evidenceBreakdown.evidence_relevance_score;
  assert(
    irrelevantRelevance <= 2,
    `evidence relevance is still count-derived: ${irrelevant.evidence.length} irrelevant documents scored ${irrelevantRelevance}/20`,
  );
  console.log(`   relevance with ${irrelevant.evidence.length} IRRELEVANT documents: ${irrelevantRelevance}/20 (count-derived scoring would give 20/20)`);

  const supportedFixture = BENCHMARK_VERIFICATION_FIXTURES.find((fixture) => fixture.id === 'v-supported');
  assert(!!supportedFixture, 'ladder must include the fully-supported fixture');
  const supportedOutcome = RealClaimVerifier.verifyAll(
    [supportedFixture!.claim],
    supportedFixture!.sources,
    supportedFixture!.evidence,
  );
  const supportedRelevance = supportedOutcome.evidenceBreakdown.evidence_relevance_score;
  assert(supportedRelevance > 0, `relevant evidence scored ${supportedRelevance}/20 — relevance must not be uniformly zero`);
  console.log(`   relevance with relevant, verbatim, primary evidence: ${supportedRelevance}/20`);

  const summary = `corpus ${BENCHMARK_CORPUS_VERSION}: clean run perfect (claim P/R ${pct(cleanMetrics.claim_precision)}/${pct(cleanMetrics.claim_recall)}, quote ${pct(cleanMetrics.quote_accuracy)}, numeric ${pct(cleanMetrics.numeric_accuracy)}, grounding ${pct(cleanMetrics.grounding_rate)}, hallucination ${pct(cleanMetrics.hallucination_rate)}); all declared defects detected; contradictions P/R ${pct(contradictionPrecision)}/${pct(contradictionRecall)}; ladder ${ladderStatuses.size} rungs`;
  console.log(`✔ Deterministic benchmark corpus passed: ${summary}`);

  return { passed: true, message: summary };
}

