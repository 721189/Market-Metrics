/**
 * Provider Cost Guard, Token Metering & Secrets Management
 * Features:
 * - Real-time LLM token usage tracking
 * - Hard cost budget ceilings & circuit breakers
 * - Safe masked secrets reporting
 */

export interface TokenUsageRecord {
  timestamp: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  estimatedCostUsd: number;
  operation: string;
}

export class CostGuardManager {
  private static records: TokenUsageRecord[] = [];
  private static hourlyTokenLimit = 200000;
  private static dailyCostLimitUsd = 10.0;
  private static isCircuitBroken = false;

  // Gemini Flash pricing approximate: $0.075 / 1M prompt, $0.30 / 1M output
  private static PRICE_PROMPT_PER_MILLION = 0.075;
  private static PRICE_COMPLETION_PER_MILLION = 0.30;

  public static recordUsage(params: {
    model: string;
    promptTokens: number;
    completionTokens: number;
    operation: string;
  }) {
    const cost =
      (params.promptTokens / 1_000_000) * this.PRICE_PROMPT_PER_MILLION +
      (params.completionTokens / 1_000_000) * this.PRICE_COMPLETION_PER_MILLION;

    const record: TokenUsageRecord = {
      timestamp: new Date().toISOString(),
      model: params.model,
      promptTokens: params.promptTokens,
      completionTokens: params.completionTokens,
      estimatedCostUsd: cost,
      operation: params.operation,
    };

    this.records.push(record);
    if (this.records.length > 1000) {
      this.records.shift();
    }

    // Check circuit breaker
    const totalCost24h = this.getTotalCostPastHours(24);
    if (totalCost24h >= this.dailyCostLimitUsd) {
      this.isCircuitBroken = true;
      console.warn(`[CostGuard] Daily cost limit exceeded: $${totalCost24h.toFixed(4)} >= $${this.dailyCostLimitUsd}`);
    }
  }

  public static canMakeLLMCall(): { allowed: boolean; reason?: string } {
    if (this.isCircuitBroken) {
      return { allowed: false, reason: 'Circuit breaker active: Daily provider budget limit reached.' };
    }

    const tokensPastHour = this.getTokensPastHours(1);
    if (tokensPastHour >= this.hourlyTokenLimit) {
      return { allowed: false, reason: `Hourly token quota of ${this.hourlyTokenLimit} tokens reached.` };
    }

    return { allowed: true };
  }

  public static getTokensPastHours(hours = 1): number {
    const cutoff = Date.now() - hours * 3600 * 1000;
    return this.records
      .filter(r => new Date(r.timestamp).getTime() >= cutoff)
      .reduce((sum, r) => sum + r.promptTokens + r.completionTokens, 0);
  }

  public static getTotalCostPastHours(hours = 24): number {
    const cutoff = Date.now() - hours * 3600 * 1000;
    return this.records
      .filter(r => new Date(r.timestamp).getTime() >= cutoff)
      .reduce((sum, r) => sum + r.estimatedCostUsd, 0);
  }

  public static getMetrics() {
    const totalTokens = this.records.reduce((sum, r) => sum + r.promptTokens + r.completionTokens, 0);
    const totalCost = this.records.reduce((sum, r) => sum + r.estimatedCostUsd, 0);
    return {
      total_operations: this.records.length,
      total_tokens_tracked: totalTokens,
      total_cost_usd: Number(totalCost.toFixed(5)),
      circuit_breaker_active: this.isCircuitBroken,
      hourly_token_limit: this.hourlyTokenLimit,
      daily_cost_limit_usd: this.dailyCostLimitUsd,
      tokens_past_hour: this.getTokensPastHours(1),
    };
  }

  /**
   * Safe Secrets Inspector (Never returns unmasked keys)
   */
  public static getMaskedSecrets(): Record<string, { configured: boolean; preview?: string; length?: number }> {
    const keys = ['GEMINI_API_KEY', 'DATABASE_URL', 'POSTGRES_URL', 'REDIS_URL', 'API_SECRET_KEY'];
    const result: Record<string, any> = {};

    for (const k of keys) {
      const val = process.env[k];
      if (!val) {
        result[k] = { configured: false };
      } else {
        const preview = val.length > 8 ? `${val.substring(0, 4)}...${val.substring(val.length - 4)}` : '****';
        result[k] = {
          configured: true,
          preview,
          length: val.length,
        };
      }
    }

    return result;
  }
}
