/**
 * Market Research Agent V2 — Domain Types & Schemas
 * Core Principle: "The LLM may reason over evidence, but it must never become the evidence."
 */

export type JobStatus =
  | 'QUEUED'
  | 'PLANNING'
  | 'DISCOVERING'
  | 'FETCHING'
  | 'EXTRACTING'
  | 'BUILDING_CLAIMS'
  | 'VERIFYING'
  | 'ANALYZING'
  | 'SYNTHESIZING'
  | 'GENERATING_REPORT'
  | 'COMPLETED'
  | 'PARTIAL'
  | 'FAILED'
  | 'CANCELLED';

export type StageName =
  | 'PLANNING'
  | 'DISCOVERING'
  | 'FETCHING'
  | 'EXTRACTING'
  | 'BUILDING_CLAIMS'
  | 'VERIFYING'
  | 'ANALYZING'
  | 'SYNTHESIZING'
  | 'GENERATING_REPORT';

export type SourceTier = 'TIER_A' | 'TIER_B' | 'TIER_C' | 'TIER_D';

export type VerificationStatus =
  | 'SUPPORTED'
  | 'PARTIALLY_SUPPORTED'
  | 'CONTRADICTED'
  | 'INSUFFICIENT'
  | 'UNVERIFIED';

export type ClaimType =
  | 'MARKET_SIZE'
  | 'MARKET_GROWTH'
  | 'COMPETITOR'
  | 'PRICING'
  | 'CUSTOMER'
  | 'REGULATION'
  | 'TECHNOLOGY'
  | 'FUNDING'
  | 'REVENUE'
  | 'VALUATION'
  | 'TREND'
  | 'RISK'
  | 'OPPORTUNITY'
  | 'FINANCIAL'
  | 'STRATEGIC';

export type EvidenceRelationship = 'SUPPORTS' | 'CONTRADICTS' | 'CONTEXT';

export interface ResearchJobRequest {
  question: string;
  industry: string;
  geography: string;
  time_horizon: string;
  objectives: string[];
  target_company?: string;
  competitors?: string[];
  scope_depth?: 'standard' | 'deep' | 'exhaustive';
}

export interface ResearchStats {
  sources_discovered: number;
  sources_analyzed: number;
  evidence_items: number;
  claims_total: number;
  claims_verified: number;
  claims_contradicted: number;
  claims_insufficient: number;
  evidence_score: number; // 0 - 100
}

export interface ResearchStage {
  id: string;
  job_id: string;
  stage_name: StageName;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'SKIPPED';
  started_at?: string;
  completed_at?: string;
  message?: string;
  progress: number; // 0 - 100
}

export interface Source {
  id: string;
  job_id: string;
  url: string;
  canonical_url: string;
  domain: string;
  title: string;
  publisher: string;
  published_at: string;
  retrieved_at: string;
  source_type: SourceTier;
  language: string;
  http_status: number;
  discovery_method: 'SEARCH_API' | 'SEED_URL' | 'CROSS_REFERENCE';
  content_hash: string;
  snippet?: string;
  reliability_score: number; // 0 - 100
}

export interface DocumentChunk {
  id: string;
  source_id: string;
  title: string;
  section: string;
  text: string;
  word_count: number;
  offset_start: number;
  offset_end: number;
}

export interface Evidence {
  id: string;
  job_id: string;
  document_id: string;
  source_id: string;
  evidence_type: string;
  text: string;
  quote: string;
  start_offset: number;
  end_offset: number;
  page_number?: number;
  section: string;
  extraction_confidence: number; // 0 - 100
  provenance_type: 'OBSERVED' | 'INFERRED' | 'ASSUMED' | 'CALCULATED';
  created_at: string;
  // Hydrated references
  source?: Source;
}

export interface Claim {
  id: string;
  job_id: string;
  statement: string;
  claim_type: ClaimType;
  entity?: string;
  metric?: string;
  geography?: string;
  time_period?: string;
  verification_status: VerificationStatus;
  confidence: number; // 0 - 100
  reasoning: string;
  provenance_type: 'OBSERVED' | 'INFERRED' | 'ASSUMED' | 'CALCULATED';
  created_at: string;
  supporting_evidence_ids: string[];
  contradicting_evidence_ids: string[];
  citation_number?: number;
  // Hydrated references
  supporting_evidence?: Evidence[];
  contradicting_evidence?: Evidence[];
}

export interface MarketMetric {
  id: string;
  job_id: string;
  metric_name: string;
  value: number;
  formatted_value: string;
  unit: string;
  currency: string;
  geography: string;
  period_start: string;
  period_end: string;
  source_claim_id?: string;
  confidence: number;
}

export interface CompetitorProfile {
  id: string;
  name: string;
  website: string;
  category: string;
  description: string;
  market_position: 'LEADER' | 'CHALLENGER' | 'NICHE' | 'EMERGING';
  strengths: string[];
  weaknesses: string[];
  pricing_summary: string;
  target_customer: string;
  verified_claims_count: number;
}

export interface PricingTier {
  competitor_name: string;
  tier_name: string;
  amount: number;
  currency: string;
  billing_period: 'MONTH' | 'YEAR' | 'ONE_TIME';
  unit: 'ACCOUNT' | 'USER' | 'CONNECTOR' | 'API_CALL';
  annualized_amount: number;
  features: string[];
  target_segment: string;
}

export interface CustomerSegment {
  id: string;
  name: string;
  segment_type: 'OBSERVED' | 'INFERRED' | 'HYPOTHESIZED';
  description: string;
  estimated_tam_share_pct: number;
  willingness_to_pay: 'HIGH' | 'MEDIUM' | 'LOW';
  decision_makers: string[];
  pain_points: string[];
  key_buying_criteria: string[];
  churn_risk: string;
}

export interface FinancialOutputs {
  cagr_pct: number;
  tam_current: number;
  tam_forecast: number;
  sam: number;
  som: number;
  currency: string;
  year_start: number;
  year_end: number;
  scenario_conservative: {
    year_3_revenue: number;
    gross_margin_pct: number;
    break_even_month: number;
    cac: number;
    ltv: number;
    ltv_to_cac: number;
  };
  scenario_base: {
    year_3_revenue: number;
    gross_margin_pct: number;
    break_even_month: number;
    cac: number;
    ltv: number;
    ltv_to_cac: number;
  };
  scenario_aggressive: {
    year_3_revenue: number;
    gross_margin_pct: number;
    break_even_month: number;
    cac: number;
    ltv: number;
    ltv_to_cac: number;
  };
}

export interface StrategicRecommendation {
  id: string;
  title: string;
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  timeframe: 'IMMEDIATE' | '6_MONTHS' | '12_MONTHS' | 'YEAR_2';
  rationale: string;
  risk_factors: string[];
  supporting_claim_ids: string[];
}

export interface RiskFactor {
  id: string;
  category: 'REGULATORY' | 'COMPETITIVE' | 'FINANCIAL' | 'TECHNOLOGICAL' | 'EXECUTION';
  title: string;
  probability: 'HIGH' | 'MEDIUM' | 'LOW';
  impact: 'SEVERE' | 'MODERATE' | 'MINOR';
  mitigation: string;
  supporting_claim_ids: string[];
}

export interface ReportSection {
  id: string;
  title: string;
  order: number;
  summary: string;
  content: string; // Markdown / prose with [claim_id] or [N] citations
  cited_claim_ids: string[];
}

export interface EvidenceScoreBreakdown {
  overall_score: number; // 0-100
  source_quality_score: number; // /20
  evidence_relevance_score: number; // /20
  directness_score: number; // /15
  corroboration_score: number; // /15
  recency_score: number; // /10
  consistency_score: number; // /10
  extraction_quality_score: number; // /10
  gates_passed: {
    has_primary_evidence: boolean;
    no_unresolved_contradictions: boolean;
    high_tier_sources_present: boolean;
    citations_fully_intact: boolean;
  };
}

export interface FullResearchReport {
  id: string;
  job_id: string;
  version: number;
  title: string;
  generated_at: string;
  question: string;
  geography: string;
  industry: string;
  time_horizon: string;
  executive_summary: string;
  evidence_score_breakdown: EvidenceScoreBreakdown;
  sections: ReportSection[];
  market_metrics: MarketMetric[];
  financial_models: FinancialOutputs;
  competitors: CompetitorProfile[];
  pricing_tiers: PricingTier[];
  customer_segments: CustomerSegment[];
  trends: { title: string; description: string; impact: string; claim_ids: string[] }[];
  regulatory_factors: { policy_name: string; authority: string; impact_summary: string; compliance_req: string; claim_ids: string[] }[];
  opportunities: { title: string; description: string; value_pool: string; claim_ids: string[] }[];
  risks: RiskFactor[];
  recommendations: StrategicRecommendation[];
  limitations: string[];
  sources: Source[];
  claims: Claim[];
  evidence_pool: Evidence[];
}

export interface ResearchJob {
  id: string;
  question: string;
  industry: string;
  geography: string;
  time_horizon: string;
  objectives: string[];
  target_company?: string;
  competitors_input?: string[];
  status: JobStatus;
  current_stage: StageName;
  progress: number;
  created_at: string;
  completed_at?: string;
  error_message?: string;
  stats: ResearchStats;
  stages: ResearchStage[];
  report?: FullResearchReport;
}

export interface ResearchEvent {
  id: number;
  job_id: string;
  event_type: 'stage_started' | 'stage_progress' | 'stage_completed' | 'source_discovered' | 'evidence_extracted' | 'claim_verified' | 'calculation_performed' | 'error' | 'completed';
  stage: StageName;
  message: string;
  progress: number;
  metadata?: Record<string, any>;
  created_at: string;
}
