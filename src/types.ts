export type ClaimCategory =
  | 'PRICING'
  | 'API_VERSION'
  | 'REGULATION'
  | 'COMPANY_INFO';

export type FreshnessStatus = 'FRESH' | 'AGING' | 'STALE';

export type StageState = 'idle' | 'running' | 'complete' | 'error';

export type PrimaryModelId =
  | 'gemini-2.5-flash'
  | 'openai/gpt-4o-mini'
  | 'anthropic/claude-3-5-sonnet';

export type VerificationProvider = 'google-grounding' | 'tavily-hybrid';

export type PolicyMode = 'patch' | 'quarantine' | 'audit';

export type PolicyVerdict =
  | 'PASS'
  | 'HEALED'
  | 'QUARANTINED'
  | 'AUDIT_FLAGGED';

export interface GatewayConfig {
  bifrostEndpoint: string;
  primaryModel: PrimaryModelId;
  verificationProvider: VerificationProvider;
  autoHeal: boolean;
  demoMode: boolean;
  freshnessThreshold: number;
  policyMode: PolicyMode;
  bypassCache: boolean;
}

export interface ExtractedClaim {
  id: string;
  category: ClaimCategory;
  claimText: string;
  exactQuote: string;
  temporalSensitivity: 'high' | 'medium';
  reason: string;
}

export interface GroundingSource {
  title: string;
  url: string;
  domain: string;
}

export interface VerifiedClaim extends ExtractedClaim {
  freshnessScore: number;
  status: FreshnessStatus;
  verifiedFact: string;
  patchReplacement: string;
  sourceTitle: string;
  sourceUrl: string;
  explanation: string;
  patched: boolean;
}

export interface StageTelemetry {
  stage1: StageState;
  stage2: StageState;
  stage3: StageState;
  stage1Ms: number;
  stage2Ms: number;
  stage3Ms: number;
  routeUsed: string;
  cacheHit: boolean;
  groundingProvider: string;
}

export interface HealedPatchSpan {
  claimId: string;
  originalQuote: string;
  replacement: string;
  sourceTitle: string;
  sourceUrl: string;
  status: FreshnessStatus;
}

export interface AuditRunResult {
  runId: string;
  timestamp: string;
  prompt: string;
  model: PrimaryModelId;
  rawOutput: string;
  cutoffAssumptions: string[];
  extractedClaims: ExtractedClaim[];
  verifiedClaims: VerifiedClaim[];
  healedOutput: string;
  patches: HealedPatchSpan[];
  groundingSources: GroundingSource[];
  overallFreshnessScore: number;
  claimsAudited: number;
  stalePatched: number;
  estimatedSavingsUsd: number;
  totalLatencyMs: number;
  autoHealed: boolean;
  freshnessThreshold: number;
  policyVerdict: PolicyVerdict;
}

export interface BenchmarkModelResult {
  model: PrimaryModelId;
  assumedCutoff: string;
  freshnessScore: number;
  staleClaimsFound: number;
  latencyMs: number;
  sampleDrift: string;
  verdict: PolicyVerdict;
}

export interface BenchmarkResult {
  prompt: string;
  timestamp: string;
  groundingProvider: string;
  models: BenchmarkModelResult[];
  sources: GroundingSource[];
}

export interface PresetScenario {
  id: string;
  label: string;
  shortLabel: string;
  category: ClaimCategory;
  prompt: string;
}

export interface ChronoAppState {
  config: GatewayConfig;
  prompt: string;
  running: boolean;
  error: string | null;
  telemetry: StageTelemetry;
  currentResult: AuditRunResult | null;
  history: AuditRunResult[];
  benchmarkResult: BenchmarkResult | null;
  benchmarkRunning: boolean;
  cumulativeSavingsUsd: number;
  cumulativeRuns: number;
  cacheHits: number;
  categoryFilter: 'ALL' | ClaimCategory;
  expandedClaimIds: Set<string>;
  proxyDrawerOpen: boolean;
  proxyLang: 'python' | 'typescript' | 'curl';
  demoStudioOpen: boolean;
  guidedTourStep: number | null;
  spatialMode: boolean;
  serverCapabilities: {
    geminiReady: boolean;
    tavilyConfigured: boolean;
    defaultBifrostUrl: string;
  };
}
