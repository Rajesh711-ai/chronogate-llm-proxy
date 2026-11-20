import {DEFAULT_GATEWAY_CONFIG, STALE_TRAP_PRESETS} from '../constants.ts';
import {
  fetchHealth,
  runDriftBenchmark,
  runStage1Generate,
  runStage2Extract,
  runStage3Verify,
} from '../services/gatewayService.ts';
import type {
  AuditRunResult,
  ChronoAppState,
  ClaimCategory,
  GatewayConfig,
} from '../types.ts';

type Listener = (state: ChronoAppState) => void;

const HISTORY_STORAGE_KEY = 'chronogate_audit_history_v1';

function loadSavedHistory(): AuditRunResult[] {
  try {
    const raw = window.localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as AuditRunResult[];
    return Array.isArray(parsed) ? parsed.slice(0, 12) : [];
  } catch {
    return [];
  }
}

function saveHistory(history: AuditRunResult[]): void {
  try {
    window.localStorage.setItem(
      HISTORY_STORAGE_KEY,
      JSON.stringify(history.slice(0, 12))
    );
  } catch {
    // Storage quota or private browsing
  }
}

export class ChronoStore {
  private state: ChronoAppState;
  private listeners = new Set<Listener>();
  private activeRunToken = 0;

  constructor() {
    const savedHistory = loadSavedHistory();
    this.state = {
      config: {...DEFAULT_GATEWAY_CONFIG},
      prompt: STALE_TRAP_PRESETS[0].prompt,
      running: false,
      error: null,
      telemetry: {
        stage1: 'idle',
        stage2: 'idle',
        stage3: 'idle',
        stage1Ms: 0,
        stage2Ms: 0,
        stage3Ms: 0,
        routeUsed: 'Bifrost Ready',
        cacheHit: false,
        groundingProvider: 'Google Search Grounding',
      },
      currentResult: savedHistory[0] ?? null,
      history: savedHistory,
      benchmarkResult: null,
      benchmarkRunning: false,
      cumulativeSavingsUsd: Number(
        (
          0.0184 +
          savedHistory.reduce((acc, r) => acc + (r.estimatedSavingsUsd || 0), 0)
        ).toFixed(4)
      ),
      cumulativeRuns: savedHistory.length,
      cacheHits: 0,
      categoryFilter: 'ALL',
      expandedClaimIds: new Set<string>(),
      proxyDrawerOpen: false,
      proxyLang: 'python',
      demoStudioOpen: false,
      guidedTourStep: null,
      spatialMode: false,
      serverCapabilities: {
        geminiReady: true,
        tavilyConfigured: false,
        defaultBifrostUrl: DEFAULT_GATEWAY_CONFIG.bifrostEndpoint,
      },
    };
  }

  getState(): ChronoAppState {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  async checkServerHealth(): Promise<void> {
    try {
      const health = await fetchHealth();
      this.state = {
        ...this.state,
        serverCapabilities: {
          geminiReady: health.geminiReady,
          tavilyConfigured: health.tavilyConfigured,
          defaultBifrostUrl: health.defaultBifrostUrl,
        },
      };
      this.emit();
    } catch {
      // Non-fatal on initial boot
    }
  }

  updateConfig(partial: Partial<GatewayConfig>): void {
    this.state = {
      ...this.state,
      config: {...this.state.config, ...partial},
    };
    this.emit();
  }

  setPrompt(prompt: string): void {
    this.state = {...this.state, prompt};
    this.emit();
  }

  setCategoryFilter(categoryFilter: 'ALL' | ClaimCategory): void {
    this.state = {...this.state, categoryFilter};
    this.emit();
  }

  toggleClaimExpanded(claimId: string): void {
    const next = new Set(this.state.expandedClaimIds);
    if (next.has(claimId)) {
      next.delete(claimId);
    } else {
      next.add(claimId);
    }
    this.state = {...this.state, expandedClaimIds: next};
    this.emit();
  }

  expandAllClaims(): void {
    const claims = this.state.currentResult?.verifiedClaims ?? [];
    this.state = {
      ...this.state,
      expandedClaimIds: new Set(claims.map((c) => c.id)),
    };
    this.emit();
  }

  collapseAllClaims(): void {
    this.state = {...this.state, expandedClaimIds: new Set<string>()};
    this.emit();
  }

  setProxyDrawerOpen(open: boolean): void {
    this.state = {...this.state, proxyDrawerOpen: open};
    this.emit();
  }

  setProxyLang(lang: 'python' | 'typescript' | 'curl'): void {
    this.state = {...this.state, proxyLang: lang};
    this.emit();
  }

  setDemoStudioOpen(open: boolean): void {
    this.state = {...this.state, demoStudioOpen: open};
    this.emit();
  }

  setGuidedTourStep(step: number | null): void {
    this.state = {...this.state, guidedTourStep: step};
    this.emit();
  }

  setSpatialMode(spatialMode: boolean): void {
    this.state = {...this.state, spatialMode};
    this.emit();
  }

  selectHistoryRun(runId: string): void {
    const found = this.state.history.find((h) => h.runId === runId);
    if (!found) return;
    const firstStale = found.verifiedClaims.find((c) => c.status === 'STALE');
    const expanded = new Set<string>();
    if (firstStale) expanded.add(firstStale.id);

    this.state = {
      ...this.state,
      prompt: found.prompt,
      currentResult: found,
      expandedClaimIds: expanded,
      categoryFilter: 'ALL',
      telemetry: {
        stage1: 'complete',
        stage2: 'complete',
        stage3: 'complete',
        stage1Ms: Math.round(found.totalLatencyMs * 0.28),
        stage2Ms: Math.round(found.totalLatencyMs * 0.24),
        stage3Ms: Math.round(found.totalLatencyMs * 0.48),
        routeUsed: `Historical Audit (${found.model})`,
        cacheHit: false,
        groundingProvider: 'Google Search Grounding (Archived)',
      },
    };
    this.emit();
  }

  clearHistory(): void {
    saveHistory([]);
    this.state = {...this.state, history: []};
    this.emit();
  }

  async runPreset(presetId: string): Promise<void> {
    const preset = STALE_TRAP_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    this.setPrompt(preset.prompt);
    await this.runVerificationPipeline(preset.prompt);
  }

  async runMultiModelBenchmark(): Promise<void> {
    const activePrompt = this.state.prompt.trim();
    if (!activePrompt || this.state.benchmarkRunning) return;

    this.state = {...this.state, benchmarkRunning: true, error: null};
    this.emit();

    try {
      const benchmarkResult = await runDriftBenchmark(
        activePrompt,
        this.state.config.freshnessThreshold
      );
      this.state = {
        ...this.state,
        benchmarkRunning: false,
        benchmarkResult,
      };
      this.emit();
    } catch (err) {
      this.state = {
        ...this.state,
        benchmarkRunning: false,
        error:
          err instanceof Error
            ? err.message
            : 'Multi-model drift benchmark failed.',
      };
      this.emit();
    }
  }

  async runVerificationPipeline(customPrompt?: string): Promise<AuditRunResult | null> {
    const activePrompt = (customPrompt ?? this.state.prompt).trim();
    if (!activePrompt) return null;

    const runToken = ++this.activeRunToken;
    const configSnapshot: GatewayConfig = {...this.state.config};

    this.state = {
      ...this.state,
      prompt: activePrompt,
      running: true,
      error: null,
      categoryFilter: 'ALL',
      expandedClaimIds: new Set<string>(),
      telemetry: {
        stage1: 'running',
        stage2: 'idle',
        stage3: 'idle',
        stage1Ms: 0,
        stage2Ms: 0,
        stage3Ms: 0,
        routeUsed: configSnapshot.demoMode
          ? `Demo Bifrost -> ${configSnapshot.primaryModel}`
          : `Bifrost (${configSnapshot.bifrostEndpoint})`,
        cacheHit: false,
        groundingProvider:
          configSnapshot.verificationProvider === 'tavily-hybrid'
            ? 'Tavily + Google Search Grounding'
            : 'Google Search Grounding',
      },
      currentResult: null,
    };
    this.emit();

    try {
      // STAGE 1: Generate via Bifrost Route
      const s1 = await runStage1Generate(
        activePrompt,
        configSnapshot,
        configSnapshot.bypassCache
      );
      if (runToken !== this.activeRunToken) return null;

      const partialAfterS1: AuditRunResult = {
        runId: `CG-${Date.now().toString(36).toUpperCase()}`,
        timestamp: new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }),
        prompt: activePrompt,
        model: configSnapshot.primaryModel,
        rawOutput: s1.rawOutput,
        cutoffAssumptions: s1.cutoffAssumptions,
        extractedClaims: [],
        verifiedClaims: [],
        healedOutput: '',
        patches: [],
        groundingSources: [],
        overallFreshnessScore: 0,
        claimsAudited: 0,
        stalePatched: 0,
        estimatedSavingsUsd: s1.estimatedSavingsUsd,
        totalLatencyMs: s1.latencyMs,
        autoHealed: configSnapshot.autoHeal,
        freshnessThreshold: configSnapshot.freshnessThreshold,
        policyVerdict: 'AUDIT_FLAGGED',
      };

      this.state = {
        ...this.state,
        currentResult: partialAfterS1,
        telemetry: {
          ...this.state.telemetry,
          stage1: 'complete',
          stage2: 'running',
          stage1Ms: s1.latencyMs,
          routeUsed: s1.routeUsed,
          cacheHit: s1.cacheHit,
        },
      };
      this.emit();

      // STAGE 2: Temporal Claim Extraction
      const s2 = await runStage2Extract(activePrompt, s1.rawOutput);
      if (runToken !== this.activeRunToken) return null;

      this.state = {
        ...this.state,
        currentResult: {
          ...partialAfterS1,
          extractedClaims: s2.claims,
          claimsAudited: s2.claims.length,
          totalLatencyMs: s1.latencyMs + s2.latencyMs,
        },
        telemetry: {
          ...this.state.telemetry,
          stage2: 'complete',
          stage3: 'running',
          stage2Ms: s2.latencyMs,
        },
      };
      this.emit();

      // STAGE 3: Live Web Verification & Self-Healing
      const s3 = await runStage3Verify(
        activePrompt,
        s1.rawOutput,
        s2.claims,
        configSnapshot
      );
      if (runToken !== this.activeRunToken) return null;

      const finalResult: AuditRunResult = {
        ...partialAfterS1,
        extractedClaims: s2.claims,
        verifiedClaims: s3.verifiedClaims,
        healedOutput: s3.healedOutput,
        patches: s3.patches,
        groundingSources: s3.groundingSources,
        overallFreshnessScore: s3.overallFreshnessScore,
        claimsAudited: s3.claimsAudited,
        stalePatched: s3.stalePatched,
        estimatedSavingsUsd: s1.estimatedSavingsUsd,
        totalLatencyMs: s1.latencyMs + s2.latencyMs + s3.latencyMs,
        autoHealed: configSnapshot.autoHeal && configSnapshot.policyMode !== 'audit',
        freshnessThreshold: s3.freshnessThreshold ?? configSnapshot.freshnessThreshold,
        policyVerdict: s3.policyVerdict ?? 'HEALED',
      };

      const firstStale = s3.verifiedClaims.find((c) => c.status === 'STALE');
      const initialExpanded = new Set<string>();
      if (firstStale) {
        initialExpanded.add(firstStale.id);
      } else if (s3.verifiedClaims[0]) {
        initialExpanded.add(s3.verifiedClaims[0].id);
      }

      const nextHistory = [finalResult, ...this.state.history].slice(0, 12);
      saveHistory(nextHistory);

      this.state = {
        ...this.state,
        running: false,
        currentResult: finalResult,
        history: nextHistory,
        cumulativeSavingsUsd: Number(
          (this.state.cumulativeSavingsUsd + s1.estimatedSavingsUsd).toFixed(4)
        ),
        cumulativeRuns: this.state.cumulativeRuns + 1,
        cacheHits: this.state.cacheHits + (s1.cacheHit ? 1 : 0),
        expandedClaimIds: initialExpanded,
        telemetry: {
          ...this.state.telemetry,
          stage3: 'complete',
          stage3Ms: s3.latencyMs,
          groundingProvider: s3.groundingProvider,
        },
      };
      this.emit();
      return finalResult;
    } catch (err) {
      if (runToken !== this.activeRunToken) return null;
      const msg =
        err instanceof Error ? err.message : 'Verification pipeline error.';
      const t = this.state.telemetry;
      this.state = {
        ...this.state,
        running: false,
        error: msg,
        telemetry: {
          ...t,
          stage1: t.stage1 === 'running' ? 'error' : t.stage1,
          stage2: t.stage2 === 'running' ? 'error' : t.stage2,
          stage3: t.stage3 === 'running' ? 'error' : t.stage3,
        },
      };
      this.emit();
      return null;
    }
  }

  exportCurrentReport(format: 'json' | 'markdown'): void {
    const res = this.state.currentResult;
    if (!res) return;

    let content = '';
    let mime = 'application/json';
    let ext = 'json';

    if (format === 'json') {
      content = JSON.stringify(res, null, 2);
    } else {
      mime = 'text/markdown';
      ext = 'md';
      const cleanHealed = res.healedOutput.replace(
        /\[\[([^|\]]+)\|[^\]]+\]\]/g,
        '**$1**'
      );
      content = [
        `# ChronoGate Freshness Audit Report (${res.runId})`,
        '',
        `- **Timestamp:** ${res.timestamp}`,
        `- **Model Route:** \`${res.model}\``,
        `- **Freshness Score:** ${res.overallFreshnessScore}/100 (Policy Threshold: ${res.freshnessThreshold})`,
        `- **Policy Verdict:** ${res.policyVerdict}`,
        `- **Claims Audited:** ${res.claimsAudited} | **Stale Patched:** ${res.stalePatched}`,
        `- **Total Latency:** ${res.totalLatencyMs}ms`,
        '',
        `## Prompt`,
        res.prompt,
        '',
        `## Raw Unverified Output`,
        res.rawOutput,
        '',
        `## ChronoGate Healed Output`,
        cleanHealed,
        '',
        `## Claim-by-Claim Audit Ledger`,
        ...res.verifiedClaims.map(
          (c) =>
            `- **[${c.status} ${c.freshnessScore}/100] (${c.category})** ${c.claimText}\n  - *Original:* ~~${c.exactQuote}~~\n  - *Verified Fact:* ${c.verifiedFact}\n  - *Source:* [${c.sourceTitle}](${c.sourceUrl})`
        ),
      ].join('\n');
    }

    const blob = new Blob([content], {type: mime});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chronogate-audit-${res.runId.toLowerCase()}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export const chronoStore = new ChronoStore();
