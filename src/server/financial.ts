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
    return Math.round(cagr * 10000) / 100; // Returns percentage rounded to 2 decimal places e.g. 28.45%
  }

  /**
   * Top-Down & Bottom-Up Sizing Model
   */
  public static calculateMarketSizing(inputs: SizingInputs) {
    const years = inputs.year_end - inputs.year_start;
    const cagr_pct = this.calculateCAGR(inputs.tam_current, inputs.tam_forecast, years);

    const sam = Math.round((inputs.tam_current * inputs.sam_share_pct) / 100);
    const som = Math.round((sam * inputs.som_share_pct) / 100);

    return {
      tam_current: inputs.tam_current,
      tam_forecast: inputs.tam_forecast,
      years,
      cagr_pct,
      sam,
      som,
      currency: inputs.currency,
    };
  }

  /**
   * Bottom-up TAM builder: Target Customers * Annual Contract Value (ACV)
   */
  public static calculateBottomUpTAM(targetCustomerCount: number, acv: number, penetrationPct: number = 100) {
    const rawTAM = targetCustomerCount * acv;
    const serviceable = (rawTAM * penetrationPct) / 100;
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
    const grossMarginDecimal = Math.max(0.01, inputs.gross_margin_pct / 100);
    const churnDecimal = Math.max(0.01, inputs.annual_churn_rate_pct / 100);

    // Customer Lifetime Value: (ARPU * Gross Margin) / Churn Rate
    const ltv = Math.round((inputs.arpu_annual * grossMarginDecimal) / churnDecimal);

    // LTV : CAC Ratio
    const ltv_to_cac = inputs.cac > 0 ? Math.round((ltv / inputs.cac) * 10) / 10 : 0;

    // CAC Payback Period (in months): (CAC / (ARPU * Gross Margin)) * 12
    const monthlyGrossProfit = (inputs.arpu_annual * grossMarginDecimal) / 12;
    const payback_period_months =
      monthlyGrossProfit > 0 ? Math.round((inputs.cac / monthlyGrossProfit) * 10) / 10 : 0;

    return {
      ltv,
      cac: inputs.cac,
      ltv_to_cac,
      payback_period_months,
      annual_gross_profit_per_user: Math.round(inputs.arpu_annual * grossMarginDecimal),
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
      gross_margin_pct: baseMargin - 5,
      annual_churn_rate_pct: 12,
      cac: baseCac * 1.25,
      sales_cycle_months: 4,
    });

    // Base
    const baseEcon = this.calculateUnitEconomics({
      arpu_annual: baseArpu,
      gross_margin_pct: baseMargin,
      annual_churn_rate_pct: 7,
      cac: baseCac,
      sales_cycle_months: 2.5,
    });

    // Aggressive
    const aggEcon = this.calculateUnitEconomics({
      arpu_annual: baseArpu * 1.3,
      gross_margin_pct: Math.min(92, baseMargin + 6),
      annual_churn_rate_pct: 4,
      cac: baseCac * 0.8,
      sales_cycle_months: 1.5,
    });

    return {
      currency,
      scenario_conservative: {
        year_3_revenue: Math.round(consEcon.annual_gross_profit_per_user * 280),
        gross_margin_pct: baseMargin - 5,
        break_even_month: Math.round(consEcon.payback_period_months * 1.8),
        cac: consEcon.cac,
        ltv: consEcon.ltv,
        ltv_to_cac: consEcon.ltv_to_cac,
      },
      scenario_base: {
        year_3_revenue: Math.round(baseEcon.annual_gross_profit_per_user * 650),
        gross_margin_pct: baseMargin,
        break_even_month: Math.round(baseEcon.payback_period_months * 1.3),
        cac: baseEcon.cac,
        ltv: baseEcon.ltv,
        ltv_to_cac: baseEcon.ltv_to_cac,
      },
      scenario_aggressive: {
        year_3_revenue: Math.round(aggEcon.annual_gross_profit_per_user * 1400),
        gross_margin_pct: Math.min(92, baseMargin + 6),
        break_even_month: Math.round(aggEcon.payback_period_months * 0.9),
        cac: aggEcon.cac,
        ltv: aggEcon.ltv,
        ltv_to_cac: aggEcon.ltv_to_cac,
      },
    };
  }

  /**
   * Deterministic Currency Normalizer and Formatter
   */
  public static formatCurrency(amount: number, currency: string = 'USD'): string {
    if (amount >= 1_000_000_000) {
      return `${currency === 'INR' ? '₹' : '$'}${(amount / 1_000_000_000).toFixed(2)}B`;
    }
    if (amount >= 1_000_000) {
      return `${currency === 'INR' ? '₹' : '$'}${(amount / 1_000_000).toFixed(2)}M`;
    }
    if (amount >= 1_000) {
      return `${currency === 'INR' ? '₹' : '$'}${(amount / 1_000).toFixed(1)}K`;
    }
    return `${currency === 'INR' ? '₹' : '$'}${amount.toLocaleString()}`;
  }
}
