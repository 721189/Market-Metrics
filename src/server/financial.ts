import type { Claim } from '../types.js';

/**
 * Deterministic Financial & Analytical Engine
 * Blueprint Rules:
 * - "LLMs explain. Code calculates." (Section 63)
 * - "Never ask the LLM to calculate CAGR."
 * - All formulas deterministic, zero floating math errors, strictly typed.
 */

export interface SizingInputs {
  tam_current: number;
  tam_forecast: number;
  year_start: number;
  year_end: number;
  sam_share_pct: number; // e.g. 25% of TAM
  som_share_pct: number; // e.g. 8% of SAM
  currency: string;
}

export interface UnitEconomicsInputs {
  arpu_annual: number;
  gross_margin_pct: number;
  annual_churn_rate_pct: number;
  cac: number;
  sales_cycle_months: number;
  /** Optional measured expansion beyond retained recurring revenue. */
  expansion_rate_pct?: number;
  /** Required with operating_margin_pct for a valid Rule of 40 calculation. */
  revenue_growth_pct?: number;
  operating_margin_pct?: number;
}

export interface SensitivityMatrixCell {
  arpu: number;
  churn_pct: number;
  ltv: number;
  ltv_to_cac: number;
  payback_months: number;
}

export interface VerifiedMarketSizing {
  data_status: 'SOURCE_BACKED' | 'INSUFFICIENT_EVIDENCE';
  tam_current: number | null;
  tam_forecast: number | null;
  sam: number | null;
  som: number | null;
  cagr_pct: number | null;
  currency: string | null;
  year_start: number | null;
  year_end: number | null;
  source_claim_ids: string[];
  metric_claim_ids: {
    tam_current?: string;
    tam_forecast?: string;
    sam?: string;
    som?: string;
    cagr?: string;
  };
  limitations: string[];
}

type ParsedMoney = { value: number; currency: string; index: number };

function parseExplicitMoneyAmounts(statement: string): ParsedMoney[] {
  const suffixMultipliers: Record<string, number> = {
    trillion: 1e12, tn: 1e12, billion: 1e9, bn: 1e9, b: 1e9,
    million: 1e6, mn: 1e6, m: 1e6, thousand: 1e3, k: 1e3,
    crore: 1e7, cr: 1e7, lakh: 1e5, lac: 1e5,
  };
  const markerCurrencies: Record<string, string> = {
    USD: 'USD', INR: 'INR', EUR: 'EUR', GBP: 'GBP',
    '₹': 'INR', '€': 'EUR', '£': 'GBP',
  };
  const results: ParsedMoney[] = [];
  const patterns = [
    /(USD|INR|EUR|GBP|₹|€|£)\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*(trillion|billion|million|thousand|tn|bn|mn|crore|lakh|lac|cr|b|m|k)?/gi,
    /([0-9][0-9,]*(?:\.[0-9]+)?)\s*(trillion|billion|million|thousand|tn|bn|mn|crore|lakh|lac|cr|b|m|k)?\s*(USD|INR|EUR|GBP)\b/gi,
  ];
  for (const pattern of patterns) {
    for (const match of statement.matchAll(pattern)) {
      const prefixCurrency = match[1] && markerCurrencies[match[1].toUpperCase()];
      const suffixCurrency = match[3] && markerCurrencies[match[3].toUpperCase()];
      const rawNumber = match[prefixCurrency ? 2 : 1];
      const rawUnit = (match[prefixCurrency ? 3 : 2] || '').toLowerCase();
      const currency = prefixCurrency || suffixCurrency;
      if (!currency) continue; // "$" is deliberately not assumed to mean USD.
      const amount = Number(rawNumber.replace(/,/g, ''));
      if (!Number.isFinite(amount) || amount <= 0) continue;
      results.push({
        value: amount * (suffixMultipliers[rawUnit] || 1),
        currency,
        index: match.index ?? 0,
      });
    }
  }
  const unique = new Map<string, ParsedMoney>();
  for (const item of results) unique.set(item.currency + ':' + item.value + ':' + item.index, item);
  return Array.from(unique.values()).sort((a, b) => a.index - b.index);
}

function uniqueCandidate<T>(candidates: Array<{ value: T; claimId: string }>): { value: T; claimId: string } | null {
  const distinct = new Map<string, { value: T; claimId: string }>();
  for (const candidate of candidates) distinct.set(JSON.stringify(candidate.value), candidate);
  return distinct.size === 1 ? Array.from(distinct.values())[0] : null;
}

/**
 * Extract only explicitly stated monetary values and growth rates from claims
 * that already passed the evidence verifier. Ambiguous or currency-less values
 * remain unavailable rather than being guessed from geography or model output.
 */
export function extractVerifiedMarketSizing(claims: Claim[]): VerifiedMarketSizing {
  const supported = claims.filter(claim =>
    claim.verification_status === 'SUPPORTED' || claim.verification_status === 'CORROBORATED',
  );
  const tamBaseCandidates: Array<{ value: number; claimId: string }> = [];
  const tamForecastCandidates: Array<{ value: number; claimId: string }> = [];
  const tamBaseYearCandidates: Array<{ value: number; claimId: string }> = [];
  const tamForecastYearCandidates: Array<{ value: number; claimId: string }> = [];
  const samCandidates: Array<{ value: number; claimId: string }> = [];
  const somCandidates: Array<{ value: number; claimId: string }> = [];
  const cagrCandidates: Array<{ value: number; claimId: string }> = [];
  const cagrPeriodCandidates: Array<{
    value: { start_year: number; end_year: number };
    claimId: string;
  }> = [];
  const ambiguousTAMClaims: string[] = [];
  const currencies = new Set<string>();
  const sourceClaimIds = new Set<string>();

  for (const claim of supported.filter(item => item.claim_type === 'MARKET_SIZE')) {
    const statement = String(claim.statement || '');
    const amounts = parseExplicitMoneyAmounts(statement);
    if (amounts.length === 0) continue;

    const yearMatches = (statement.match(/\b20\d{2}\b/g) || []).map(Number);
    const isSam = /\bSAM\b|serviceable available market/i.test(statement);
    const isSom = /\bSOM\b|serviceable obtainable market/i.test(statement);
    const isTam = /\bTAM\b|total addressable market|market size/i.test(statement) ||
      (claim.claim_type === 'MARKET_SIZE' && !isSam && !isSom);

    if (isSam) {
      amounts.forEach(amount => currencies.add(amount.currency));
      if (amounts.length === 1) samCandidates.push({ value: amounts[0].value, claimId: claim.id });
      sourceClaimIds.add(claim.id);
      continue;
    }
    if (isSom) {
      amounts.forEach(amount => currencies.add(amount.currency));
      if (amounts.length === 1) somCandidates.push({ value: amounts[0].value, claimId: claim.id });
      sourceClaimIds.add(claim.id);
      continue;
    }
    if (!isTam) continue;

    amounts.forEach(amount => currencies.add(amount.currency));
    if (amounts.length >= 2) {
      const hasExplicitRange = yearMatches.length >= 2 || /\bfrom\b[\s\S]*\bto\b/i.test(statement);
      if (amounts.length !== 2 || !hasExplicitRange) {
        ambiguousTAMClaims.push(claim.id);
        continue;
      }
      tamBaseCandidates.push({ value: amounts[0].value, claimId: claim.id });
      tamForecastCandidates.push({ value: amounts[1].value, claimId: claim.id });
      if (yearMatches.length === 2) {
        tamBaseYearCandidates.push({ value: yearMatches[0], claimId: claim.id });
        tamForecastYearCandidates.push({ value: yearMatches[1], claimId: claim.id });
      }
      sourceClaimIds.add(claim.id);
    } else if (/\b(by|forecast|projected|reach|reaching)\b/i.test(statement)) {
      tamForecastCandidates.push({ value: amounts[0].value, claimId: claim.id });
      if (yearMatches.length === 1) {
        tamForecastYearCandidates.push({ value: yearMatches[0], claimId: claim.id });
      }
      sourceClaimIds.add(claim.id);
    } else {
      tamBaseCandidates.push({ value: amounts[0].value, claimId: claim.id });
      if (yearMatches.length === 1) {
        tamBaseYearCandidates.push({ value: yearMatches[0], claimId: claim.id });
      }
      sourceClaimIds.add(claim.id);
    }
  }

  for (const claim of supported.filter(item => item.claim_type === 'MARKET_GROWTH')) {
    const statement = String(claim.statement || '');
    if (!/\bCAGR\b|compound annual growth/i.test(statement)) continue;

    // Bind the numeric percentage to the CAGR phrase itself. A sentence may
    // contain unrelated growth, churn, or penetration percentages before it.
    const percentAfterCagr = statement.match(
      /\b(?:CAGR|compound annual growth(?: rate)?)\b[^.;]{0,60}?(\d+(?:\.\d+)?)\s*%/i,
    );
    const percentBeforeCagr = statement.match(
      /(\d+(?:\.\d+)?)\s*%\s*(?:annualized\s+)?(?:CAGR|compound annual growth(?: rate)?)\b/i,
    );
    const value = Number(percentAfterCagr?.[1] ?? percentBeforeCagr?.[1]);
    if (!Number.isFinite(value)) continue;
    if (!Number.isFinite(value) || value < 0 || value > 200) continue;

    cagrCandidates.push({ value, claimId: claim.id });
    sourceClaimIds.add(claim.id);

    // Only a stated period on this very CAGR claim may drive an extrapolation.
    // Years from unrelated claims (or incidental dates in prose) are never
    // combined into a synthetic forecast period.
    const range = statement.match(/\bfrom\s+(20\d{2})\s+to\s+(20\d{2})\b/i) ||
      statement.match(/\bbetween\s+(20\d{2})\s+and\s+(20\d{2})\b/i) ||
      statement.match(/\b(20\d{2})\s*(?:-|–|—)\s*(20\d{2})\b/);
    if (range) {
      const startYear = Number(range[1]);
      const endYear = Number(range[2]);
      if (endYear > startYear) {
        cagrPeriodCandidates.push({
          value: { start_year: startYear, end_year: endYear },
          claimId: claim.id,
        });
      }
    }
  }

  const tamBase = uniqueCandidate(tamBaseCandidates);
  const tamForecast = uniqueCandidate(tamForecastCandidates);
  // Keep year attribution tied to the exact claim selected for the amount.
  // Equal amounts in distinct years must not borrow one another's period.
  const tamBaseYear = tamBase
    ? tamBaseYearCandidates.find(candidate => candidate.claimId === tamBase.claimId) ?? null
    : null;
  const tamForecastYear = tamForecast
    ? tamForecastYearCandidates.find(candidate => candidate.claimId === tamForecast.claimId) ?? null
    : null;
  const sam = uniqueCandidate(samCandidates);
  const som = uniqueCandidate(somCandidates);
  const cagr = uniqueCandidate(cagrCandidates);
  const cagrPeriod = uniqueCandidate(cagrPeriodCandidates);
  const currency = currencies.size === 1 ? Array.from(currencies)[0] : null;

  const cagrPeriodMatchesBaseline = Boolean(
    tamBaseYear && cagr && cagrPeriod &&
    cagr.claimId === cagrPeriod.claimId &&
    cagrPeriod.value.start_year === tamBaseYear.value,
  );
  const yearStart = tamBaseYear?.value ?? null;
  const yearEnd = tamForecastYear?.value ??
    (cagrPeriodMatchesBaseline ? cagrPeriod!.value.end_year : null);

  let forecastValue = tamForecast?.value ?? null;
  let forecastClaimId = tamForecast?.claimId;
  if (
    forecastValue === null &&
    tamBase &&
    cagr &&
    cagrPeriodMatchesBaseline &&
    yearStart !== null &&
    yearEnd !== null &&
    yearEnd > yearStart
  ) {
    forecastValue = Math.round(tamBase.value * Math.pow(1 + cagr.value / 100, yearEnd - yearStart));
    forecastClaimId = cagr.claimId;
  }

  const currencyConsistent = currency !== null;
  const tamCurrentValue = currencyConsistent ? tamBase?.value ?? null : null;
  const tamForecastValue = currencyConsistent ? forecastValue : null;
  const samValue = currencyConsistent ? sam?.value ?? null : null;
  const somValue = currencyConsistent ? som?.value ?? null : null;
  const cagrValue = cagr?.value ?? null;
  const metricClaimIds: VerifiedMarketSizing['metric_claim_ids'] = {};
  if (tamCurrentValue !== null && tamBase) metricClaimIds.tam_current = tamBase.claimId;
  if (tamForecastValue !== null && forecastClaimId) metricClaimIds.tam_forecast = forecastClaimId;
  if (samValue !== null && sam) metricClaimIds.sam = sam.claimId;
  if (somValue !== null && som) metricClaimIds.som = som.claimId;
  if (cagrValue !== null && cagr) metricClaimIds.cagr = cagr.claimId;

  const limitations: string[] = [];
  if (!currencyConsistent) limitations.push('A single explicit currency could not be established from verified market-size claims.');
  if (tamCurrentValue === null) limitations.push('No unambiguous, currency-explicit verified TAM base value was found.');
  if (cagrValue === null) limitations.push('No verified CAGR claim with an explicit percentage was found.');
  if (tamForecastValue === null) limitations.push('Forecast TAM is unavailable without a verified forecast value or a period-aligned verified TAM, CAGR, and year range.');
  if (tamBase && cagr && !tamForecast && !cagrPeriodMatchesBaseline) {
    limitations.push('Forecast TAM was not extrapolated because the verified CAGR period could not be matched to the verified TAM baseline year.');
  }
  if (samValue === null) limitations.push('SAM is unavailable because no unambiguous, explicitly stated verified SAM value was found.');
  if (somValue === null) limitations.push('SOM is unavailable because no unambiguous, explicitly stated verified SOM value was found.');
  if (tamBaseCandidates.length > 1 && !tamBase) limitations.push('Multiple different verified TAM base values were found; no value was selected.');
  if (cagrCandidates.length > 1 && !cagr) limitations.push('Multiple different verified CAGR values were found; no value was selected.');
  if (ambiguousTAMClaims.length > 0) limitations.push('Some verified market-size claims contained multiple amounts without an unambiguous base-to-forecast relationship; they were excluded.');

  return {
    data_status: tamCurrentValue !== null || tamForecastValue !== null || cagrValue !== null || samValue !== null || somValue !== null
      ? 'SOURCE_BACKED'
      : 'INSUFFICIENT_EVIDENCE',
    tam_current: tamCurrentValue,
    tam_forecast: tamForecastValue,
    sam: samValue,
    som: somValue,
    cagr_pct: cagrValue,
    currency: currencyConsistent ? currency : null,
    year_start: yearStart,
    year_end: yearEnd,
    source_claim_ids: Array.from(sourceClaimIds),
    metric_claim_ids: metricClaimIds,
    limitations,
  };
}

export class FinancialEngine {
  /**
   * Deterministic Compound Annual Growth Rate (CAGR)
   * Formula: (Ending Value / Starting Value) ^ (1 / Years) - 1
   */
  public static calculateCAGR(startingValue: number, endingValue: number, years: number): number | null {
    if (
      !Number.isFinite(startingValue) || !Number.isFinite(endingValue) ||
      !Number.isFinite(years) || startingValue <= 0 || endingValue <= 0 || years <= 0
    ) {
      return null;
    }
    const cagr = Math.pow(endingValue / startingValue, 1 / years) - 1;
    if (!Number.isFinite(cagr)) return null;
    return Math.round(cagr * 10000) / 100;
  }

  /**
   * Top-Down & Bottom-Up Sizing Model
   */
  public static calculateMarketSizing(inputs: SizingInputs) {
    const years = Number.isFinite(inputs.year_start) && Number.isFinite(inputs.year_end) &&
      inputs.year_end > inputs.year_start ? inputs.year_end - inputs.year_start : 0;
    const tamBaseValid = Number.isFinite(inputs.tam_current) && inputs.tam_current > 0;
    const tamForecastValid = Number.isFinite(inputs.tam_forecast) && inputs.tam_forecast > 0;
    const cagr_pct = tamBaseValid && tamForecastValid && years > 0
      ? this.calculateCAGR(inputs.tam_current, inputs.tam_forecast, years)
      : null;

    const safeSamPct = Number.isFinite(inputs.sam_share_pct) ? Math.min(100, Math.max(0, inputs.sam_share_pct)) : 0;
    const safeSomPct = Number.isFinite(inputs.som_share_pct) ? Math.min(100, Math.max(0, inputs.som_share_pct)) : 0;

    const sam = tamBaseValid ? Math.round((inputs.tam_current * safeSamPct) / 100) : null;
    const som = sam === null ? null : Math.round((sam * safeSomPct) / 100);

    return {
      tam_current: inputs.tam_current,
      tam_forecast: inputs.tam_forecast,
      years,
      cagr_pct,
      sam,
      som,
      currency: inputs.currency || 'USD',
    };
  }

  /**
   * Bottom-up TAM builder: Target Customers * Annual Contract Value (ACV)
   */
  public static calculateBottomUpTAM(targetCustomerCount: number, acv: number, penetrationPct: number = 100) {
    const safeCustomerCount = Number.isFinite(targetCustomerCount) ? Math.max(0, targetCustomerCount) : 0;
    const safeAcv = Number.isFinite(acv) ? Math.max(0, acv) : 0;
    const safePenetration = Number.isFinite(penetrationPct) ? Math.min(100, Math.max(0, penetrationPct)) : 0;
    const rawTAM = safeCustomerCount * safeAcv;
    const serviceable = (rawTAM * safePenetration) / 100;
    return {
      customer_count: safeCustomerCount,
      acv: safeAcv,
      bottom_up_tam: rawTAM,
      serviceable_market: serviceable,
    };
  }

  /**
   * SaaS Unit Economics Engine
   */
  public static calculateUnitEconomics(inputs: UnitEconomicsInputs) {
    const grossMarginDecimal = Number.isFinite(inputs.gross_margin_pct)
      ? Math.min(1, Math.max(0, inputs.gross_margin_pct / 100))
      : 0;
    const churnDecimal = Number.isFinite(inputs.annual_churn_rate_pct)
      ? Math.min(1, Math.max(0, inputs.annual_churn_rate_pct / 100))
      : 0;
    const safeArpu = Number.isFinite(inputs.arpu_annual) ? Math.max(0, inputs.arpu_annual) : 0;
    const safeCac = Number.isFinite(inputs.cac) ? Math.max(0, inputs.cac) : 0;

    // Customer Lifetime Value: annual ARPU × gross margin ÷ annual churn.
    // Zero/unknown churn has no finite evidence-based LTV; do not invent a cap.
    const ltv = churnDecimal > 0
      ? Math.round((safeArpu * grossMarginDecimal) / churnDecimal)
      : null;

    // LTV:CAC is undefined when CAC is zero or LTV cannot be established.
    const ltv_to_cac = ltv !== null && safeCac > 0
      ? Math.round((ltv / safeCac) * 10) / 10
      : null;

    // CAC payback is measured after customer acquisition; sales-cycle duration
    // is kept separate and is not silently folded into the payback formula.
    const monthlyGrossProfit = (safeArpu * grossMarginDecimal) / 12;
    const payback_period_months = monthlyGrossProfit > 0
      ? Math.round((safeCac / monthlyGrossProfit) * 10) / 10
      : null;

    // NRR requires an observed expansion rate; churn alone is insufficient.
    const expansion = inputs.expansion_rate_pct;
    const netRevenueRetention = expansion !== undefined && Number.isFinite(expansion)
      ? Math.round((1 - churnDecimal + expansion / 100) * 100)
      : null;

    // Rule of 40 uses revenue growth + operating margin, never gross margin.
    const ruleOf40Score =
      inputs.revenue_growth_pct !== undefined &&
      inputs.operating_margin_pct !== undefined &&
      Number.isFinite(inputs.revenue_growth_pct) &&
      Number.isFinite(inputs.operating_margin_pct)
        ? Math.round((inputs.revenue_growth_pct + inputs.operating_margin_pct) * 10) / 10
        : null;

    return {
      ltv,
      cac: inputs.cac,
      ltv_to_cac,
      payback_period_months,
      annual_gross_profit_per_user: Math.round(safeArpu * grossMarginDecimal),
      sales_cycle_months: Number.isFinite(inputs.sales_cycle_months) ? Math.max(0, inputs.sales_cycle_months) : null,
      net_revenue_retention_pct: netRevenueRetention,
      rule_of_40_score: ruleOf40Score,
    };
  }

  /**
   * Multi-Variable Sensitivity Grid for Scenario Stress-Testing
   */
  public static generateSensitivityMatrix(baseArpu: number, baseCac: number, baseMargin: number): SensitivityMatrixCell[][] {
    const arpuMultipliers = [0.8, 1.0, 1.25];
    const churnRates = [0.05, 0.08, 0.14];

    const matrix: SensitivityMatrixCell[][] = [];

    for (const churn of churnRates) {
      const row: SensitivityMatrixCell[] = [];
      for (const arpuMult of arpuMultipliers) {
        const testArpu = Math.round(baseArpu * arpuMult);
        const econ = this.calculateUnitEconomics({
          arpu_annual: testArpu,
          gross_margin_pct: baseMargin,
          annual_churn_rate_pct: churn * 100,
          cac: baseCac,
          sales_cycle_months: 3,
        });
        row.push({
          arpu: testArpu,
          churn_pct: Math.round(churn * 100),
          ltv: econ.ltv,
          ltv_to_cac: econ.ltv_to_cac,
          payback_months: econ.payback_period_months,
        });
      }
      matrix.push(row);
    }

    return matrix;
  }

  /**
   * 3-Tier Financial Scenario Generator
   */
  public static generateScenarios(
    baseArpu: number,
    baseCac: number,
    baseMargin: number,
    currency: string = 'USD',
    baseCustomerCount: number = 0,
    baseSalesCycleMonths: number = 2.8,
  ) {
    // Conservative
    const consEcon = this.calculateUnitEconomics({
      arpu_annual: baseArpu * 0.85,
      gross_margin_pct: Math.max(30, baseMargin - 6),
      annual_churn_rate_pct: 14,
      cac: baseCac * 1.25,
      sales_cycle_months: Math.max(0, baseSalesCycleMonths * 1.6),
    });

    // Base
    const baseEcon = this.calculateUnitEconomics({
      arpu_annual: baseArpu,
      gross_margin_pct: baseMargin,
      annual_churn_rate_pct: 7.5,
      cac: baseCac,
      sales_cycle_months: Math.max(0, baseSalesCycleMonths),
    });

    // Aggressive
    const aggEcon = this.calculateUnitEconomics({
      arpu_annual: baseArpu * 1.3,
      gross_margin_pct: Math.min(92, baseMargin + 6),
      annual_churn_rate_pct: 4,
      cac: baseCac * 0.8,
      sales_cycle_months: Math.max(0, baseSalesCycleMonths * 0.6),
    });

    const sensitivityMatrix = this.generateSensitivityMatrix(baseArpu, baseCac, baseMargin);
    const safeCustomerCount = Number.isFinite(baseCustomerCount) ? Math.max(0, Math.round(baseCustomerCount)) : 0;
    const conservativeCustomers = Math.round(safeCustomerCount * 0.5);
    const aggressiveCustomers = Math.round(safeCustomerCount * 1.5);

    return {
      currency,
      scenario_conservative: {
        year_3_revenue: Math.round(baseArpu * 0.85 * conservativeCustomers),
        customer_count: conservativeCustomers,
        gross_margin_pct: Math.max(30, baseMargin - 6),
        break_even_month: consEcon.payback_period_months === null ? null : Math.round(consEcon.payback_period_months * 1.8),
        cac: consEcon.cac,
        ltv: consEcon.ltv,
        ltv_to_cac: consEcon.ltv_to_cac,
        payback_months: consEcon.payback_period_months,
      },
      scenario_base: {
        year_3_revenue: Math.round(baseArpu * safeCustomerCount),
        customer_count: safeCustomerCount,
        gross_margin_pct: baseMargin,
        break_even_month: baseEcon.payback_period_months === null ? null : Math.round(baseEcon.payback_period_months * 1.3),
        cac: baseEcon.cac,
        ltv: baseEcon.ltv,
        ltv_to_cac: baseEcon.ltv_to_cac,
        payback_months: baseEcon.payback_period_months,
      },
      scenario_aggressive: {
        year_3_revenue: Math.round(baseArpu * 1.3 * aggressiveCustomers),
        customer_count: aggressiveCustomers,
        gross_margin_pct: Math.min(92, baseMargin + 6),
        break_even_month: aggEcon.payback_period_months === null ? null : Math.round(aggEcon.payback_period_months * 0.9),
        cac: aggEcon.cac,
        ltv: aggEcon.ltv,
        ltv_to_cac: aggEcon.ltv_to_cac,
        payback_months: aggEcon.payback_period_months,
      },
      sensitivity_matrix: sensitivityMatrix,
    };
  }

  /**
   * Deterministic Currency Normalizer and Formatter
   */
  public static formatCurrency(amount: number | null | undefined, currency: string | null = 'USD'): string {
    if (amount === null || amount === undefined) return 'Not established';
    if (!Number.isFinite(amount)) return 'Not available';
    if (!currency) return amount.toLocaleString() + ' (currency not established)';
    const abs = Math.abs(amount);
    const sign = amount < 0 ? '-' : '';

    if (currency === 'INR') {
      if (abs >= 100_000_000) {
        return sign + '₹' + (abs / 100_000_000).toFixed(2) + ' Cr';
      }
      if (abs >= 100_000) {
        return sign + '₹' + (abs / 100_000).toFixed(2) + ' Lakh';
      }
      return sign + '₹' + abs.toLocaleString('en-IN');
    }

    const currencySymbols: Record<string, string> = {
      USD: '$',
      EUR: '€',
      GBP: '£',
    };
    const symbol = currencySymbols[currency];
    if (!symbol) {
      return sign + abs.toLocaleString('en-US') + ' ' + currency;
    }

    if (abs >= 1_000_000_000) {
      return sign + symbol + (abs / 1_000_000_000).toFixed(2) + 'B';
    }
    if (abs >= 1_000_000) {
      return sign + symbol + (abs / 1_000_000).toFixed(2) + 'M';
    }
    if (abs >= 1_000) {
      return sign + symbol + (abs / 1_000).toFixed(1) + 'K';
    }
    return sign + symbol + abs.toLocaleString('en-US');
  }
  }
}
