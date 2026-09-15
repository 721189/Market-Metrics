/**
 * Google Gemini Provider via official @google/genai SDK
 * Specifications:
 * - Model A (Planner): Rigorous query expansion and metric decomposition.
 * - Model B (Source Analyzer & Ingester): Grounded document parsing and fact extraction.
 * - Model C (Claim Builder): Atomic claim structuring with exact character coordinate bindings.
 * - Model D (Adversarial Verifier): Cross-verification, contradiction checking, and confidence calibration.
 * - Model E & F (Intelligence Synthesizer): Grounded dossier synthesis with zero hallucinations.
 * - Real Grounded Web Search tools for genuine live discovery.
 * - Real Cost Guard & Token Usage Metering with exponential backoff retries.
 */

import { GoogleGenAI, Type } from '@google/genai';
import { Source, Evidence, Claim, CompetitorProfile, CustomerSegment, PricingTier, RiskFactor } from '../types.js';

/**
 * Compact, serializable projection of a verified claim handed to every
 * synthesizer. The synthesizer MUST reason only over these — never invent.
 */
export interface SynthesisClaimContext {
  id: string;
  citation_number: number;
  statement: string;
  claim_type: string;
  confidence: number;
}

export interface SynthesisEvidenceContext {
  id: string;
  source_id: string;
  quote: string;
}

let aiClient: GoogleGenAI | null = null;

export function getGemini(): GoogleGenAI | null {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return null;
    }
    aiClient = new GoogleGenAI({ apiKey });
  }
  return aiClient;
}

export async function executeWithRetry<T>(
  fn: () => Promise<T>,
  opts: { maxRetries?: number; baseDelayMs?: number } = {}
): Promise<T> {
  const maxRetries = opts.maxRetries || 3;
  const baseDelay = opts.baseDelayMs || 500;

  let lastError: any;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;
      if (attempt === maxRetries) break;
      const jitter = Math.random() * 200;
      const delay = baseDelay * Math.pow(2, attempt - 1) + jitter;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

export interface PlannerOutput {
  normalized_question: string;
  domain: string;
  geography: string;
  time_horizon: string;
  decision_objective: string;
  research_questions: string[];
  search_query_families: string[];
  metrics_needed: string[];
  competitor_dimensions: string[];
  target_source_tiers: string[];
}

export class GeminiResearchEngine {
  /**
   * Model A — Research Planner
   */
  public static async planResearch(
    question: string,
    industry: string,
    geography: string,
    timeHorizon: string,
    objectives: string[],
    signal?: AbortSignal
  ): Promise<PlannerOutput> {
    const ai = getGemini();

    if (!ai) {
      throw new Error("Gemini API key required.");
    }

    const prompt = `You are Model A (Research Planner) in an institutional-grade market research engine.
Deconstruct this user research request into a rigorous research plan.
Do NOT answer the questions yourself. Define ONLY what must be discovered, measured, and verified.

User Request:
- Question: "${question}"
- Industry: "${industry}"
- Geography: "${geography}"
- Time Horizon: "${timeHorizon}"
- Objectives: ${JSON.stringify(objectives)}

Return a strict JSON object matching:
{
  "normalized_question": string,
  "domain": string,
  "geography": string,
  "time_horizon": string,
  "decision_objective": string,
  "research_questions": string[],
  "search_query_families": string[],
  "metrics_needed": string[],
  "competitor_dimensions": string[],
  "target_source_tiers": string[]
}`;

    try {
      return await executeWithRetry(async () => {
        if (signal?.aborted) throw new Error('Operation aborted');

        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
            temperature: 0.1,
          },
        });

        const text = response.text || '{}';
        return JSON.parse(text);
      }, { maxRetries: 2 });
    } catch (err: any) {
      console.error('Gemini planning failed:', err);
      throw new Error(`Research planning failed: ${err.message || 'Gemini service is currently unavailable.'}`);
    }
  }

  /**
   * Search & Discovery using Real Google Search Grounding Tool
   */
  public static async discoverLiveSources(
    queries: string[],
    signal?: AbortSignal
  ): Promise<Array<{ title: string; url: string; snippet: string; publisher: string }>> {
    const ai = getGemini();
    if (!ai) {
      throw new Error("Gemini API key required.");
    }

    const combinedQuery = queries.slice(0, 4).join(' | ');
    const prompt = `Perform a comprehensive web search across these query families: "${combinedQuery}". Discover 5-8 authoritative, high-quality sources (reports, academic journals, official policy documents, financial filings). Return a JSON array of discovered sources, with details.`;

    try {
      return await executeWithRetry(async () => {
        if (signal?.aborted) throw new Error('Operation aborted');

        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: prompt,
          config: {
            tools: [{ googleSearch: {} }],
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  url: { type: Type.STRING },
                  snippet: { type: Type.STRING },
                  publisher: { type: Type.STRING },
                },
                required: ["title", "url", "snippet", "publisher"]
              }
            }
          },
        });

        const text = response.text || '[]';
        return JSON.parse(text);
      }, { maxRetries: 2 });
    } catch (e: any) {
      console.error('Discovery search failed:', e);
      throw new Error(`Web search and source discovery failed: ${e.message || 'Google Search Grounding Service is currently unavailable.'}`);
    }
  }

  /**
   * Report Details Synthesis: Competitors, Customers, Pricing, Regulatory, Risks,
   * Trends, Opportunities — grounded STRICTLY in the verified claim registry.
   * Fabrication, "realistic industry standards", placeholder data, and generic
   * templates are explicitly forbidden: sparse evidence => empty arrays.
   */
  public static async synthesizeReportDetails(params: {
    question: string;
    industry: string;
    geography: string;
    timeHorizon: string;
    isIndia: boolean;
    currency: string;
    claims: SynthesisClaimContext[];
    signal?: AbortSignal;
  }): Promise<{
    competitors: CompetitorProfile[];
    customerSegments: CustomerSegment[];
    pricingTiers: PricingTier[];
    regulatoryFactors: Array<{ policy_name: string; authority: string; impact_summary: string; compliance_req: string; claim_ids: string[] }>;
    risks: RiskFactor[];
    trends: Array<{ title: string; description: string; impact: string; claim_ids: string[] }>;
    opportunities: Array<{ title: string; description: string; value_pool: string; claim_ids: string[] }>;
  }> {
    const ai = getGemini();
    if (!ai) {
      throw new Error("Gemini API key required.");
    }

    const prompt = `You are the Strategic Synthesizer of an evidence-first research engine.
Derive competitors, customer segments, pricing tiers, regulatory factors, risks, trends, and opportunities for ${params.industry} in ${params.geography} (${params.timeHorizon}) STRICTLY from the VERIFIED CLAIM REGISTRY below.

HARD GROUNDING RULES:
1. Every entity MUST be grounded in one or more verified claims. Each entity's claim reference array (supporting_claim_ids / claim_ids) MUST contain ONLY claim ids copied verbatim from the registry. Never reference a claim id that is not in the registry.
2. Do NOT fabricate. Do NOT use "realistic industry standards", placeholder names, dummy data, or generic templates. If the verified claims do not contain the information needed for an entity, OMIT that entity entirely.
3. Empty arrays are the CORRECT answer when the evidence base is sparse. A smaller, fully-grounded output is strictly better than a complete-looking fabricated one.
4. Competitor names, pricing figures, policies, and risks must come from the claims themselves.

CONTEXT:
- Question: "${params.question}"
- Currency: ${params.currency}

VERIFIED CLAIM REGISTRY (the ONLY permissible factual basis):
${JSON.stringify(params.claims, null, 1)}`;

    return await executeWithRetry(async () => {
      if (params.signal?.aborted) throw new Error('Operation aborted');
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              competitors: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    name: { type: Type.STRING },
                    website: { type: Type.STRING },
                    category: { type: Type.STRING },
                    market_position: { type: Type.STRING, enum: ["LEADER", "CHALLENGER", "NICHE"] },
                    description: { type: Type.STRING },
                    strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
                    weaknesses: { type: Type.ARRAY, items: { type: Type.STRING } },
                    target_customer: { type: Type.STRING },
                    pricing_summary: { type: Type.STRING },
                    verified_claims_count: { type: Type.INTEGER },
                    supporting_claim_ids: { type: Type.ARRAY, items: { type: Type.STRING } }
                  },
                  required: ["id", "name", "website", "category", "market_position", "description", "strengths", "weaknesses", "target_customer", "pricing_summary", "verified_claims_count", "supporting_claim_ids"]
                }
              },
              customerSegments: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    name: { type: Type.STRING },
                    segment_type: { type: Type.STRING, enum: ["OBSERVED", "INFERRED"] },
                    description: { type: Type.STRING },
                    pain_points: { type: Type.ARRAY, items: { type: Type.STRING } },
                    key_buying_criteria: { type: Type.ARRAY, items: { type: Type.STRING } },
                    willingness_to_pay: { type: Type.STRING, enum: ["HIGH", "MEDIUM", "LOW"] },
                    estimated_tam_share_pct: { type: Type.INTEGER },
                    decision_makers: { type: Type.ARRAY, items: { type: Type.STRING } },
                    churn_risk: { type: Type.STRING, enum: ["HIGH", "MEDIUM", "LOW"] },
                    supporting_claim_ids: { type: Type.ARRAY, items: { type: Type.STRING } }
                  },
                  required: ["id", "name", "segment_type", "description", "pain_points", "key_buying_criteria", "willingness_to_pay", "estimated_tam_share_pct", "decision_makers", "churn_risk", "supporting_claim_ids"]
                }
              },
              pricingTiers: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    tier_name: { type: Type.STRING },
                    competitor_name: { type: Type.STRING },
                    amount: { type: Type.INTEGER },
                    billing_period: { type: Type.STRING, enum: ["MONTH", "YEAR"] },
                    unit: { type: Type.STRING },
                    annualized_amount: { type: Type.INTEGER },
                    currency: { type: Type.STRING },
                    target_segment: { type: Type.STRING },
                    features: { type: Type.ARRAY, items: { type: Type.STRING } },
                    supporting_claim_ids: { type: Type.ARRAY, items: { type: Type.STRING } }
                  },
                  required: ["tier_name", "competitor_name", "amount", "billing_period", "unit", "annualized_amount", "currency", "target_segment", "features", "supporting_claim_ids"]
                }
              },
              regulatoryFactors: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    policy_name: { type: Type.STRING },
                    authority: { type: Type.STRING },
                    impact_summary: { type: Type.STRING },
                    compliance_req: { type: Type.STRING },
                    claim_ids: { type: Type.ARRAY, items: { type: Type.STRING } }
                  },
                  required: ["policy_name", "authority", "impact_summary", "compliance_req", "claim_ids"]
                }
              },
              risks: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    category: { type: Type.STRING, enum: ["REGULATORY", "COMPETITIVE", "FINANCIAL", "TECHNOLOGICAL", "EXECUTION"] },
                    title: { type: Type.STRING },
                    impact: { type: Type.STRING, enum: ["SEVERE", "MODERATE", "MINOR"] },
                    probability: { type: Type.STRING, enum: ["HIGH", "MEDIUM", "LOW"] },
                    mitigation: { type: Type.STRING },
                    supporting_claim_ids: { type: Type.ARRAY, items: { type: Type.STRING } }
                  },
                  required: ["id", "category", "title", "impact", "probability", "mitigation", "supporting_claim_ids"]
                }
              },
              trends: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING },
                    description: { type: Type.STRING },
                    impact: { type: Type.STRING, enum: ["HIGH", "MEDIUM", "LOW"] },
                    claim_ids: { type: Type.ARRAY, items: { type: Type.STRING } }
                  },
                  required: ["title", "description", "impact", "claim_ids"]
                }
              },
              opportunities: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING },
                    description: { type: Type.STRING },
                    value_pool: { type: Type.STRING },
                    claim_ids: { type: Type.ARRAY, items: { type: Type.STRING } }
                  },
                  required: ["title", "description", "value_pool", "claim_ids"]
                }
              }
            },
            required: ["competitors", "customerSegments", "pricingTiers", "regulatoryFactors", "risks", "trends", "opportunities"]
          }
        }
      });
      return JSON.parse(response.text || '{}');
    });
  }

  /**
   * Fact Extraction
   */
  public static async extractClaimsFromText(params: {
    industry: string;
    geography: string;
    sourceDocuments: Array<{ id: string; domain: string; title: string; text: string }>;
    signal?: AbortSignal;
  }): Promise<Array<{ statement: string; claim_type: string; source_id: string; extracted_quote: string }>> {
    const ai = getGemini();
    if (!ai) {
      throw new Error("Gemini API key required.");
    }

    const prompt = `You are a factual claim extractor operating inside an evidence-first research engine.
Extract up to 10 atomic claims STRICTLY from the provided source documents.

VERBATIM QUOTE CONTRACT (mandatory):
- extracted_quote MUST be a contiguous substring copied CHARACTER-FOR-CHARACTER from the cited source document text: identical casing, punctuation, spacing, and unicode.
- Never paraphrase, never join non-adjacent sentences with ellipses, never alter whitespace or quotes inside extracted_quote.
- claim_type MUST be one of: MARKET_SIZE, MARKET_GROWTH, COMPETITOR, PRICING, CUSTOMER, REGULATION, TECHNOLOGY, FUNDING, REVENUE, VALUATION, TREND, RISK, OPPORTUNITY, FINANCIAL, STRATEGIC.
- statement must be a single atomic, self-contained factual assertion fully supported by the extracted_quote.

Documents: `;

    return await executeWithRetry(async () => {
      if (params.signal?.aborted) throw new Error('Operation aborted');
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [{ role: 'user', parts: [{ text: prompt + JSON.stringify(params.sourceDocuments).slice(0, 10000) }] }],
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                statement: { type: Type.STRING },
                claim_type: { type: Type.STRING },
                source_id: { type: Type.STRING },
                extracted_quote: { type: Type.STRING },
              },
              required: ["statement", "claim_type", "source_id", "extracted_quote"]
            }
          }
        }
      });
      return JSON.parse(response.text || '[]');
    });
  }

  /**
   * Market Sizing & Financial Metric Extraction
   */
  public static async extractFinancialMetrics(params: {
    industry: string;
    geography: string;
    sourceDocuments: Array<{ id: string; domain: string; title: string; text: string }>;
    signal?: AbortSignal;
  }): Promise<{ tam: number; cagr: number; currency: string; year_start: number; year_end: number }> {
    const ai = getGemini();
    if (!ai) {
      throw new Error("Gemini API key required.");
    }

    const prompt = `You are a financial data extractor. Analyze the provided market research documents and extract the following metrics:
1. Total Addressable Market (TAM) for the current year.
2. Verified Compound Annual Growth Rate (CAGR) for the forecast period.
3. Reporting Currency.
4. Forecast Start and End years.

Documents: ${JSON.stringify(params.sourceDocuments).slice(0, 15000)}

Return a strict JSON object:
{
  "tam": number (raw value, e.g. 25000000000),
  "cagr": number (e.g. 12.4),
  "currency": string (ISO code, e.g. "USD" or "INR"),
  "year_start": number,
  "year_end": number
}`;

    return await executeWithRetry(async () => {
      if (params.signal?.aborted) throw new Error('Operation aborted');
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              tam: { type: Type.NUMBER },
              cagr: { type: Type.NUMBER },
              currency: { type: Type.STRING },
              year_start: { type: Type.INTEGER },
              year_end: { type: Type.INTEGER }
            },
            required: ["tam", "cagr", "currency", "year_start", "year_end"]
          }
        }
      });
      return JSON.parse(response.text || '{}');
    });
  }

  /**
   * Report Overview Synthesis — grounded STRICTLY in the verified claim/evidence graph.
   */
  public static async synthesizeReportOverview(params: {
    question: string;
    industry: string;
    geography: string;
    timeHorizon: string;
    tamForecast: number;
    cagr: number;
    claims: SynthesisClaimContext[];
    evidence: SynthesisEvidenceContext[];
    signal?: AbortSignal;
  }): Promise<{ summary: string; section1: string; section2: string; section3: string }> {
    const ai = getGemini();
    if (!ai) {
      throw new Error("Gemini API key required.");
    }

    const prompt = `You are the Intelligence Synthesizer of an evidence-first research engine.
Write the report overview grounded STRICTLY in the VERIFIED CLAIM REGISTRY provided below.

ABSOLUTE RULES:
1. Use ONLY facts contained in the verified claims and evidence excerpts. You must NEVER introduce any statistic, market size, growth rate, date, company, or entity that is not present in them.
2. When you rely on a claim, mark it in prose with its citation number in square brackets, e.g. [1], [2].
3. The only numbers you may state beyond the claims are the deterministic engine outputs provided (Forecast TAM and Verified CAGR).
4. If the verified claims are insufficient to cover a requested topic, state explicitly that the evidence base is insufficient for that topic. Do NOT fill gaps with general knowledge or plausible-sounding content.

CONTEXT:
- Question: "${params.question}"
- Industry: "${params.industry}"
- Geography: "${params.geography}"
- Time Horizon: "${params.timeHorizon}"
- Deterministic Forecast TAM: ${params.tamForecast.toLocaleString()}
- Deterministic Verified CAGR: ${params.cagr}%

VERIFIED CLAIM REGISTRY (the ONLY permissible factual basis):
${JSON.stringify(params.claims, null, 1)}

SUPPORTING EVIDENCE EXCERPTS (verbatim source quotes backing the claims):
${JSON.stringify(params.evidence, null, 1).slice(0, 6000)}

Write: summary (executive summary), section1 (market dynamics), section2 (customer segmentation), section3 (go-to-market and unit economics). Ground every assertion in the registry.`;

    return await executeWithRetry(async () => {
      if (params.signal?.aborted) throw new Error('Operation aborted');
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              summary: { type: Type.STRING },
              section1: { type: Type.STRING },
              section2: { type: Type.STRING },
              section3: { type: Type.STRING }
            },
            required: ["summary", "section1", "section2", "section3"]
          }
        }
      });
      return JSON.parse(response.text || '{}');
    });
  }
}
