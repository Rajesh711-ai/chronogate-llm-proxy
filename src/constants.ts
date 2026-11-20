import type {GatewayConfig, PresetScenario, PrimaryModelId} from './types.ts';

export const DEFAULT_GATEWAY_CONFIG: GatewayConfig = {
  bifrostEndpoint: 'http://localhost:8080/v1',
  primaryModel: 'gemini-2.5-flash',
  verificationProvider: 'google-grounding',
  autoHeal: true,
  demoMode: true,
  freshnessThreshold: 90,
  policyMode: 'patch',
  bypassCache: false,
};

export const PRIMARY_MODEL_OPTIONS: {
  id: PrimaryModelId;
  label: string;
  provider: string;
}[] = [
  {
    id: 'gemini-2.5-flash',
    label: 'gemini-2.5-flash',
    provider: 'Google',
  },
  {
    id: 'openai/gpt-4o-mini',
    label: 'openai/gpt-4o-mini',
    provider: 'OpenAI via Bifrost',
  },
  {
    id: 'anthropic/claude-3-5-sonnet',
    label: 'anthropic/claude-3-5-sonnet',
    provider: 'Anthropic via Bifrost',
  },
];

export const STALE_TRAP_PRESETS: PresetScenario[] = [
  {
    id: 'react-nextjs',
    label: 'Latest React & Next.js versions + breaking changes',
    shortLabel: 'React & Next.js Versions',
    category: 'API_VERSION',
    prompt:
      'What are the latest stable versions of React and Next.js right now, what are their biggest breaking changes, and is React 19 released yet?',
  },
  {
    id: 'llm-pricing',
    label: 'Current OpenAI & Anthropic API token pricing',
    shortLabel: 'OpenAI & Anthropic Pricing',
    category: 'PRICING',
    prompt:
      'Compare the current per-million input and output API token pricing for flagship OpenAI GPT models and Anthropic Claude models.',
  },
  {
    id: 'ai-regulations',
    label: 'Recent AI regulations & EU AI Act enforcement dates',
    shortLabel: 'EU AI Act Enforcement',
    category: 'REGULATION',
    prompt:
      'What is the current enforcement status of the EU AI Act, which prohibited AI practices and GPAI rules are already in force, and what penalties apply?',
  },
  {
    id: 'hardware-releases',
    label: 'Latest flagship smartphone & GPU releases',
    shortLabel: 'Flagship Phones & GPUs',
    category: 'COMPANY_INFO',
    prompt:
      'What are the latest flagship iPhone lineup and NVIDIA GeForce RTX consumer GPU series currently available, including key specs and launch prices?',
  },
];

export function getProxySnippets(endpoint: string, model: PrimaryModelId) {
  const cleanEndpoint = endpoint.trim() || 'http://localhost:8080/v1';

  return {
    python: `from openai import OpenAI

# Drop-in replacement: route any OpenAI-compatible agent through ChronoGate
client = OpenAI(
    base_url="${cleanEndpoint}",
    api_key="chronogate-gateway-token",
    default_headers={"X-ChronoGate-AutoHeal": "true"}
)

resp = client.chat.completions.create(
    model="${model}",
    messages=[{"role": "user", "content": "What is the latest stable Next.js version?"}]
)
print(resp.choices[0].message.content)  # Auto-verified & patched inline`,

    typescript: `import OpenAI from "openai";

// Zero-refactor drop-in gateway via Bifrost + ChronoGate middleware
const client = new OpenAI({
  baseURL: "${cleanEndpoint}",
  apiKey: process.env.CHRONOGATE_TOKEN ?? "chronogate-gateway-token",
  defaultHeaders: { "X-ChronoGate-AutoHeal": "true" },
});

const completion = await client.chat.completions.create({
  model: "${model}",
  messages: [{ role: "user", content: "Compare current Claude & GPT API pricing." }],
});
console.log(completion.choices[0].message.content);`,

    curl: `curl -X POST "${cleanEndpoint}/chat/completions" \\
  -H "Content-Type: application/json" \\
  -H "X-ChronoGate-AutoHeal: true" \\
  -H "X-ChronoGate-Grounding: google-search,tavily" \\
  -d '{
    "model": "${model}",
    "messages": [{"role": "user", "content": "EU AI Act current enforcement dates?"}]
  }'`,
  };
}

export function getScoreTier(score: number): 'FRESH' | 'AGING' | 'STALE' {
  if (score >= 90) return 'FRESH';
  if (score >= 50) return 'AGING';
  return 'STALE';
}
