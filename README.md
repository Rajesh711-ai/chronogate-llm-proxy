# ChronoGate: Self-Healing Temporal Verification Proxy for LLMs

> **Stop LLMs from hallucinating yesterday's truth.**  
> A drop-in AI gateway proxy powered by **Bifrost** and **Tavily** that intercepts LLM responses, detects time-sensitive claims (pricing, API versions, regulations, company updates), verifies them against live web sources, scores freshness (`0–100`), and heals outdated facts in real time.

---

## The Problem
Large Language Models freeze at their training cutoff. In production developer and enterprise workflows, a single outdated SDK version, deprecated API endpoint, superseded pricing tier, or old executive title breaks code and erodes trust. Existing fact-checkers are slow, manual post-processing forms that sit outside the inference pipeline.

## Our Solution
**ChronoGate** operates as an inline verification and self-healing layer directly inside your LLM routing path:
1. **Multi-Provider Routing & Resilience (Bifrost):** Routes generation and fast extraction models through the Bifrost gateway with automatic provider fallbacks and semantic caching so repeated freshness audits execute with minimal latency and cost.
2. **Temporal Claim Atomization:** Extracts concrete, time-decaying entities across four high-volatility categories:
   - `PRICING` (API token rates, SaaS tiers)
   - `API_VERSION` (SDK releases, breaking changes, deprecations)
   - `REGULATION` (compliance deadlines, laws, policy updates)
   - `COMPANY_INFO` (leadership changes, acquisitions, product launches)
3. **Parallel Live Verification (Tavily):** Cross-checks every extracted claim concurrently against live web search results and authoritative documentation.
4. **Freshness Scoring & Auto-Healing:** Assigns a `0–100` Freshness Score per claim (`FRESH`, `AGING`, `STALE`) and surgically patches outdated segments with inline clickable citations before the final response reaches the user.

---

## Architecture

```text
User / Agent SDK (base_url -> ChronoGate / Bifrost)
       │
       ▼
┌───────────────────────────────────────────┐
│        1. Primary Generation              │
│   Routed via Bifrost Gateway (Fallbacks   │
│        & Semantic Cache Enabled)          │
└─────────────────────┬─────────────────────┘
                      │
                      ▼
┌───────────────────────────────────────────┐
│      2. Temporal Claim Extractor          │
│  Isolates Pricing, APIs, Laws & Entities  │
└─────────────────────┬─────────────────────┘
                      │
                      ▼
┌───────────────────────────────────────────┐
│     3. Concurrent Live Verification       │
│  Parallel Tavily Web Search & Extraction  │
└─────────────────────┬─────────────────────┘
                      │
                      ▼
┌───────────────────────────────────────────┐
│      4. Freshness Scorer & Healer         │
│  Computes 0–100 Score + Patches Stale     │
│      Claims with Inline Citations         │
└───────────────────────────────────────────┘
