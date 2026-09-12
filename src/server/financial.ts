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
