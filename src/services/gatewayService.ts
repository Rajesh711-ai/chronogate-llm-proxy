import type {
  BenchmarkResult,
  ExtractedClaim,
  GatewayConfig,
  GroundingSource,
  HealedPatchSpan,
  PolicyVerdict,
  VerifiedClaim,
} from '../types.ts';

export interface HealthResponse {
  ok: boolean;
  geminiReady: boolean;
  tavilyConfigured: boolean;
  defaultBifrostUrl: string;
  cacheEntries: number;
}

export interface Stage1Response {
  rawOutput: string;
  cutoffAssumptions: string[];
  routeUsed: string;
  cacheHit: boolean;
  latencyMs: number;
  estimatedSavingsUsd: number;
}

export interface Stage2Response {
  claims: ExtractedClaim[];
  latencyMs: number;
}

export interface Stage3Response {
  verifiedClaims: VerifiedClaim[];
  healedOutput: string;
  patches: HealedPatchSpan[];
  groundingSources: GroundingSource[];
  overallFreshnessScore: number;
  claimsAudited: number;
  stalePatched: number;
  freshnessThreshold: number;
  policyVerdict: PolicyVerdict;
  groundingProvider: string;
  latencyMs: number;
}

async function postJson<T>(url: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body),
  });
  const payload = (await res.json().catch(() => ({}))) as {error?: string} & T;
  if (!res.ok) {
    throw new Error(payload.error || `Request failed with status ${res.status}`);
  }
  return payload;
}

export async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch('/api/health');
  if (!res.ok) {
    throw new Error('Gateway health check unavailable.');
  }
  return (await res.json()) as HealthResponse;
}

export async function runStage1Generate(
  prompt: string,
  config: GatewayConfig,
  bypassCache = config.bypassCache
): Promise<Stage1Response> {
  return postJson<Stage1Response>('/api/pipeline/stage1-generate', {
    prompt,
    model: config.primaryModel,
    bifrostEndpoint: config.bifrostEndpoint,
    demoMode: config.demoMode,
    bypassCache,
  });
}

export async function runStage2Extract(
  prompt: string,
  rawOutput: string
): Promise<Stage2Response> {
  return postJson<Stage2Response>('/api/pipeline/stage2-extract', {
    prompt,
    rawOutput,
  });
}

export async function runStage3Verify(
  prompt: string,
  rawOutput: string,
  claims: ExtractedClaim[],
  config: GatewayConfig
): Promise<Stage3Response> {
  return postJson<Stage3Response>('/api/pipeline/stage3-verify', {
    prompt,
    rawOutput,
    claims,
    autoHeal: config.autoHeal,
    verificationProvider: config.verificationProvider,
    freshnessThreshold: config.freshnessThreshold,
    policyMode: config.policyMode,
  });
}

export async function runDriftBenchmark(
  prompt: string,
  freshnessThreshold: number
): Promise<BenchmarkResult> {
  return postJson<BenchmarkResult>('/api/pipeline/benchmark', {
    prompt,
    freshnessThreshold,
  });
}
