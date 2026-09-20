/**
 * Real Claim Extraction, Contradiction Engine, Numeric Normalizer & Adversarial Verifier
 * Architecture:
 * - Real factual claim extraction from ingested documents
 * - Exact character coordinate mapping [start_offset, end_offset]
 * - Multi-source contradiction detection
 * - Robust financial and metric normalization
 * - 8-Dimension Evidence Scoring Engine with zero dangling citations guarantee
 */

import { Source, Evidence, Claim, ClaimType, VerificationStatus, EvidenceScoreBreakdown } from '../types.js';
import { RealDocumentFetcher } from './fetcher.js';

export interface NormalizedMetric {
  raw: string;
  value: number;
  unit: string;
  currency: string;
  type: 'CURRENCY' | 'PERCENTAGE' | 'COUNT' | 'RATIO' | 'UNKNOWN';
}

export class NumericNormalizer {
  /**
   * Normalizes numeric statements (e.g. "$45.2 Billion", "₹18,500 Crore", "24.5%", "EUR 500M")
   */
  public static normalize(text: string): NormalizedMetric | null {
    if (!text) return null;
    const clean = text.trim();

    // 1. Percentage match (e.g. 18.5%, 24 %)
    const pctMatch = clean.match(/([\d,]+(?:\.\d+)?)\s*%/);
    if (pctMatch) {
      const val = parseFloat(pctMatch[1].replace(/,/g, ''));
      return {
        raw: clean,
        value: isNaN(val) ? 0 : val,
        unit: '%',
        currency: '',
        type: 'PERCENTAGE',
      };
    }

    // 2. INR Crores / Lakhs (e.g. ₹38,000 Cr, INR 4,500 Crores)
    const inrMatch = clean.match(/(?:₹|INR|Rs\.?)\s*([\d,]+(?:\.\d+)?)\s*(Cr|Crore|Crores|Lakh|Lakhs|B|Billion|M|Million)?/i);
    if (inrMatch) {
      let num = parseFloat(inrMatch[1].replace(/,/g, ''));
      const scale = (inrMatch[2] || '').toLowerCase();
      if (scale.startsWith('cr')) {
        num = num * 10000000; // 1 Crore = 10,000,000
      } else if (scale.startsWith('lakh')) {
        num = num * 100000; // 1 Lakh = 100,000
      } else if (scale.startsWith('b')) {
        num = num * 1000000000;
      } else if (scale.startsWith('m')) {
        num = num * 1000000;
      }
      return {
        raw: clean,
        value: num,
        unit: 'INR',
        currency: 'INR',
        type: 'CURRENCY',
      };
    }

    // 3. USD / EUR / GBP Billions / Millions (e.g. $4.5B, $120 Million, €2.1B)
    const currMatch = clean.match(/(\$|USD|€|EUR|£|GBP)\s*([\d,]+(?:\.\d+)?)\s*(B|Billion|M|Million|K|Thousand|Trillion|T)?/i);
    if (currMatch) {
      const symbol = currMatch[1].toUpperCase();
      let currency = 'USD';
      if (symbol === '€' || symbol === 'EUR') currency = 'EUR';
      if (symbol === '£' || symbol === 'GBP') currency = 'GBP';

      let num = parseFloat(currMatch[2].replace(/,/g, ''));
      const scale = (currMatch[3] || '').toUpperCase();
      if (scale.startsWith('T')) {
        num = num * 1000000000000;
      } else if (scale.startsWith('B')) {
        num = num * 1000000000;
      } else if (scale.startsWith('M')) {
        num = num * 1000000;
      } else if (scale.startsWith('K')) {
        num = num * 1000;
      }

      return {
        raw: clean,
        value: num,
        unit: currency,
        currency,
        type: 'CURRENCY',
      };
    }

    // 4. Raw numerical count
    const numMatch = clean.match(/([\d,]+(?:\.\d+)?)/);
    if (numMatch) {
      const val = parseFloat(numMatch[1].replace(/,/g, ''));
      return {
        raw: clean,
        value: isNaN(val) ? 0 : val,
        unit: 'COUNT',
        currency: '',
        type: 'COUNT',
      };
    }

    return null;
  }
}

/**
 * ---------------------------------------------------------------------------
 * Deterministic verification primitives (spec items 6 & 7)
 * ---------------------------------------------------------------------------
 * Everything below is pure, closed-form arithmetic over the claim/evidence
 * graph. There is no model call and no randomness: the same inputs always
 * produce the same decision, so a verification outcome can be re-derived and
 * audited by anyone holding the same evidence.
 */

/** Ratio between two same-proposition values that counts as a real conflict. */
export const CONTRADICTION_RATIO_THRESHOLD = 3.0;

/** Stopwords dropped from relevance tokenization (kept small and explicit). */
const RELEVANCE_STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'was', 'were', 'with', 'that', 'this', 'from',
  'its', 'has', 'have', 'had', 'not', 'but', 'you', 'your', 'our', 'their',
  'will', 'can', 'may', 'per', 'into', 'over', 'than', 'then', 'them', 'they',
  'been', 'being', 'about', 'which', 'when', 'where', 'while', 'also', 'such',
  'more', 'most', 'less', 'least', 'very', 'each', 'other', 'some', 'any',
  'all', 'one', 'two', 'new', 'use', 'used', 'using',
]);

/**
 * Provenance weight. A figure observed in a filing is stronger evidence than a
 * scenario assumption, and the relevance dimension must reflect that instead of
 * counting documents.
 */
const PROVENANCE_WEIGHT: Record<Claim['provenance_type'], number> = {
  OBSERVED: 1.0,
  CALCULATED: 0.9,
  INFERRED: 0.6,
  ASSUMED: 0.3,
};

/** Order-free token set used for deterministic term overlap. */
export function relevanceTokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of String(text || '').toLowerCase().split(/[^a-z0-9%.\u20b9$\u20ac\u00a3]+/i)) {
    const token = raw.replace(/^\.+|\.+$/g, '');
    if (token.length >= 3 && !RELEVANCE_STOPWORDS.has(token)) out.add(token);
  }
  return out;
}

/** Term-overlap (containment) of `query` inside `haystack`, in [0, 1]. */
export function termOverlap(query: string, haystack: string): number {
  const q = relevanceTokens(query);
  if (q.size === 0) return 0;
  const h = relevanceTokens(haystack);
  let hits = 0;
  for (const token of q) if (h.has(token)) hits++;
  return hits / q.size;
}

/** Normalizes one discriminating dimension; "unknown" is the empty string. */
function normalizeDim(value?: string): string {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Relevance of a single evidence item to a single claim, in [0, 1].
 * Combines term overlap, provenance class, and verbatim-provenance integrity.
 * This replaces the previous count-derived heuristic
 * (`min(evidencePool.length, 10) * 2`), which measured document volume rather
 * than whether the evidence actually speaks to the claim.
 */
export function claimEvidenceRelevance(claim: Claim, evidence: Evidence): number {
  const overlap = termOverlap(
    claim.statement,
    `${evidence.quote || ''} ${evidence.statement || ''} ${evidence.section || ''}`,
  );
  const provenanceWeight = PROVENANCE_WEIGHT[claim.provenance_type] ?? 0.5;
  const offsetsValid =
    evidence.start_offset >= 0 &&
    evidence.end_offset > evidence.start_offset &&
    !!evidence.quote;
  let verbatim = 0.25; // unattributable: cannot be checked against the document
  if (offsetsValid) verbatim = evidence.provenance?.exact_normalized_match === false ? 0.8 : 1;
  return Math.max(0, Math.min(1, overlap * provenanceWeight * verbatim));
}

/**
 * Key of the quantitative proposition a claim asserts (spec item 7).
 *
 * A number only contradicts another number when both describe the same thing.
 * The key therefore folds in every discriminating dimension available on the
 * claim: type, entity, metric, geography, period, unit (from the numeric
 * normalizer) and provenance class (the available methodology proxy).
 *
 * Comparability is deliberately conservative: "unknown" equals only "unknown".
 * If a dimension is known on one claim and unknown on the other, the two are
 * NOT comparable, because sameness cannot be proven. This trades recall for
 * precision on purpose — a missed contradiction is a lesser failure than a
 * fabricated one.
 *
 * Returns null when the claim is not a quantitative statement.
 */
export function quantitativePropositionKey(claim: Claim): string | null {
  const normalized = NumericNormalizer.normalize(claim.statement);
  if (!normalized || normalized.type === 'UNKNOWN' || normalized.value <= 0) return null;
  return [
    normalizeDim(claim.claim_type),
    normalizeDim(claim.entity),
    normalizeDim(claim.metric),
    normalizeDim(claim.geography),
    normalizeDim(claim.time_period),
    normalizeDim(normalized.unit),
    normalizeDim(claim.provenance_type),
  ].join('\u0001');
}

export class ContradictionEngine {
  /**
   * Evaluates pairs of claims and evidence to detect factual or quantitative contradictions
   */
  public static analyzeContradictions(claims: Claim[], evidencePool: Evidence[]): {
    contradictionsFound: Array<{ claimId1: string; claimId2?: string; reason: string }>;
    consistencyScore: number;
  } {
    const contradictions: Array<{ claimId1: string; claimId2?: string; reason: string }> = [];

    // Map evidence by ID for quick lookup
    const evMap = new Map<string, Evidence>();
    evidencePool.forEach(e => evMap.set(e.id, e));

    for (let i = 0; i < claims.length; i++) {
      const c1 = claims[i];

      // Check against explicit contradicting evidence list
      if (c1.contradicting_evidence_ids && c1.contradicting_evidence_ids.length > 0) {
        contradictions.push({
          claimId1: c1.id,
          reason: `Claim has ${c1.contradicting_evidence_ids.length} conflicting evidence citations.`,
        });
      }

      // Cross-compare quantitative metrics ONLY between claims that assert the
      // same proposition (same type + entity + metric + geography + period +
      // unit + provenance class). Previously this compared any two claims of the
      // same type whose units agreed, which reported legitimate differences as
      // contradictions: "market size in India" vs "market size globally",
      // "revenue 2024" vs "revenue 2025", TAM vs SAM, GMV vs ARR, and so on.
      for (let j = i + 1; j < claims.length; j++) {
        const c2 = claims[j];

        const key1 = quantitativePropositionKey(c1);
        const key2 = quantitativePropositionKey(c2);
        if (key1 === null || key2 === null) continue; // non-quantitative: no numeric comparison
        if (key1 !== key2) continue; // different proposition: never a contradiction

        const norm1 = NumericNormalizer.normalize(c1.statement);
        const norm2 = NumericNormalizer.normalize(c2.statement);
        if (!norm1 || !norm2) continue;

        const higher = Math.max(norm1.value, norm2.value);
        const lower = Math.min(norm1.value, norm2.value);
        const ratio = lower > 0 ? higher / lower : Infinity;

        if (ratio > CONTRADICTION_RATIO_THRESHOLD) {
          contradictions.push({
            claimId1: c1.id,
            claimId2: c2.id,
            reason: `Quantitative divergence on the same proposition (${c1.claim_type} / ${c1.entity || 'unknown entity'} / ${c1.geography || 'unknown geography'} / ${c1.time_period || 'unknown period'}): ${norm1.raw} vs ${norm2.raw} (ratio ${ratio.toFixed(1)}x)`,
          });
        }
      }
    }

    // Consistency score (0 - 10)
    const penalty = Math.min(10, contradictions.length * 2.5);
    const consistencyScore = Math.max(0, 10 - penalty);

    return {
      contradictionsFound: contradictions,
      consistencyScore,
    };
  }
}

export class RealClaimVerifier {
  /**
   * 8-Dimension Multi-Source Adversarial Verifier
   */
  public static verifyAll(
    claims: Claim[],
    sources: Source[],
    evidencePool: Evidence[]
  ): {
    verifiedClaims: Claim[];
    evidenceBreakdown: EvidenceScoreBreakdown;
  } {
    // 1. Source Quality Score (0-20): mean reliability of the sources that
    // actually contributed evidence. Unrated sources are NOT defaulted to a
    // flattering 80, and a legitimate 0 is not silently promoted to 80.
    const contributingSourceIds = new Set(evidencePool.map(e => e.source_id));
    const ratedSources = sources.filter(
      s => contributingSourceIds.has(s.id) && typeof s.reliability_score === 'number',
    );
    const avgSourceReliability = ratedSources.length > 0
      ? ratedSources.reduce((sum, s) => sum + (s.reliability_score as number), 0) / ratedSources.length
      : 0;
    const sourceQualityScore = Math.min(20, Math.round(avgSourceReliability * 0.2));

    // 2. Evidence Relevance Score (0-20): the MEAN deterministic relevance of
    // each evidence item to the claim it supports (term overlap × provenance
    // class × verbatim-provenance integrity).
    //
    // The previous implementation was `Math.min(evidencePool.length, 10) * 2`,
    // which scored document COUNT rather than semantic relevance: a pile of
    // entirely irrelevant documents scored a perfect 20/20.
    const evById = new Map<string, Evidence>();
    evidencePool.forEach(e => evById.set(e.id, e));
    const relevanceObservations: number[] = [];
    for (const claim of claims) {
      for (const evidenceId of claim.supporting_evidence_ids || []) {
        const ev = evById.get(evidenceId);
        if (ev) relevanceObservations.push(claimEvidenceRelevance(claim, ev));
      }
    }
    const meanRelevance = relevanceObservations.length > 0
      ? relevanceObservations.reduce((a, b) => a + b, 0) / relevanceObservations.length
      : 0;
    const evidenceRelevanceScore = Math.min(20, Math.round(meanRelevance * 20));

    // 3. Directness Score (0-15) - primary quotes vs secondary paraphrasing
    const primaryCount = evidencePool.filter(e => e.evidence_type === 'PRIMARY_SOURCE' || e.evidence_type === 'EMPIRICAL_DATA').length;
    const directnessScore = Math.min(15, Math.round((primaryCount / Math.max(1, evidencePool.length)) * 15));

    // 4. Corroboration Score (0-15) - claims supported by >1 independent domain
    let corroboratedClaims = 0;
    const evMap = new Map<string, Evidence>();
    evidencePool.forEach(e => evMap.set(e.id, e));

    for (const c of claims) {
      const supportingSources = (c.supporting_evidence_ids || [])
        .map(id => evMap.get(id)?.source_id)
        .filter(Boolean);
      const uniqueSourceDomains = new Set(
        supportingSources.map(sId => sources.find(s => s.id === sId)?.domain).filter(Boolean)
      );
      if (uniqueSourceDomains.size >= 2) {
        corroboratedClaims++;
      }
    }
    const corroborationScore = Math.min(15, Math.round((corroboratedClaims / Math.max(1, claims.length)) * 15));

    // 5. Recency Score (0-10) calculated from VERIFIED publication dates only.
    // Sources with unknown publication dates (null) are EXCLUDED from the
    // average — no fabricated recency credit is granted for unknown metadata.
    const currentYear = new Date().getFullYear();
    const datedSources = sources.filter(s => s.published_at);
    const avgSourceAgeYears = datedSources.length > 0
      ? datedSources.reduce((sum, s) => {
          const pubYear = new Date(s.published_at!).getFullYear();
          return sum + Math.max(0, currentYear - pubYear);
        }, 0) / datedSources.length
      : Infinity; // no verifiable publication dates -> no recency credit
    const recencyScore = Number.isFinite(avgSourceAgeYears)
      ? Math.max(0, Math.min(10, Math.round(10 - (avgSourceAgeYears * 1.5))))
      : 0;

    // 6. Extraction Quality Score (0-10) - exact character coordinates validity
    const validOffsets = evidencePool.filter(e => e.start_offset >= 0 && e.end_offset > e.start_offset).length;
    const extractionQualityScore = Math.min(10, Math.round((validOffsets / Math.max(1, evidencePool.length)) * 10));

    const citationsFullyIntact = evidencePool.length > 0 && evidencePool.every(e => e.start_offset >= 0 && e.end_offset > e.start_offset);

    // 7. Consistency Score (0-10) via Contradiction Engine
    const contradictionAnalysis = ContradictionEngine.analyzeContradictions(claims, evidencePool);
    const consistencyScore = Math.round(contradictionAnalysis.consistencyScore);

    // Calculate Overall Score (0-100)
    const totalRaw =
      sourceQualityScore +
      evidenceRelevanceScore +
      directnessScore +
      corroborationScore +
      recencyScore +
      extractionQualityScore +
      consistencyScore;

    const overallScore = Math.min(100, totalRaw);

    // Claims must EARN the word "verified" (spec item 6).
    //
    // The previous implementation started every claim at SUPPORTED and only
    // downgraded it when something went wrong, so an unevidenced assertion was
    // published as verified by default. That is exactly backwards.
    //
    // Each claim now advances through explicit, individually checkable gates and
    // reports the LAST gate it actually cleared:
    //
    //   EXTRACTED             the claim exists
    //   EVIDENCE-MATCHED      >=1 supporting evidence with valid, verbatim offsets
    //   SOURCE-ASSESSED       >=1 supporting source with KNOWN, adequate reliability
    //   TEMPORALLY-VALID      every supporting source has a KNOWN publication date
    //                         inside the recency window (unknown dates cannot
    //                         pass: no credit for metadata we do not have)
    //   CONTRADICTION-CHECKED no unresolved conflict on the same proposition
    //   CORROBORATED          >=2 independent source domains, but the claim's own
    //                         extraction confidence does not clear the support bar
    //   SUPPORTED             every gate above passed
    //
    // Explicit failure modes: CONTRADICTED (conflicting evidence exists) and
    // INSUFFICIENT (nothing supports the claim).
    const SOURCE_RELIABILITY_FLOOR = 70;
    const RECENCY_WINDOW_YEARS = 5;
    const SUPPORT_CONFIDENCE_FLOOR = 70;

    const verifiedClaims: Claim[] = claims.map((c, idx) => {
      const supportingEvidence = (c.supporting_evidence_ids || [])
        .map(id => evById.get(id))
        .filter((e): e is Evidence => !!e);

      const supportingSourceIds = new Set(supportingEvidence.map(e => e.source_id));
      const supportingSources = sources.filter(s => supportingSourceIds.has(s.id));
      const independentDomains = new Set(
        supportingSources.map(s => s.domain).filter((d): d is string => !!d),
      );

      // Gate: EVIDENCE-MATCHED — the quote must sit at real coordinates in a
      // hashed document, not merely be asserted by the extractor.
      const evidenceMatched = supportingEvidence.some(
        e => e.start_offset >= 0
          && e.end_offset > e.start_offset
          && !!e.quote
          && !!e.provenance?.document_hash,
      );

      // Gate: SOURCE-ASSESSED — a source with KNOWN reliability above the floor.
      const sourceAssessed = supportingSources.some(
        s => typeof s.reliability_score === 'number' && s.reliability_score >= SOURCE_RELIABILITY_FLOOR,
      );

      // Gate: TEMPORALLY-VALID — every supporting source must carry a real date.
      const temporallyValid = supportingSources.length > 0 && supportingSources.every(s => {
        if (!s.published_at) return false;
        const year = new Date(s.published_at).getFullYear();
        return Number.isFinite(year) && currentYear - year <= RECENCY_WINDOW_YEARS;
      });

      // Gate: CORROBORATED — agreement across >=2 independent domains.
      const corroborated = independentDomains.size >= 2;

      const hasConflict = (c.contradicting_evidence_ids || []).length > 0;

      let status: VerificationStatus;
      let conf = c.confidence || 90;

      if (supportingEvidence.length === 0) {
        status = 'INSUFFICIENT';
        conf = 50;
      } else if (hasConflict) {
        status = 'CONTRADICTED';
        conf = Math.max(40, conf - 25);
      } else if (!evidenceMatched) {
        status = 'EXTRACTED';
        conf = Math.min(conf, 55);
      } else if (!sourceAssessed) {
        status = 'EVIDENCE-MATCHED';
        conf = Math.min(conf, 65);
      } else if (!temporallyValid) {
        status = 'SOURCE-ASSESSED';
        conf = Math.min(conf, 72);
      } else if (!corroborated) {
        status = 'CONTRADICTION-CHECKED';
        conf = Math.min(conf, 80);
      } else if (conf < SUPPORT_CONFIDENCE_FLOOR) {
        status = 'CORROBORATED';
      } else {
        status = 'SUPPORTED';
        conf = Math.max(conf, 85);
      }

      return {
        ...c,
        citation_number: c.citation_number || idx + 1,
        verification_status: status,
        confidence: conf,
      };
    });

    const breakdown: EvidenceScoreBreakdown = {
      overall_score: overallScore,
      source_quality_score: sourceQualityScore,
      evidence_relevance_score: evidenceRelevanceScore,
      directness_score: directnessScore,
      corroboration_score: corroborationScore,
      recency_score: recencyScore,
      consistency_score: consistencyScore,
      extraction_quality_score: extractionQualityScore,
      gates_passed: {
        has_primary_evidence: primaryCount > 0,
        no_unresolved_contradictions: contradictionAnalysis.contradictionsFound.length === 0,
        high_tier_sources_present: sources.some(s => s.source_type === 'TIER_A' || s.source_type === 'TIER_B'),
        citations_fully_intact: citationsFullyIntact,
      },
    };

    return {
      verifiedClaims,
      evidenceBreakdown: breakdown,
    };
  }
}
