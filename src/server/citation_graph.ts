/**
 * Mandatory Citation Graph Validation
 *
 * Hardening contract: a research report may only be persisted and served if
 * its entire citation graph is referentially intact:
 *   claim -> supporting/contradicting evidence -> source
 *   section / recommendation / trend / opportunity / risk / regulation -> claim
 *
 * Any dangling reference is a FATAL error (validation fails), because a
 * dangling citation is indistinguishable from a fabricated one.
 */

import type { FullResearchReport } from '../types.js';

export interface CitationGraphIssue {
  code: string;
  message: string;
  entityId?: string;
}

export interface CitationGraphValidationResult {
  valid: boolean;
  errors: CitationGraphIssue[];
  warnings: CitationGraphIssue[];
  stats: {
    claims: number;
    evidence: number;
    sources: number;
    sections: number;
    strategic_references_validated: number;
    ungrounded_strategic_entities: number;
  };
}

export class CitationGraphValidator {
  public static validate(report: FullResearchReport): CitationGraphValidationResult {
    const errors: CitationGraphIssue[] = [];
    const warnings: CitationGraphIssue[] = [];

    const claimIds = new Set(report.claims.map(c => c.id));
    const evidenceIds = new Set(report.evidence_pool.map(e => e.id));
    const sourceIds = new Set(report.sources.map(s => s.id));

    if (report.sources.length === 0) {
      errors.push({ code: 'NO_SOURCES', message: 'Report contains zero sources' });
    }

    // 1. Evidence -> Source referential integrity
    for (const ev of report.evidence_pool) {
      if (!sourceIds.has(ev.source_id)) {
        errors.push({
          code: 'EVIDENCE_SOURCE_MISSING',
          message: `Evidence ${ev.id} references unknown source ${ev.source_id}`,
          entityId: ev.id,
        });
      }
    }

    // 2. Evidence coordinate & quote integrity
    for (const ev of report.evidence_pool) {
      if (
        typeof ev.start_offset !== 'number' ||
        typeof ev.end_offset !== 'number' ||
        ev.start_offset < 0 ||
        ev.end_offset <= ev.start_offset
      ) {
        errors.push({
          code: 'EVIDENCE_OFFSET_INVALID',
          message: `Evidence ${ev.id} has invalid character coordinates [${ev.start_offset}, ${ev.end_offset}]`,
          entityId: ev.id,
        });
      }
      if (!ev.quote || ev.quote.trim().length === 0) {
        errors.push({
          code: 'EVIDENCE_QUOTE_EMPTY',
          message: `Evidence ${ev.id} carries an empty verbatim quote`,
          entityId: ev.id,
        });
      }
    }


    // 3. Claim -> Evidence referential integrity + grounding requirement
    for (const claim of report.claims) {
      if (!claim.supporting_evidence_ids || claim.supporting_evidence_ids.length === 0) {
        errors.push({
          code: 'CLAIM_UNGROUNDED',
          message: `Claim ${claim.id} has no supporting evidence and must not be published`,
          entityId: claim.id,
        });
      } else {
        for (const evId of claim.supporting_evidence_ids) {
          if (!evidenceIds.has(evId)) {
            errors.push({
              code: 'CLAIM_EVIDENCE_MISSING',
              message: `Claim ${claim.id} references unknown supporting evidence ${evId}`,
              entityId: claim.id,
            });
          }
        }
      }
      for (const evId of claim.contradicting_evidence_ids || []) {
        if (!evidenceIds.has(evId)) {
          errors.push({
            code: 'CLAIM_CONTRADICTION_MISSING',
            message: `Claim ${claim.id} references unknown contradicting evidence ${evId}`,
            entityId: claim.id,
          });
        }
      }
    }

    // 4. Citation numbers must be unique positive integers
    const seenCitationNumbers = new Map<number, string>();
    for (const claim of report.claims) {
      const n = claim.citation_number;
      if (typeof n !== 'number' || !Number.isFinite(n) || n < 1) {
        warnings.push({
          code: 'CITATION_NUMBER_MISSING',
          message: `Claim ${claim.id} has no valid citation_number`,
          entityId: claim.id,
        });
        continue;
      }
      if (seenCitationNumbers.has(n)) {
        errors.push({
          code: 'CITATION_NUMBER_DUPLICATE',
          message: `Citation number ${n} is shared by claims ${seenCitationNumbers.get(n)} and ${claim.id}`,
          entityId: claim.id,
        });
      } else {
        seenCitationNumbers.set(n, claim.id);
      }
    }

    // 5. Report section -> Claim referential integrity
    for (const section of report.sections) {
      for (const id of section.cited_claim_ids || []) {
        if (!claimIds.has(id)) {
          errors.push({
            code: 'SECTION_CLAIM_MISSING',
            message: `Section ${section.id} cites unknown claim ${id}`,
            entityId: section.id,
          });
        }
      }
    }

    // 6. Strategic entity -> Claim referential integrity (dangling = fatal,
    //    ungrounded = warning). The pipeline pre-filters ungrounded entities,
    //    so a warning here indicates an upstream bypass to investigate.
    let strategicReferences = 0;
    let ungroundedEntities = 0;
    const checkClaimRefs = (
      owner: string,
      entityId: string,
      ids: string[] | undefined,
      danglingCode: string
    ) => {
      const valid = (ids || []).filter(id => {
        strategicReferences++;
        if (claimIds.has(id)) return true;
        errors.push({
          code: danglingCode,
          message: `${owner} "${entityId}" references unknown claim ${id}`,
          entityId,
        });
        return false;
      });
      if (valid.length === 0) {
        ungroundedEntities++;
        warnings.push({
          code: 'STRATEGIC_ENTITY_UNGROUNDED',
          message: `${owner} "${entityId}" has no verifiable supporting claim`,
          entityId,
        });
      }
    };

    report.recommendations.forEach(r => checkClaimRefs('Recommendation', r.id, r.supporting_claim_ids, 'RECOMMENDATION_CLAIM_MISSING'));
    report.trends.forEach(t => checkClaimRefs('Trend', t.title, t.claim_ids, 'TREND_CLAIM_MISSING'));
    report.opportunities.forEach(o => checkClaimRefs('Opportunity', o.title, o.claim_ids, 'OPPORTUNITY_CLAIM_MISSING'));
    report.risks.forEach(r => checkClaimRefs('Risk', r.id, r.supporting_claim_ids, 'RISK_CLAIM_MISSING'));
    report.regulatory_factors.forEach(rf => checkClaimRefs('RegulatoryFactor', rf.policy_name, rf.claim_ids, 'REGULATION_CLAIM_MISSING'));

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      stats: {
        claims: report.claims.length,
        evidence: report.evidence_pool.length,
        sources: report.sources.length,
        sections: report.sections.length,
        strategic_references_validated: strategicReferences,
        ungrounded_strategic_entities: ungroundedEntities,
      },
    };
  }
}