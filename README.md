# Market Intelligence V2: Autonomous Market Research & Evidence Engine

> **Core Axioms:**
> 1. *"The LLM may reason over evidence, but it must never become the evidence."*
> 2. *"LLMs explain. Code calculates."*

---

## 1. Executive Summary & Market Problem

### The Problem with Generative AI in Market Research
Traditional Large Language Models (LLMs) hallucinate statistics, fabricate market sizes, confuse correlation with causation, and invent compound annual growth rates (CAGR). When decision-makers rely on raw conversational AI for due diligence, strategic planning, or investment memos, they risk acting on synthetic claims ungrounded in real-world filings or empirical market telemetry.

### The Solution: Evidence-First Intelligence Engine
**Market Intelligence V2** is an enterprise-grade, domain-agnostic market research platform built to eliminate hallucinations through **strict provenance enforcement**, **exact character-offset fact extraction**, and **deterministic mathematical calculations**. Every assertion in a generated report is backed by an interactive citation $[n]$ tied directly to audited source text, publisher credibility tiering, and an algorithmic 8-dimension Evidence Score.

---

## 2. Product Architecture & Philosophy

```
[ User Input / Research Target ]
               │
               ▼
┌──────────────────────────────────────────────────────────┐
│ STAGE 1: Orthogonal Query Planner (Model A)             │
│ - Decomposes target into 4-6 targeted search axes        │
└──────────────────────────────┬───────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────┐
│ STAGE 2 & 3: Source Discovery & Fetching (Tier 1-4)     │
│ - Live Web Grounding + Heuristic Directory Queries       │
│ - Tier 1: Regulatory / Government / Public Filings       │
│ - Tier 2: Institutional Research & Investment Banks      │
│ - Tier 3: Industry Trade & Verified Sector Publications  │
│ - Tier 4: General News & Vendor Whitepapers              │
└──────────────────────────────┬───────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────┐
│ STAGE 4: Raw Fact Extraction (Model B)                   │
│ - Exact character offsets [start_char, end_char]         │
│ - Numeric metric tagging (TAM, Volume, Pricing, Shares)  │
└──────────────────────────────┬───────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────┐
│ STAGE 5: Structured Claims Building (Model C)            │
│ - Normalizes raw facts into verifiable atomic statements │
└──────────────────────────────┬───────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────┐
│ STAGE 6: Adversarial Claim Verification (Model D)        │
│ - Source-to-claim contradiction detection                │
│ - 8-Dimension Evidence Scoring Engine (0-100)            │
└──────────────────────────────┬───────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────┐
│ STAGE 7: Deterministic Financial Engine (Code, Zero LLM) │
│ - Mathematical CAGR: (Ending/Starting)^(1/n) - 1         │
│ - Top-Down / Bottom-Up TAM, SAM, SOM                     │
│ - Unit Economics: LTV = (ARPU * Margin) / Churn          │
│ - CAC Payback, Sensitivity Matrices, Monte Carlo P10-P90 │
└──────────────────────────────┬───────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────┐
│ STAGE 8 & 9: Report Synthesis & Markdown Assembly        │
│ - Multi-section dossier with interactive citation pills  │
│ - CSV / JSON Export + Real-Time Financial Sandbox        │
└──────────────────────────────────────────────────────────┘
```

---

## 3. The 8-Dimension Evidence Scoring Algorithm

Unlike naive heuristic systems, Market Intelligence V2 computes an objective **Evidence Score (0–100)** for every report:

| Dimension | Weight | Description |
|---|---|---|
| **Source Authority (SQ)** | 20 pts | Weighted by publisher tier (Gov/Sec filings = 1.0, Consultancies = 0.85, Trade Press = 0.65). |
| **Evidence Relevance (ER)** | 20 pts | Semantic cosine & lexical alignment to the user's primary research target. |
| **Directness (DIR)** | 15 pts | Empirical primary data vs. secondary citation or commentary. |
| **Corroboration (COR)** | 15 pts | Cross-verification across independent publishers and datasets. |
| **Recency (REC)** | 10 pts | Publication freshness decay model (2025–2026 data weighted highest). |
| **Extraction Quality (EQ)** | 10 pts | Precision of character offsets and quote reproduction integrity. |
| **Internal Consistency (IC)**| 5 pts | Zero conflicting numeric values within the same section. |
| **Integrity Gate Check** | 5 pts | Adversarial check ensuring no ungrounded claims pass synthesis. |

---

## 4. Deterministic Financial & Analytical Modeling

Under Blueprint Rule 63 (*"LLMs explain. Code calculates"*), all mathematical modeling is isolated strictly to a deterministic TypeScript engine:

- **CAGR Calculation:**
  $$\text{CAGR} = \left( \frac{\text{Value}_{\text{end}}}{\text{Value}_{\text{start}}} \right)^{\frac{1}{\text{years}}} - 1$$
- **Unit Economics ($LTV$ & Payback):**
  $$\text{LTV} = \frac{\text{ARPU} \times \text{Gross Margin \%}}{\text{Annual Logo Churn \%}}$$
  $$\text{Payback (Months)} = \frac{\text{CAC}}{\frac{\text{ARPU} \times \text{Gross Margin \%}}{12}}$$
- **Sensitivity Matrices:**
  Multi-variable stress tests assessing $LTV:CAC$ and break-even intervals under fluctuating churn ($4\%\dots 14\%$) and $ARPU$ expansions.
- **Probabilistic Monte Carlo Intervals:**
  Computes $P_{10}$ (Conservative), $P_{50}$ (Base Target), and $P_{90}$ (Aggressive Expansion) forecast bands.

---

## 5. Technology Stack & Infrastructure

- **Frontend:** React 19, TypeScript, Tailwind CSS, Lucide Icons, Framer Motion.
- **Backend Server:** Node.js, Express, TSX, esbuild.
- **AI & Grounding SDK:** Google GenAI SDK (`@google/genai`), utilizing Gemini models for multi-step reasoning and search grounding.
- **Streaming Pipeline:** Server-Sent Events (SSE) with 15-second heartbeat keep-alive, client-disconnect cleanup, and bounded LRU in-memory stores.
- **Data Export:** Real-time RFC-4180 compliant CSV and structured JSON endpoints.

---

## 6. API Reference

### Health & Monitoring
- `GET /health` — Returns node uptime, memory consumption, and system health status.
- `GET /ready` — Verifies Gemini API connectivity and pipeline readiness.

### Research Lifecycle
- `POST /api/v1/research` — Initiates a new research pipeline.
  ```json
  {
    "question": "Assess B2B AI Code Review SaaS market landscape in North America by 2029",
    "industry": "Developer Tools & AI",
    "geography": "North America",
    "time_horizon": "2026-2029",
    "scope_depth": "deep"
  }
  ```
- `GET /api/v1/research/:id` — Polls job state, progress percentage ($0\dots 100$), and current active stage.
- `GET /api/v1/research/:id/events` — Live Server-Sent Events (SSE) stream for real-time telemetry.
- `POST /api/v1/research/:id/cancel` — Gracefully terminates an in-flight job.

### Data & Exports
- `GET /api/v1/research/:id/report` — Returns the full structured intelligence report.
- `GET /api/v1/research/:id/claims` — Returns all atomic claims, confidence ratings, and provenance linkages.
- `GET /api/v1/research/:id/sources` — Returns the source catalog and reliability scoring.
- `GET /api/v1/research/:id/export/json` — Downloads complete report JSON payload.
- `GET /api/v1/research/:id/export/csv` — Downloads tabular CSV of verified claims, evidence scores, and citations.

---

## 7. Honest Capabilities & Boundary Constraints

### What this platform excels at:
1. **Rigorous Evidence Grounding:** Eliminates synthetic assertions by requiring verified source citations for every critical data point.
2. **Domain Agnosticism:** Operates across SaaS, Robotics, FinTech, CleanTech, Healthcare, Industrial Automation, and Mobility.
3. **Deterministic Financial Defense:** Prevents arithmetic blunders in pitch decks, market sizing models, and due diligence memos.
4. **Auditability:** Every claim is inspectable down to the source URL, publisher tier, and exact text excerpt.

### Current Operating Boundaries:
1. **Paywalled Content:** Source extraction depends on publicly indexable or accessible web content; private corporate intranets or subscription-gated databases (e.g. Bloomberg Terminal, PitchBook) require manual ingestion or API connectors.
2. **Dynamic Volatility:** Fast-moving intra-day market data (e.g. public equity tick prices) should be cross-referenced with live exchange data feeds.
3. **Regulatory Variance:** Policy recommendations represent strategic analysis based on current legislation and do not constitute formal legal counsel.
