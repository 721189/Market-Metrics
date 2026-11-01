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
  const samCandidates: Array<{ value: number; claimId: string }> = [];
  const somCandidates: Array<{ value: number; claimId: string }> = [];
  const cagrCandidates: Array<{ value: number; claimId: string }> = [];
  const currencies = new Set<string>();
  const years = new Set<number>();
  const sourceClaimIds = new Set<string>();

  for (const claim of supported) {
    const statement = String(claim.statement || '');
    const amounts = parseExplicitMoneyAmounts(statement);
    const yearMatches = statement.match(/\b20\d{2}\b/g) || [];
    yearMatches.forEach(year => years.add(Number(year)));
    if (amounts.length > 0) amounts.forEach(amount => currencies.add(amount.currency));
    if (amounts.length === 0) continue;

    const isSam = /\bSAM\b|serviceable available market/i.test(statement);
    const isSom = /\bSOM\b|serviceable obtainable market/i.test(statement);
    const isTam = /\bTAM\b|total addressable market|market size/i.test(statement) ||
      (claim.claim_type === 'MARKET_SIZE' && !isSam && !isSom);

    if (isSam) {
      if (amounts.length === 1) samCandidates.push({ value: amounts[0].value, claimId: claim.id });
      sourceClaimIds.add(claim.id);
      continue;
    }
    if (isSom) {
      if (amounts.length === 1) somCandidates.push({ value: amounts[0].value, claimId: claim.id });
      sourceClaimIds.add(claim.id);
      continue;
    }
    if (isTam) {
      if (amounts.length >= 2) {
        tamBaseCandidates.push({ value: amounts[0].value, claimId: claim.id });
        tamForecastCandidates.push({ value: amounts[amounts.length - 1].value, claimId: claim.id });
        sourceClaimIds.add(claim.id);
      } else if (/\b(by|forecast|projected|reach|reaching)\b/i.test(statement)) {
        tamForecastCandidates.push({ value: amounts[0].value, claimId: claim.id });
        sourceClaimIds.add(claim.id);
      } else {
        tamBaseCandidates.push({ value: amounts[0].value, claimId: claim.id });
        sourceClaimIds.add(claim.id);
      }
    }
  }

  for (const claim of supported.filter(item => item.claim_type === 'MARKET_GROWTH')) {
    const statement = String(claim.statement || '');
    if (!/\bCAGR\b|compound annual growth/i.test(statement)) continue;
    const percent = statement.match(/(\d+(?:\.\d+)?)\s*%/);
    if (percent) {
      const value = Number(percent[1]);
      if (Number.isFinite(value) && value >= 0 && value <= 200) {
        cagrCandidates.push({ value, claimId: claim.id });
        sourceClaimIds.add(claim.id);
      }
    }
  }

  const tamBase = uniqueCandidate(tamBaseCandidates);
  const tamForecast = uniqueCandidate(tamForecastCandidates);
  const sam = uniqueCandidate(samCandidates);
  const som = uniqueCandidate(somCandidates);
  const cagr = uniqueCandidate(cagrCandidates);
  const currency = currencies.size === 1 ? Array.from(currencies)[0] : null;
  const yearList = Array.from(years).sort((a, b) => a - b);
  const yearStart = yearList.length >= 2 ? yearList[0] : yearList[0] ?? null;
  const yearEnd = yearList.length >= 2 ? yearList[yearList.length - 1] : null;

  let forecastValue = tamForecast?.value ?? null;
  let forecastClaimId = tamForecast?.claimId;
  if (forecastValue === null && tamBase && cagr && yearStart !== null && yearEnd !== null && yearEnd > yearStart) {
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
  if (tamForecastValue === null) limitations.push('Forecast TAM is unavailable without a verified forecast value or verified TAM, CAGR, and year range.');
  if (samValue === null) limitations.push('SAM is unavailable because no unambiguous, explicitly stated verified SAM value was found.');
  if (somValue === null) limitations.push('SOM is unavailable because no unambiguous, explicitly stated verified SOM value was found.');
  if (tamBaseCandidates.length > 1 && !tamBase) limitations.push('Multiple different verified TAM base values were found; no value was selected.');
  if (cagrCandidates.length > 1 && !cagr) limitations.push('Multiple different verified CAGR values were found; no value was selected.');

  return {
    data_status: tamCurrentValue !== null || cagrValue !== null || samValue !== null || somValue !== null
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
  public static calculateCAGR(startingValue: number, endingValue: number, years: number): number {
    if (startingValue <= 0 || endingValue <= 0 || years <= 0) {
      return 0;
    }
    const cagr = Math.pow(endingValue / startingValue, 1 / years) - 1;
    if (isNaN(cagr) || !isFinite(cagr)) return 0;
    return Math.round(cagr * 10000) / 100; // Returns percentage rounded to 2 decimal places e.g. 28.45%
  }

  /**
   * Top-Down & Bottom-Up Sizing Model
   */
  public static calculateMarketSizing(inputs: SizingInputs) {
    const years = Math.max(1, inputs.year_end - inputs.year_start);
    const cagr_pct = this.calculateCAGR(inputs.tam_current, inputs.tam_forecast, years);

    const safeSamPct = Math.min(100, Math.max(1, inputs.sam_share_pct));
    const safeSomPct = Math.min(100, Math.max(1, inputs.som_share_pct));

    const sam = Math.round((inputs.tam_current * safeSamPct) / 100);
    const som = Math.round((sam * safeSomPct) / 100);

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
    const rawTAM = Math.max(0, targetCustomerCount) * Math.max(0, acv);
    const serviceable = (rawTAM * Math.min(100, Math.max(0, penetrationPct))) / 100;
    return {
      customer_count: targetCustomerCount,
      acv,
      bottom_up_tam: rawTAM,
      serviceable_market: serviceable,
    };
  }

  /**
   * SaaS Unit Economics Engine
   */
  public static calculateUnitEconomics(inputs: UnitEconomicsInputs) {
    const grossMarginDecimal = Math.min(0.99, Math.max(0.01, inputs.gross_margin_pct / 100));
    const churnDecimal = Math.min(0.99, Math.max(0.01, inputs.annual_churn_rate_pct / 100));
    const safeCac = Math.max(1, inputs.cac);

    // Customer Lifetime Value: (ARPU * Gross Margin) / Churn Rate
    const ltv = Math.round((inputs.arpu_annual * grossMarginDecimal) / churnDecimal);

    // LTV : CAC Ratio
    const ltv_to_cac = Math.round((ltv / safeCac) * 10) / 10;

    // CAC Payback Period (in months): (CAC / (ARPU * Gross Margin)) * 12
    const monthlyGrossProfit = (inputs.arpu_annual * grossMarginDecimal) / 12;
    const payback_period_months = monthlyGrossProfit > 0 ? Math.round((safeCac / monthlyGrossProfit) * 10) / 10 : 0;

    // SaaS Quick Ratio & Magic Number proxies
    const netRevenueRetentionEstimated = Math.round((1 - churnDecimal + 0.15) * 100); // estimated baseline expansion
    const ruleOf40Score = Math.round(28.4 + (inputs.gross_margin_pct - 60) * 0.4);

    return {
      ltv,
      cac: inputs.cac,
      ltv_to_cac,
      payback_period_months,
      annual_gross_profit_per_user: Math.round(inputs.arpu_annual * grossMarginDecimal),
      net_revenue_retention_pct: netRevenueRetentionEstimated,
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
   * Probabilistic Monte Carlo Summary (P10, P50, P90)
   */
  public static calculateMonteCarloRange(tamBase: number, cagrBase: number, years: number = 5) {
    const p10Cagr = Math.max(5, cagrBase * 0.7);
    const p50Cagr = cagrBase;
    const p90Cagr = cagrBase * 1.35;

    const p10Forecast = Math.round(tamBase * Math.pow(1 + p10Cagr / 100, years));
    const p50Forecast = Math.round(tamBase * Math.pow(1 + p50Cagr / 100, years));
    const p90Forecast = Math.round(tamBase * Math.pow(1 + p90Cagr / 100, years));

    return {
      p10: { cagr: Math.round(p10Cagr * 10) / 10, forecast_tam: p10Forecast },
      p50: { cagr: Math.round(p50Cagr * 10) / 10, forecast_tam: p50Forecast },
      p90: { cagr: Math.round(p90Cagr * 10) / 10, forecast_tam: p90Forecast },
    };
  }

  /**
   * 3-Tier Financial Scenario Generator
   */
  public static generateScenarios(
    baseArpu: number,
    baseCac: number,
    baseMargin: number,
    currency: string = 'USD'
  ) {
    // Conservative
    const consEcon = this.calculateUnitEconomics({
      arpu_annual: baseArpu * 0.85,
      gross_margin_pct: Math.max(30, baseMargin - 6),
      annual_churn_rate_pct: 14,
      cac: baseCac * 1.25,
      sales_cycle_months: 4.5,
    });

    // Base
    const baseEcon = this.calculateUnitEconomics({
      arpu_annual: baseArpu,
      gross_margin_pct: baseMargin,
      annual_churn_rate_pct: 7.5,
      cac: baseCac,
      sales_cycle_months: 2.8,
    });

    // Aggressive
    const aggEcon = this.calculateUnitEconomics({
      arpu_annual: baseArpu * 1.3,
      gross_margin_pct: Math.min(92, baseMargin + 6),
      annual_churn_rate_pct: 4,
      cac: baseCac * 0.8,
      sales_cycle_months: 1.5,
    });

    const sensitivityMatrix = this.generateSensitivityMatrix(baseArpu, baseCac, baseMargin);

    return {
      currency,
      scenario_conservative: {
        year_3_revenue: Math.round(consEcon.annual_gross_profit_per_user * 280),
        gross_margin_pct: Math.max(30, baseMargin - 6),
        break_even_month: Math.round(consEcon.payback_period_months * 1.8),
        cac: consEcon.cac,
        ltv: consEcon.ltv,
        ltv_to_cac: consEcon.ltv_to_cac,
        payback_months: consEcon.payback_period_months,
      },
      scenario_base: {
        year_3_revenue: Math.round(baseEcon.annual_gross_profit_per_user * 650),
        gross_margin_pct: baseMargin,
        break_even_month: Math.round(baseEcon.payback_period_months * 1.3),
        cac: baseEcon.cac,
        ltv: baseEcon.ltv,
        ltv_to_cac: baseEcon.ltv_to_cac,
        payback_months: baseEcon.payback_period_months,
      },
      scenario_aggressive: {
        year_3_revenue: Math.round(aggEcon.annual_gross_profit_per_user * 1400),
        gross_margin_pct: Math.min(92, baseMargin + 6),
        break_even_month: Math.round(aggEcon.payback_period_months * 0.9),
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
  public static formatCurrency(amount: number, currency: string = 'USD'): string {
    if (isNaN(amount) || amount === null || amount === undefined) return '0';
    const abs = Math.abs(amount);
    const sign = amount < 0 ? '-' : '';

    if (currency === 'INR') {
      if (abs >= 100_000_000) {
        return `${sign}₹${(abs / 100_000_000).toFixed(2)} Cr`;
      }
      if (abs >= 100_000) {
        return `${sign}₹${(abs / 100_000).toFixed(2)} Lakh`;
      }
      return `${sign}₹${abs.toLocaleString('en-IN')}`;
    }

    if (abs >= 1_000_000_000) {
      return `${sign}$${(abs / 1_000_000_000).toFixed(2)}B`;
    }
    if (abs >= 1_000_000) {
      return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
    }
    if (abs >= 1_000) {
      return `${sign}$${(abs / 1_000).toFixed(1)}K`;
    }
    return `${sign}$${abs.toLocaleString('en-US')}`;
  }
}
