/**
 * Deterministic evaluation metrics for the research engine (spec item 19).
 *
 * This module is PURE: it performs no I/O, calls no model, and contains no
 * randomness. Every metric is a closed-form function of (expected, extracted)
 * inputs, so a benchmark run is exactly reproducible: the same corpus and the
 * same engine output always yield byte-identical metrics.
 *
 * That property is the whole point. "Tests pass" is not a quality claim; these
 * numbers are. The metric set covers the spec's requirements:
 *
 *   - citation precision / recall
 *   - claim extraction precision / recall
 *   - quote accuracy (verbatim slice at exact offsets)
 *   - contradiction precision / recall
 *   - numeric accuracy (within tolerance)
 *   - report grounding rate
 *   - hallucination rate
 */

/** Precision / recall / F1 with the raw confusion counts kept for auditing. */
export interface PRF {
  precision: number;
  recall: number;
  f1: number;
  tp: number;
  fp: number;
  fn: number;
}

/**
 * Safe ratio. A zero (or non-finite) denominator yields 0 rather than NaN, so
 * metrics never propagate NaN into a threshold comparison.
 */
export function ratio(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return 0;
  return numerator / denominator;
}

export function prf(tp: number, fp: number, fn: number): PRF {
  const precision = ratio(tp, tp + fp);
  const recall = ratio(tp, tp + fn);
  const f1 = ratio(2 * precision * recall, precision + recall);
  return { precision, recall, f1, tp, fp, fn };
}

/** A quote plus the coordinates it claims to occupy in the frozen document. */
export interface QuoteCheck {
  document_text: string;
  start_offset: number;
  end_offset: number;
  quote: string;
}

/**
 * The single hard provenance invariant (spec item 8): the stored quote must be
 * EXACTLY the source slice at the stored coordinates. Not "equivalent after
 * normalization" — the verbatim characters.
 */
export function verifyVerbatimQuote(check: QuoteCheck): boolean {
  const { document_text, start_offset, end_offset, quote } = check;
  if (typeof document_text !== 'string' || document_text.length === 0) return false;
  if (!Number.isInteger(start_offset) || !Number.isInteger(end_offset)) return false;
  if (start_offset < 0 || end_offset <= start_offset) return false;
  if (end_offset > document_text.length) return false;
  if (typeof quote !== 'string' || quote.length === 0) return false;
  return document_text.slice(start_offset, end_offset) === quote;
}

/** Fraction of quotes that are verbatim slices at their exact coordinates. */
export function quoteAccuracy(checks: QuoteCheck[]): number {
  if (checks.length === 0) return 1; // nothing asserted, nothing wrong
  const ok = checks.filter(verifyVerbatimQuote).length;
  return ratio(ok, checks.length);
}

export interface NumericCheck {
  actual: number | null;
  expected: number | null;
  /** Relative tolerance in percent; defaults to 0.5%. */
  tolerance_pct?: number;
}

/**
 * Relative-tolerance numeric accuracy. A check with a null on either side is
 * NOT applicable and is excluded from the denominator (never counted as a pass
 * or a fail), so missing values cannot silently inflate the score.
 */
export function numericAccuracy(checks: NumericCheck[], defaultTolerancePct = 0.5): number {
  const applicable = checks.filter((c) => c.actual !== null && c.expected !== null);
  if (applicable.length === 0) return 1;
  let ok = 0;
  for (const check of applicable) {
    const tolerance = (check.tolerance_pct ?? defaultTolerancePct) / 100;
    const actual = check.actual as number;
    const expected = check.expected as number;
    const scale = Math.max(Math.abs(expected), Number.EPSILON);
    if (Math.abs(actual - expected) / scale <= tolerance) ok++;
  }
  return ratio(ok, applicable.length);
}
/** A claim the engine produced, reduced to what the metrics need. */
export interface ExtractedClaim {
  key: string;
  value: number | null;
  unit: string;
  metric: string;
  entity: string;
  geography: string;
  period: string;
  quote: QuoteCheck;
  citation_number: number;
  /** True when the claim is backed by >= 1 evidence item. */
  evidence_backed: boolean;
}

/** A claim the corpus says must be extracted. */
export interface ExpectedClaim {
  key: string;
  value: number | null;
  unit: string;
  metric: string;
  entity: string;
  geography: string;
  period: string;
}

export interface ContradictionPair {
  a: string;
  b: string;
}

/** Order-independent identity for a contradiction pair. */
export function contradictionPairKey(pair: ContradictionPair): string {
  return [pair.a, pair.b].sort().join('::');
}

export interface RunEvaluationInput {
  /** Claims the frozen corpus asserts must be extracted. */
  expected_claims: ExpectedClaim[];
  /** Claims the engine actually produced. */
  extracted_claims: ExtractedClaim[];
  /** Contradiction pairs the corpus asserts are real. */
  expected_contradictions: ContradictionPair[];
  /** Contradiction pairs the engine actually flagged. */
  detected_contradictions: ContradictionPair[];
  /** Claim keys actually referenced by the report body. */
  report_claim_keys: string[];
}

export interface RunMetrics {
  claim_precision: number;
  claim_recall: number;
  claim_f1: number;
  quote_accuracy: number;
  citation_precision: number;
  citation_recall: number;
  contradiction_precision: number;
  contradiction_recall: number;
  numeric_accuracy: number;
  grounding_rate: number;
  hallucination_rate: number;
  counts: {
    expected_claims: number;
    extracted_claims: number;
    true_positives: number;
    false_positives: number;
    false_negatives: number;
    expected_contradictions: number;
    detected_contradictions: number;
    report_claim_keys: number;
  };
}
/**
 * The full metric computation.
 *
 * Definitions (kept explicit so the numbers cannot be re-interpreted):
 *  - claim TP  = extracted claim whose key the corpus expected
 *    claim FP  = extracted claim with no corpus expectation  -> fabrication
 *    claim FN  = expected claim the engine failed to extract
 *  - citation precision = extracted claims that carry a valid, evidence-backed
 *    citation number, over all extracted claims.
 *  - citation recall    = evidence-backed extracted claims that appear in the
 *    report body, over all evidence-backed extracted claims.
 *  - grounding rate     = report-referenced claim keys that exist in the
 *    extracted claim set, over all report-referenced keys.
 *  - hallucination rate = claim FP over extracted claims (the report invented a
 *    claim the evidence does not contain).
 */
export function evaluateRun(input: RunEvaluationInput): RunMetrics {
  const expectedByKey = new Map(input.expected_claims.map((claim) => [claim.key, claim]));
  const extractedByKey = new Map(input.extracted_claims.map((claim) => [claim.key, claim]));

  let tp = 0;
  let fp = 0;
  for (const claim of input.extracted_claims) {
    if (expectedByKey.has(claim.key)) tp++;
    else fp++;
  }
  let fn = 0;
  for (const claim of input.expected_claims) {
    if (!extractedByKey.has(claim.key)) fn++;
  }
  const claimStats = prf(tp, fp, fn);

  const quotes = quoteAccuracy(input.extracted_claims.map((claim) => claim.quote));

  const validCitations = input.extracted_claims.filter(
    (claim) => Number.isInteger(claim.citation_number) && claim.citation_number > 0 && claim.evidence_backed,
  );
  const citationPrecision = ratio(validCitations.length, input.extracted_claims.length);

  const evidenceBacked = input.extracted_claims.filter((claim) => claim.evidence_backed);
  const reportKeys = new Set(input.report_claim_keys);
  const citedBacked = evidenceBacked.filter((claim) => reportKeys.has(claim.key));
  const citationRecall = ratio(citedBacked.length, evidenceBacked.length);

  const expectedPairs = new Set(input.expected_contradictions.map(contradictionPairKey));
  const detectedPairs = new Set(input.detected_contradictions.map(contradictionPairKey));
  let contradictionTp = 0;
  for (const key of detectedPairs) if (expectedPairs.has(key)) contradictionTp++;
  const contradictionPrecision = ratio(contradictionTp, detectedPairs.size);
  const contradictionRecall = ratio(contradictionTp, expectedPairs.size);

  const numeric = numericAccuracy(
    input.extracted_claims.map((claim) => {
      const expected = expectedByKey.get(claim.key);
      return { actual: claim.value, expected: expected ? expected.value : null };
    }),
  );

  const groundedReportKeys = input.report_claim_keys.filter((key) => extractedByKey.has(key));
  const groundingRate = ratio(groundedReportKeys.length, input.report_claim_keys.length);
  const hallucinationRate = ratio(fp, input.extracted_claims.length);

  return {
    claim_precision: claimStats.precision,
    claim_recall: claimStats.recall,
    claim_f1: claimStats.f1,
    quote_accuracy: quotes,
    citation_precision: citationPrecision,
    citation_recall: citationRecall,
    contradiction_precision: contradictionPrecision,
    contradiction_recall: contradictionRecall,
    numeric_accuracy: numeric,
    grounding_rate: groundingRate,
    hallucination_rate: hallucinationRate,
    counts: {
      expected_claims: input.expected_claims.length,
      extracted_claims: input.extracted_claims.length,
      true_positives: tp,
      false_positives: fp,
      false_negatives: fn,
      expected_contradictions: expectedPairs.size,
      detected_contradictions: detectedPairs.size,
      report_claim_keys: input.report_claim_keys.length,
    },
  };
}
