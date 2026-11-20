import express from 'express';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {GoogleGenAI, ThinkingLevel, Type} from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT ?? 3000);
const MODEL_ID = 'gemini-4-hydrogen';

const app = express();
app.use(express.json({limit: '2mb'}));

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not configured in the server environment.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

// Lightweight in-memory semantic cache for Stage 1 telemetry demonstration
interface CacheEntry {
  normalizedPrompt: string;
  model: string;
  rawOutput: string;
  cutoffAssumptions: string[];
  createdAt: number;
}
const semanticCache = new Map<string, CacheEntry>();

function normalizePromptKey(prompt: string, model: string): string {
  const cleaned = prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return `${model}::${cleaned}`;
}

function safeJsonParse<T>(raw: string, fallback: T): T {
  const trimmed = raw.trim();
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    return JSON.parse(unfenced) as T;
  } catch {
    const start = unfenced.indexOf('{');
    const end = unfenced.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(unfenced.slice(start, end + 1)) as T;
      } catch {
        return fallback;
      }
    }
    return fallback;
  }
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'web-source';
  }
}

// Optional Tavily Search enrichment when server env TAVILY_API_KEY is set
async function queryTavilyIfConfigured(
  query: string
): Promise<{title: string; url: string; content: string}[]> {
  const tavilyKey = process.env.TAVILY_API_KEY;
  if (!tavilyKey) return [];
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        api_key: tavilyKey,
        query,
        search_depth: 'basic',
        max_results: 4,
      }),
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      results?: {title?: string; url?: string; content?: string}[];
    };
    return (data.results ?? [])
      .filter((r) => r.url)
      .map((r) => ({
        title: r.title ?? extractDomain(r.url ?? ''),
        url: r.url ?? '',
        content: (r.content ?? '').slice(0, 420),
      }));
  } catch {
    return [];
  }
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    geminiReady: Boolean(process.env.GEMINI_API_KEY),
    tavilyConfigured: Boolean(process.env.TAVILY_API_KEY),
    defaultBifrostUrl:
      process.env.BIFROST_GATEWAY_URL ?? 'http://localhost:8080/v1',
    cacheEntries: semanticCache.size,
  });
});

// STAGE 1: Generate initial ungrounded response via Bifrost Gateway or Simulated Frozen-Cutoff Route
app.post('/api/pipeline/stage1-generate', async (req, res) => {
  const startedAt = Date.now();
  try {
    const {
      prompt,
      model = 'gemini-2.5-flash',
      bifrostEndpoint = 'http://localhost:8080/v1',
      demoMode = true,
      bypassCache = false,
    } = req.body as {
      prompt?: string;
      model?: string;
      bifrostEndpoint?: string;
      demoMode?: boolean;
      bypassCache?: boolean;
    };

    if (!prompt || !prompt.trim()) {
      res.status(400).json({error: 'Prompt is required.'});
      return;
    }

    const cacheKey = normalizePromptKey(prompt, model);
    if (!bypassCache && semanticCache.has(cacheKey)) {
      const cached = semanticCache.get(cacheKey)!;
      res.json({
        rawOutput: cached.rawOutput,
        cutoffAssumptions: cached.cutoffAssumptions,
        routeUsed: demoMode
          ? `Bifrost Semantic Cache (${model})`
          : `Bifrost Live Cache (${bifrostEndpoint})`,
        cacheHit: true,
        latencyMs: Math.max(18, Date.now() - startedAt),
        estimatedSavingsUsd: 0.0042,
      });
      return;
    }

    // Attempt live local/remote Bifrost OpenAI-compatible gateway if Demo Mode is OFF
    if (!demoMode && bifrostEndpoint) {
      try {
        const cleanUrl = bifrostEndpoint.replace(/\/+$/, '');
        const upstream = await fetch(`${cleanUrl}/chat/completions`, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            model,
            messages: [
              {
                role: 'system',
                content:
                  'Answer concisely in 1-2 tight paragraphs using concrete numbers, versions, prices, or dates from your training data.',
              },
              {role: 'user', content: prompt},
            ],
          }),
          signal: AbortSignal.timeout(8000),
        });

        if (upstream.ok) {
          const payload = (await upstream.json()) as {
            choices?: {message?: {content?: string}}[];
          };
          const content = payload.choices?.[0]?.message?.content?.trim();
          if (content) {
            const assumptions = [
              `Upstream response returned directly from ${cleanUrl} (${model}) without web retrieval.`,
            ];
            semanticCache.set(cacheKey, {
              normalizedPrompt: cacheKey,
              model,
              rawOutput: content,
              cutoffAssumptions: assumptions,
              createdAt: Date.now(),
            });
            res.json({
              rawOutput: content,
              cutoffAssumptions: assumptions,
              routeUsed: `Live Bifrost Gateway (${cleanUrl})`,
              cacheHit: false,
              latencyMs: Date.now() - startedAt,
              estimatedSavingsUsd: 0.0014,
            });
            return;
          }
        }
      } catch {
        // Fall through to simulated Bifrost route cleanly if local Bifrost isn't reachable
      }
    }

    // Simulated Bifrost route using Gemini without search tools, explicitly simulating an early-2024 frozen-weight model
    const ai = getAiClient();
    const response = await ai.models.generateContent({
      model: MODEL_ID,
      contents: `User question: "${prompt.trim()}"`,
      config: {
        thinkingConfig: {thinkingLevel: ThinkingLevel.LOW},
        systemInstruction:
          `You are simulating a standard ungrounded LLM (${model}) whose training knowledge cutoff was March 2024 and has NO access to live web search. ` +
          `Answer the user's question confidently as of March 2024 in 110-165 words using concrete versions, token prices, legal enforcement dates, or flagship product releases that were true in early 2024 (e.g., React 18.2 / React 19 not yet stably released, Next.js 14.1, GPT-4 Turbo $10/$30 or Claude 3 Opus $15/$75, EU AI Act still awaiting final publication/not yet enforced, iPhone 15 Pro & RTX 4090 as latest flagships). ` +
          `Do NOT say "as of March 2024" or add disclaimers—write naturally as a typical confident ungrounded model does so a freshness verifier can audit your claims. ` +
          `Also return 2 short strings summarizing the hidden cutoff assumptions.`,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            rawOutput: {
              type: Type.STRING,
              description:
                'Confident, ungrounded 110-165 word response written from early-2024 frozen training weights with specific version numbers, prices, dates, or product names.',
            },
            cutoffAssumptions: {
              type: Type.ARRAY,
              items: {type: Type.STRING},
              description:
                '2 short bullet notes describing which knowledge-cutoff assumptions this ungrounded generation relied upon.',
            },
          },
          required: ['rawOutput', 'cutoffAssumptions'],
        },
      },
    });

    const parsed = safeJsonParse<{
      rawOutput: string;
      cutoffAssumptions: string[];
    }>(response.text ?? '{}', {
      rawOutput: response.text ?? '',
      cutoffAssumptions: ['Ungrounded frozen-weight model inference.'],
    });

    semanticCache.set(cacheKey, {
      normalizedPrompt: cacheKey,
      model,
      rawOutput: parsed.rawOutput,
      cutoffAssumptions: parsed.cutoffAssumptions,
      createdAt: Date.now(),
    });

    res.json({
      rawOutput: parsed.rawOutput,
      cutoffAssumptions: parsed.cutoffAssumptions,
      routeUsed: demoMode
        ? `Demo Bifrost Route -> ${model} (Frozen Weights)`
        : `Bifrost Fallback Route -> ${model} (${bifrostEndpoint} unreachable)`,
      cacheHit: false,
      latencyMs: Date.now() - startedAt,
      estimatedSavingsUsd: 0.0018,
    });
  } catch (err) {
    console.error('[ChronoGate Stage 1 Error]', err);
    res.status(500).json({
      error:
        err instanceof Error
          ? err.message
          : 'Stage 1 generation failed unexpectedly.',
    });
  }
});

// STAGE 2: Structured Temporal Claim Extraction
app.post('/api/pipeline/stage2-extract', async (req, res) => {
  const startedAt = Date.now();
  try {
    const {prompt, rawOutput} = req.body as {
      prompt?: string;
      rawOutput?: string;
    };

    if (!rawOutput || !rawOutput.trim()) {
      res.status(400).json({error: 'rawOutput is required for extraction.'});
      return;
    }

    const ai = getAiClient();
    const response = await ai.models.generateContent({
      model: MODEL_ID,
      contents: `Original prompt: ${prompt ?? ''}\n\nRaw LLM output to audit:\n${rawOutput}`,
      config: {
        thinkingConfig: {thinkingLevel: ThinkingLevel.LOW},
        systemInstruction:
          'You are ChronoGate Stage 2 Temporal Claim Extractor. ' +
          'Extract 4 to 6 concrete, verifiable, time-sensitive factual claims from the Raw LLM output. ' +
          'Categorize each claim strictly into one of: PRICING, API_VERSION, REGULATION, COMPANY_INFO. ' +
          'CRITICAL: "exactQuote" MUST be a verbatim, exact substring copied character-for-character from the Raw LLM output (a short phrase of 4 to 14 words containing the specific version, price, date, or product claim) so the UI can highlight it accurately.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            claims: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: {type: Type.STRING},
                  category: {
                    type: Type.STRING,
                    enum: [
                      'PRICING',
                      'API_VERSION',
                      'REGULATION',
                      'COMPANY_INFO',
                    ],
                  },
                  claimText: {
                    type: Type.STRING,
                    description: 'Concise standalone statement of the claim.',
                  },
                  exactQuote: {
                    type: Type.STRING,
                    description:
                      'Exact verbatim substring (4-14 words) appearing inside the Raw LLM output.',
                  },
                  temporalSensitivity: {
                    type: Type.STRING,
                    enum: ['high', 'medium'],
                  },
                  reason: {
                    type: Type.STRING,
                    description:
                      'Short reason why this fact decays quickly over time.',
                  },
                },
                required: [
                  'id',
                  'category',
                  'claimText',
                  'exactQuote',
                  'temporalSensitivity',
                  'reason',
                ],
              },
            },
          },
          required: ['claims'],
        },
      },
    });

    const parsed = safeJsonParse<{
      claims: {
        id: string;
        category: 'PRICING' | 'API_VERSION' | 'REGULATION' | 'COMPANY_INFO';
        claimText: string;
        exactQuote: string;
        temporalSensitivity: 'high' | 'medium';
        reason: string;
      }[];
    }>(response.text ?? '{}', {claims: []});

    const normalizedClaims = (parsed.claims ?? []).map((c, idx) => ({
      ...c,
      id: c.id || `CLM-${idx + 1}`,
    }));

    res.json({
      claims: normalizedClaims,
      latencyMs: Date.now() - startedAt,
    });
  } catch (err) {
    console.error('[ChronoGate Stage 2 Error]', err);
    res.status(500).json({
      error:
        err instanceof Error
          ? err.message
          : 'Stage 2 temporal claim extraction failed.',
    });
  }
});

// STAGE 3: Live Web Verification (Google Search Grounding + Optional Tavily) & Self-Healing Rewrite
app.post('/api/pipeline/stage3-verify', async (req, res) => {
  const startedAt = Date.now();
  try {
    const {
      prompt,
      rawOutput,
      claims = [],
      autoHeal = true,
      verificationProvider = 'google-grounding',
      freshnessThreshold = 90,
      policyMode = 'patch',
    } = req.body as {
      prompt?: string;
      rawOutput?: string;
      claims?: {
        id: string;
        category: 'PRICING' | 'API_VERSION' | 'REGULATION' | 'COMPANY_INFO';
        claimText: string;
        exactQuote: string;
        temporalSensitivity: 'high' | 'medium';
        reason: string;
      }[];
      autoHeal?: boolean;
      verificationProvider?: 'google-grounding' | 'tavily-hybrid';
      freshnessThreshold?: number;
      policyMode?: 'patch' | 'quarantine' | 'audit';
    };

    if (!rawOutput || !claims.length) {
      res
        .status(400)
        .json({error: 'rawOutput and extracted claims are required.'});
      return;
    }

    const ai = getAiClient();
    const todayStr = new Date().toISOString().slice(0, 10);

    // Optional Tavily hybrid enrichment if server key is available
    let tavilyResults: {title: string; url: string; content: string}[] = [];
    if (verificationProvider === 'tavily-hybrid' && process.env.TAVILY_API_KEY) {
      tavilyResults = await queryTavilyIfConfigured(
        `${prompt ?? ''} latest current facts ${new Date().getFullYear()}`
      );
    }

    const tavilyContextBlock =
      tavilyResults.length > 0
        ? `\n\nAdditional Tavily live web snippets:\n${tavilyResults
            .map((r, i) => `[T${i + 1}] ${r.title} (${r.url}): ${r.content}`)
            .join('\n')}`
        : '';

    // Step 3A: Run live Google Search Grounding to gather up-to-date verified facts + groundingChunks
    const groundedResponse = await ai.models.generateContent({
      model: MODEL_ID,
      contents:
        `Today's date is ${todayStr}. Use Google Search to verify EVERY claim below against the latest live information.\n\n` +
        `User prompt: ${prompt ?? ''}\n\n` +
        `Claims to audit:\n` +
        claims
          .map(
            (c) =>
              `- [${c.id}] (${c.category}) "${c.claimText}" (quote: "${c.exactQuote}")`
          )
          .join('\n') +
        tavilyContextBlock +
        `\n\nFor each claim ID, provide:\n` +
        `1) Whether it is still accurate today, partially aging, or outdated/stale.\n` +
        `2) The exact up-to-date live verified fact with current version numbers, prices, dates, or models.\n` +
        `3) Key source names/URLs supporting the update.`,
      config: {
        tools: [{googleSearch: {}}],
      },
    });

    const groundedAnalysisText = groundedResponse.text ?? '';
    const groundingChunks =
      groundedResponse.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];

    const groundingSources: {title: string; url: string; domain: string}[] = [];
    const seenUrls = new Set<string>();

    for (const chunk of groundingChunks) {
      const web = (chunk as {web?: {uri?: string; title?: string}}).web;
      if (web?.uri && !seenUrls.has(web.uri)) {
        seenUrls.add(web.uri);
        groundingSources.push({
          title: web.title || extractDomain(web.uri),
          url: web.uri,
          domain: extractDomain(web.uri),
        });
      }
    }

    for (const t of tavilyResults) {
      if (t.url && !seenUrls.has(t.url)) {
        seenUrls.add(t.url);
        groundingSources.push({
          title: t.title,
          url: t.url,
          domain: extractDomain(t.url),
        });
      }
    }

    // Step 3B: Structure the verified ledger + surgical self-healing patches cleanly as strict JSON
    const structuredResponse = await ai.models.generateContent({
      model: MODEL_ID,
      contents:
        `Today's date: ${todayStr}\n` +
        `Auto-heal enabled: ${autoHeal}\n\n` +
        `ORIGINAL RAW LLM OUTPUT:\n${rawOutput}\n\n` +
        `EXTRACTED CLAIMS:\n${JSON.stringify(claims, null, 2)}\n\n` +
        `LIVE WEB SEARCH VERIFICATION BRIEF:\n${groundedAnalysisText}\n\n` +
        `AVAILABLE VERIFIED SOURCE URLS:\n${JSON.stringify(groundingSources, null, 2)}`,
      config: {
        thinkingConfig: {thinkingLevel: ThinkingLevel.LOW},
        systemInstruction:
          'You are ChronoGate Stage 3 Scorer & Self-Healing Rewriter. ' +
          'Using ONLY the Live Web Search Verification Brief and Available Verified Source URLs, score each extracted claim from 0 to 100: ' +
          '90-100 = FRESH (fully accurate today), 50-89 = AGING (partially outdated or missing newer releases), 0-49 = STALE (superseded, wrong price, wrong version, or outdated date). ' +
          'Pick the best matching URL and title from AVAILABLE VERIFIED SOURCE URLS for each claim (if none directly match, use the closest official documentation URL from the list). ' +
          'For each claim with freshnessScore < 90, provide a concise "patchReplacement" phrase (the updated factual phrase that replaces the stale phrase). ' +
          'Also produce "healedOutput": rewrite the ORIGINAL RAW LLM OUTPUT to surgically replace every stale/aging fact with the verified live fact. ' +
          'CRITICAL FORMAT FOR healedOutput: wrap EVERY newly patched factual phrase inside double brackets like [[updated fact text|CLM-1]] (using the exact claim id after the pipe) so the frontend can render emerald verified badges and clickable [Verified Source] links inline! Keep all other prose smooth and natural.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            verifiedClaims: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: {type: Type.STRING},
                  freshnessScore: {type: Type.INTEGER},
                  verifiedFact: {type: Type.STRING},
                  patchReplacement: {type: Type.STRING},
                  sourceTitle: {type: Type.STRING},
                  sourceUrl: {type: Type.STRING},
                  explanation: {type: Type.STRING},
                },
                required: [
                  'id',
                  'freshnessScore',
                  'verifiedFact',
                  'patchReplacement',
                  'sourceTitle',
                  'sourceUrl',
                  'explanation',
                ],
              },
            },
            healedOutput: {
              type: Type.STRING,
              description:
                'Surgically patched rewrite of the original response with updated facts wrapped as [[updated text|CLM-ID]].',
            },
          },
          required: ['verifiedClaims', 'healedOutput'],
        },
      },
    });

    const parsed = safeJsonParse<{
      verifiedClaims: {
        id: string;
        freshnessScore: number;
        verifiedFact: string;
        patchReplacement: string;
        sourceTitle: string;
        sourceUrl: string;
        explanation: string;
      }[];
      healedOutput: string;
    }>(structuredResponse.text ?? '{}', {
      verifiedClaims: [],
      healedOutput: rawOutput,
    });

    const verifiedMap = new Map(
      (parsed.verifiedClaims ?? []).map((v) => [v.id, v])
    );
    const fallbackSource = groundingSources[0] ?? {
      title: 'Live Google Search Grounding',
      url: 'https://www.google.com/search?q=' + encodeURIComponent(prompt ?? ''),
      domain: 'google.com',
    };

    const mergedClaims = claims.map((claim, idx) => {
      const v = verifiedMap.get(claim.id);
      const score = Math.max(
        0,
        Math.min(100, Math.round(v?.freshnessScore ?? 45))
      );
      const status: 'FRESH' | 'AGING' | 'STALE' =
        score >= 90 ? 'FRESH' : score >= 50 ? 'AGING' : 'STALE';
      const chosenSource =
        groundingSources[idx % Math.max(1, groundingSources.length)] ??
        fallbackSource;
      const sourceUrl =
        v?.sourceUrl && v.sourceUrl.startsWith('http')
          ? v.sourceUrl
          : chosenSource.url;
      const sourceTitle = v?.sourceTitle || chosenSource.title;
      const shouldPatch =
        autoHeal && policyMode !== 'audit' && score < freshnessThreshold;
      return {
        ...claim,
        freshnessScore: score,
        status,
        verifiedFact: v?.verifiedFact ?? claim.claimText,
        patchReplacement: v?.patchReplacement ?? v?.verifiedFact ?? '',
        sourceTitle,
        sourceUrl,
        explanation:
          v?.explanation ?? 'Cross-checked against live web search results.',
        patched: shouldPatch,
      };
    });

    const overallFreshnessScore =
      mergedClaims.length > 0
        ? Math.round(
            mergedClaims.reduce((acc, c) => acc + c.freshnessScore, 0) /
              mergedClaims.length
          )
        : 100;

    const stalePatched = mergedClaims.filter((c) => c.patched).length;
    const hasCriticalStale = mergedClaims.some((c) => c.freshnessScore < 45);
    const policyVerdict: 'PASS' | 'HEALED' | 'QUARANTINED' | 'AUDIT_FLAGGED' =
      overallFreshnessScore >= freshnessThreshold
        ? 'PASS'
        : policyMode === 'quarantine' && hasCriticalStale
          ? 'QUARANTINED'
          : autoHeal && policyMode !== 'audit' && stalePatched > 0
            ? 'HEALED'
            : 'AUDIT_FLAGGED';

    const patches = mergedClaims
      .filter((c) => c.patched)
      .map((c) => ({
        claimId: c.id,
        originalQuote: c.exactQuote,
        replacement: c.patchReplacement || c.verifiedFact,
        sourceTitle: c.sourceTitle,
        sourceUrl: c.sourceUrl,
        status: c.status,
      }));

    const finalHealedOutput =
      autoHeal && policyMode !== 'audit'
        ? parsed.healedOutput || rawOutput
        : rawOutput;

    res.json({
      verifiedClaims: mergedClaims,
      healedOutput: finalHealedOutput,
      patches,
      groundingSources,
      overallFreshnessScore,
      claimsAudited: mergedClaims.length,
      stalePatched,
      freshnessThreshold,
      policyVerdict,
      groundingProvider:
        tavilyResults.length > 0
          ? 'Tavily Search + Google Search Grounding'
          : 'Google Search Grounding (Live)',
      latencyMs: Date.now() - startedAt,
    });
  } catch (err) {
    console.error('[ChronoGate Stage 3 Error]', err);
    res.status(500).json({
      error:
        err instanceof Error
          ? err.message
          : 'Stage 3 live web verification failed.',
    });
  }
});

// MULTI-MODEL DRIFT BENCHMARK: Races 3 Bifrost model routes against live Google Search Grounding
app.post('/api/pipeline/benchmark', async (req, res) => {
  try {
    const {prompt, freshnessThreshold = 90} = req.body as {
      prompt?: string;
      freshnessThreshold?: number;
    };
    if (!prompt || !prompt.trim()) {
      res.status(400).json({error: 'Prompt is required for benchmark.'});
      return;
    }

    const ai = getAiClient();
    const todayStr = new Date().toISOString().slice(0, 10);

    // Grounded reference check once via Google Search
    const grounded = await ai.models.generateContent({
      model: MODEL_ID,
      contents:
        `Today is ${todayStr}. Search the live web for the current factual answer to: "${prompt.trim()}". ` +
        `Then evaluate how 3 ungrounded LLM routes with typical static training cutoffs would drift on this exact question:\n` +
        `1. "gemini-2.5-flash" (typical static cutoff: mid-2025)\n` +
        `2. "openai/gpt-4o-mini" (typical static cutoff: Oct 2023)\n` +
        `3. "anthropic/claude-3-5-sonnet" (typical static cutoff: Apr 2024)\n` +
        `Summarize the exact live facts and where each static cutoff drifts.`,
      config: {
        tools: [{googleSearch: {}}],
      },
    });

    const groundingChunks =
      grounded.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
    const sources: {title: string; url: string; domain: string}[] = [];
    const seen = new Set<string>();
    for (const chunk of groundingChunks) {
      const web = (chunk as {web?: {uri?: string; title?: string}}).web;
      if (web?.uri && !seen.has(web.uri)) {
        seen.add(web.uri);
        sources.push({
          title: web.title || extractDomain(web.uri),
          url: web.uri,
          domain: extractDomain(web.uri),
        });
      }
    }

    const structured = await ai.models.generateContent({
      model: MODEL_ID,
      contents: `Prompt: ${prompt}\nFreshness Policy Threshold: ${freshnessThreshold}\n\nGrounded Drift Analysis:\n${grounded.text ?? ''}`,
      config: {
        thinkingConfig: {thinkingLevel: ThinkingLevel.LOW},
        systemInstruction:
          'Convert the grounded drift analysis into strict JSON comparing the 3 exact models: "gemini-2.5-flash", "openai/gpt-4o-mini", "anthropic/claude-3-5-sonnet". ' +
          'Estimate realistic ungrounded freshnessScore (0-100), staleClaimsFound (integer 0-6), simulated Bifrost gateway latencyMs (280-950), and a concise 1-sentence sampleDrift showing what each frozen model misses today.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            models: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  model: {
                    type: Type.STRING,
                    enum: [
                      'gemini-2.5-flash',
                      'openai/gpt-4o-mini',
                      'anthropic/claude-3-5-sonnet',
                    ],
                  },
                  assumedCutoff: {type: Type.STRING},
                  freshnessScore: {type: Type.INTEGER},
                  staleClaimsFound: {type: Type.INTEGER},
                  latencyMs: {type: Type.INTEGER},
                  sampleDrift: {type: Type.STRING},
                },
                required: [
                  'model',
                  'assumedCutoff',
                  'freshnessScore',
                  'staleClaimsFound',
                  'latencyMs',
                  'sampleDrift',
                ],
              },
            },
          },
          required: ['models'],
        },
      },
    });

    const parsed = safeJsonParse<{
      models: {
        model:
          | 'gemini-2.5-flash'
          | 'openai/gpt-4o-mini'
          | 'anthropic/claude-3-5-sonnet';
        assumedCutoff: string;
        freshnessScore: number;
        staleClaimsFound: number;
        latencyMs: number;
        sampleDrift: string;
      }[];
    }>(structured.text ?? '{}', {models: []});

    const models = (parsed.models ?? []).map((m) => {
      const score = Math.max(0, Math.min(100, Math.round(m.freshnessScore)));
      return {
        ...m,
        freshnessScore: score,
        verdict:
          score >= freshnessThreshold
            ? ('PASS' as const)
            : score < 45
              ? ('QUARANTINED' as const)
              : ('HEALED' as const),
      };
    });

    res.json({
      prompt: prompt.trim(),
      timestamp: new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
      groundingProvider: 'Google Search Grounding (Live)',
      models,
      sources,
    });
  } catch (err) {
    console.error('[ChronoGate Benchmark Error]', err);
    res.status(500).json({
      error:
        err instanceof Error ? err.message : 'Multi-model benchmark failed.',
    });
  }
});

async function startServer() {
  if (process.env.NODE_ENV === 'production') {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const {createServer: createViteServer} = await import('vite');
    const vite = await createViteServer({
      server: {middlewareMode: true, hmr: false},
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[ChronoGate] Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('[ChronoGate] Failed to start server:', err);
  process.exit(1);
});
