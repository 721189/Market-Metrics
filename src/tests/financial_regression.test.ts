import type { Claim } from '../types.js';
import { extractVerifiedMarketSizing, FinancialEngine } from '../server/financial.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error('Financial regression failed: ' + message);
}

function claim(
  id: string,
  claim_type: Claim['claim_type'],
  statement: string,
  verification_status: Claim['verification_status'] = 'SUPPORTED',
): Claim {
  return {
    id,
    job_id: 'financial-regression-job',
    statement,
    claim_type,
    verification_status,
    confidence: 95,
    reasoning: 'Deterministic financial regression fixture',
    provenance_type: 'OBSERVED',
    created_at: '2026-01-01T00:00:00.000Z',
    supporting_evidence_ids: ['evidence-' + id],
    contradicting_evidence_ids: [],
  };
}

export async function runFinancialRegressionTests(): Promise<boolean> {
  const verifiedClaims = [
    claim('tam', 'MARKET_SIZE', 'The total addressable market (TAM) was USD 10 billion in 2023 and is projected to reach USD 15 billion by 2028.'),
    claim('sam', 'MARKET_SIZE', 'The serviceable available market (SAM) is USD 2 billion.'),
    claim('som', 'MARKET_SIZE', 'The serviceable obtainable market (SOM) is USD 200 million.'),
    claim('cagr', 'MARKET_GROWTH', 'The market CAGR is 8% from 2023 to 2028.'),
    claim('unsupported', 'MARKET_SIZE', 'The TAM is USD 99 billion.', 'PARTIALLY_SUPPORTED'),
  ];
  const sizing = extractVerifiedMarketSizing(verifiedClaims);
  assert(sizing.data_status === 'SOURCE_BACKED', 'verified market data must be marked source-backed');
  assert(sizing.tam_current === 10_000_000_000, 'TAM base amount and billion multiplier');
  assert(sizing.tam_forecast === 15_000_000_000, 'TAM forecast amount and year attribution');
  assert(sizing.sam === 2_000_000_000, 'explicit SAM extraction');
  assert(sizing.som === 200_000_000, 'explicit SOM extraction');
  assert(sizing.cagr_pct === 8, 'CAGR extraction');
  assert(sizing.currency === 'USD', 'currency must be explicit and consistent');
  assert(sizing.metric_claim_ids.tam_current === 'tam', 'TAM must retain its source claim');
  assert(!sizing.source_claim_ids.includes('unsupported'), 'partially-supported claims must not enter financial outputs');

  const mixedCurrency = extractVerifiedMarketSizing([
    claim('tam-inr', 'MARKET_SIZE', 'TAM is INR 10 billion.'),
    claim('sam-eur', 'MARKET_SIZE', 'SAM is EUR 2 billion.'),
  ]);
  assert(mixedCurrency.currency === null, 'mixed currencies must not be silently combined');
  assert(mixedCurrency.tam_current === null && mixedCurrency.sam === null, 'mixed-currency sizing must be withheld');

  const ambiguous = extractVerifiedMarketSizing([
    claim('ambiguous', 'MARKET_SIZE', 'The TAM was USD 10 billion, with another estimate of USD 12 billion.'),
  ]);
  assert(ambiguous.tam_current === null && ambiguous.tam_forecast === null, 'ambiguous amounts must not be assigned to base/forecast');

  const unsupportedOnly = extractVerifiedMarketSizing([
    claim('unverified', 'MARKET_SIZE', 'TAM is USD 10 billion.', 'UNVERIFIED'),
  ]);
  assert(unsupportedOnly.data_status === 'INSUFFICIENT_EVIDENCE', 'unverified-only inputs must not produce market sizing');

  assert(FinancialEngine.calculateCAGR(100, 200, 2) === 41.42, 'CAGR calculation and rounding');
  assert(FinancialEngine.calculateCAGR(0, 200, 2) === null, 'zero baseline must not produce CAGR');
  assert(FinancialEngine.calculateCAGR(100, 200, 0) === null, 'zero-year period must not produce CAGR');

  const economics = FinancialEngine.calculateUnitEconomics({
    arpu_annual: 1200,
    gross_margin_pct: 75,
    annual_churn_rate_pct: 10,
    cac: 300,
    sales_cycle_months: 4,
    expansion_rate_pct: 20,
    revenue_growth_pct: 30,
    operating_margin_pct: 10,
  });
  assert(economics.ltv === 9000, 'LTV must use annual ARPU, gross margin and annual churn');
  assert(economics.ltv_to_cac === 30, 'LTV:CAC must use calculated LTV and CAC');
  assert(economics.payback_period_months === 4, 'CAC payback must use monthly gross profit');
  assert(economics.net_revenue_retention_pct === 110, 'NRR must include expansion and churn');
  assert(economics.rule_of_40_score === 40, 'Rule of 40 must use revenue growth and operating margin');

  const missingOperatingInputs = FinancialEngine.calculateUnitEconomics({
    arpu_annual: 1200,
    gross_margin_pct: 75,
    annual_churn_rate_pct: 0,
    cac: 0,
    sales_cycle_months: 4,
  });
  assert(missingOperatingInputs.ltv === null, 'zero/unknown churn must not invent finite LTV');
  assert(missingOperatingInputs.ltv_to_cac === null, 'zero CAC or unknown LTV must not produce a ratio');
  assert(missingOperatingInputs.net_revenue_retention_pct === null, 'NRR must remain unavailable without expansion');
  assert(missingOperatingInputs.rule_of_40_score === null, 'Rule of 40 must remain unavailable without both inputs');

  const sensitivity = FinancialEngine.generateSensitivityMatrix(1200, 0, 75);
  assert(sensitivity.length === 3 && sensitivity.every(row => row.length === 3), 'sensitivity matrix dimensions');
  assert(sensitivity.every(row => row.every(cell => cell.ltv_to_cac === null)), 'zero CAC must remain an undefined ratio throughout sensitivity output');

  return true;
}
