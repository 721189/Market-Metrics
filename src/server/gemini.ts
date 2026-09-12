/**
 * Google Gemini Provider via official @google/genai SDK
 * Blueprint Specifications:
 * - Section 9: Use Google Gemini through current Google GenAI SDK.
 * - Section 11-16: Model A (Planner), Model B (Source Analyzer), Model C (Claim Builder),
 *   Model D (Verification), Model E (Analyst), Model F (Report Writer).
 * - Grounded web search tools for genuine discovery (Section 48).
 */

import { GoogleGenAI, Type, Schema } from '@google/genai';
import type { Claim, Evidence, Source, VerificationStatus, ClaimType } from '../types.js';

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

export interface ExtractedFact {
  metric_name?: string;
  raw_value?: string;
  numeric_value?: number;
  unit?: string;
  currency?: string;
  period?: string;
  geography?: string;
  entity?: string;
  quote: string;
  section: string;
  confidence: number;
}

export interface ExtractedDocumentData {
  summary: string;
  relevance_score: number;
  facts: ExtractedFact[];
  key_entities: string[];
  observed_competitors: string[];
  pricing_signals: string[];
  regulatory_notes: string[];
}

export class GeminiResearchEngine {
  /**
   * Model A — Research Planner (Section 11)
   * Formulates research roadmap and search queries. Never answers the question directly.
   */
  public static async planResearch(
    question: string,
    industry: string,
    geography: string,
    timeHorizon: string,
    objectives: string[]
  ): Promise<PlannerOutput> {
    const ai = getGemini();
    if (!ai) {
      // Fallback structured planner if key is not yet set
      return {
        normalized_question: question,
        domain: industry || 'Technology & Infrastructure',
        geography: geography || 'Global',
        time_horizon: timeHorizon || '2026-2030',
        decision_objective: 'Market entry, sizing, competitive positioning, and financial viability',
        research_questions: [
          `What is the addressable market size (TAM/SAM/SOM) for ${industry} in ${geography}?`,
          `What is the verified historical and forecast CAGR for ${industry} in ${geography} across ${timeHorizon}?`,
          `Who are the dominant competitors, incumbents, and fast-growing challengers in ${geography}?`,
          `What are the typical pricing models, unit economics, and customer segments?`,
          `What regulatory frameworks, mandates, and policy subsidies impact entry in ${geography}?`,
        ],
        search_query_families: [
          `${industry} ${geography} market size report`,
          `${industry} ${geography} revenue CAGR forecast`,
          `${industry} ${geography} government policy regulation`,
          `${industry} ${geography} top software competitors pricing`,
          `${industry} ${geography} customer segments unit economics`,
        ],
        metrics_needed: ['TAM', 'SAM', 'SOM', 'CAGR', 'ARPU', 'CAC', 'Gross Margin', 'Market Share'],
        competitor_dimensions: ['Pricing Model', 'Market Position', 'Core Features', 'Target Customers'],
        target_source_tiers: ['Tier A (Government & Filings)', 'Tier B (Consultancies & Research)', 'Tier C (Trade News)'],
      };
    }

    const prompt = `You are Model A (Research Planner) in a rigorous market research engine.
Your task: Deconstruct the following user research request into a structured research plan.
IMPORTANT: Do NOT answer the questions yourself. Define ONLY what must be discovered, measured, and verified.

User Request:
- Question: "${question}"
- Industry: "${industry}"
- Geography: "${geography}"
- Time Horizon: "${timeHorizon}"
- Objectives: ${JSON.stringify(objectives)}

Return a strict JSON object with:
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
    } catch (err) {
      console.warn('Gemini planning fallback due to error:', err);
      return {
        normalized_question: question,
        domain: industry,
        geography,
        time_horizon: timeHorizon,
        decision_objective: 'Market viability analysis',
        research_questions: [`Market size and growth of ${industry} in ${geography}`],
        search_query_families: [`${industry} ${geography} market size forecast`],
        metrics_needed: ['TAM', 'CAGR'],
        competitor_dimensions: ['Market Share', 'Pricing'],
        target_source_tiers: ['Tier A', 'Tier B'],
      };
    }
  }

  /**
   * Search & Discovery using Google Search Grounding
   */
  public static async discoverLiveSources(queries: string[]): Promise<Array<{ title: string; url: string; snippet: string; publisher: string }>> {
    const ai = getGemini();
    if (!ai) {
      return [];
    }

    const discovered: Array<{ title: string; url: string; snippet: string; publisher: string }> = [];

    for (const query of queries.slice(0, 3)) {
      try {
        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: `Search for primary research, government reports, market estimates, and competitive intelligence on: "${query}". Provide a summary of the top verified external sources found.`,
          config: {
            tools: [{ googleSearch: {} }],
          },
        });

        // Extract metadata grounding chunks if available
        const metadata = response.candidates?.[0]?.groundingMetadata;
        if (metadata?.groundingChunks) {
          for (const chunk of metadata.groundingChunks) {
            if (chunk.web?.uri) {
              const uri = chunk.web.uri;
              const title = chunk.web.title || query;
              const domain = new URL(uri).hostname.replace('www.', '');
              discovered.push({
                title,
                url: uri,
                snippet: `Discovered via Search Grounding for "${query}"`,
                publisher: domain,
              });
            }
          }
        }
      } catch (e) {
        console.warn('Grounding search error for query:', query, e);
      }
    }

    return discovered;
  }
}
