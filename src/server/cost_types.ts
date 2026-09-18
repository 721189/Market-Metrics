/**
 * Shared cost-tracking types for the research agent cost governor.
 */

export interface RequestCost {
  input_tokens: number;
  output_tokens: number;
  search_calls: number;
  fetch_calls: number;
  documents_processed: number;
  estimated_cost_usd: number;
  actual_cost_usd: number;
  reset(): void;
}

export interface UserCost {
  input_tokens: number;
  output_tokens: number;
  search_calls: number;
  fetch_calls: number;
  documents_processed: number;
  estimated_cost_usd: number;
  actual_cost_usd: number;
}

export interface GlobalCost {
  input_tokens: number;
  output_tokens: number;
  search_calls: number;
  fetch_calls: number;
  documents_processed: number;
  estimated_cost_usd: number;
  actual_cost_usd: number;
}

export interface JobCost {
  input_tokens: number;
  output_tokens: number;
  search_calls: number;
  fetch_calls: number;
  documents_processed: number;
  estimated_cost_usd: number;
  actual_cost_usd: number;
}

export interface CostSnapshot {
  request: RequestCost;
  user: UserCost;
  global: GlobalCost;
  job: JobCost;
}

export function zeroCost(): RequestCost {
  return {
    input_tokens: 0,
    output_tokens: 0,
    search_calls: 0,
    fetch_calls: 0,
    documents_processed: 0,
    estimated_cost_usd: 0,
    actual_cost_usd: 0,
    reset() {
      this.input_tokens = 0;
      this.output_tokens = 0;
      this.search_calls = 0;
      this.fetch_calls = 0;
      this.documents_processed = 0;
      this.estimated_cost_usd = 0;
      this.actual_cost_usd = 0;
    },
  };
}
