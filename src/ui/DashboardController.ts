import {
  getProxySnippets,
  getScoreTier,
  PRIMARY_MODEL_OPTIONS,
  STALE_TRAP_PRESETS,
} from '../constants.ts';
import {chronoStore} from '../state/ChronoStore.ts';
import type {
  ChronoAppState,
  ClaimCategory,
  PolicyMode,
  PrimaryModelId,
  StageState,
  VerificationProvider,
  VerifiedClaim,
} from '../types.ts';
import {
  type DemoVideoArtifact,
  renderDemoVideoWebM,
} from './DemoVideoStudio.ts';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return 'https://www.google.com';
}

function renderRawHighlightedHtml(
  rawText: string,
  claims: VerifiedClaim[]
): string {
  if (!rawText) return '';
  if (!claims.length) {
    return escapeHtml(rawText).replace(/\n/g, '<br />');
  }

  interface MatchSpan {
    start: number;
    end: number;
    claim: VerifiedClaim;
  }
  const spans: MatchSpan[] = [];
  const lowerRaw = rawText.toLowerCase();

  for (const claim of claims) {
    if (claim.status === 'FRESH' || !claim.exactQuote) continue;
    const needle = claim.exactQuote.trim();
    if (needle.length < 4) continue;
    const idx = lowerRaw.indexOf(needle.toLowerCase());
    if (idx === -1) continue;
    const end = idx + needle.length;
    const overlaps = spans.some((s) => !(end <= s.start || idx >= s.end));
    if (!overlaps) {
      spans.push({start: idx, end, claim});
    }
  }

  spans.sort((a, b) => a.start - b.start);

  let html = '';
  let cursor = 0;
  for (const span of spans) {
    if (span.start > cursor) {
      html += escapeHtml(rawText.slice(cursor, span.start));
    }
    const snippet = escapeHtml(rawText.slice(span.start, span.end));
    const cls =
      span.claim.status === 'STALE' ? 'cg-mark-stale' : 'cg-mark-aging';
    html += `<del class="${cls}" title="${escapeHtml(span.claim.status)} (${span.claim.freshnessScore}/100): ${escapeHtml(span.claim.verifiedFact)}">${snippet}</del>`;
    cursor = span.end;
  }
  if (cursor < rawText.length) {
    html += escapeHtml(rawText.slice(cursor));
  }
  return html.replace(/\n/g, '<br />');
}

function renderHealedHighlightedHtml(
  healedText: string,
  claims: VerifiedClaim[],
  autoHealed: boolean
): string {
  if (!healedText) return '';
  if (!autoHealed) {
    return escapeHtml(
      healedText.replace(/\[\[([^|\]]+)\|[^\]]+\]\]/g, '$1')
    ).replace(/\n/g, '<br />');
  }

  const claimMap = new Map(claims.map((c) => [c.id, c]));
  const regex = /\[\[([^|\]]+)\|([^\]]+)\]\]/g;
  let html = '';
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(healedText)) !== null) {
    if (match.index > lastIndex) {
      html += escapeHtml(healedText.slice(lastIndex, match.index));
    }
    const patchedPhrase = escapeHtml(match[1].trim());
    const claimId = match[2].trim();
    const claim = claimMap.get(claimId);
    const sourceHref = claim ? escapeHtml(safeUrl(claim.sourceUrl)) : '';
    const sourceTitle = claim ? escapeHtml(claim.sourceTitle) : 'Verified Source';

    html += `<span class="cg-mark-healed">${patchedPhrase}</span>`;
    if (sourceHref) {
      html += ` <a class="cg-inline-cite" href="${sourceHref}" target="_blank" rel="noopener noreferrer" title="${sourceTitle}">[Verified Source]</a>`;
    }
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < healedText.length) {
    html += escapeHtml(healedText.slice(lastIndex));
  }

  return html.replace(/\n/g, '<br />');
}

function stageLabel(state: StageState): string {
  if (state === 'running') return 'Executing';
  if (state === 'complete') return 'Verified';
  if (state === 'error') return 'Failed';
  return 'Standby';
}

const TOUR_STEPS = [
  {
    title: 'Step 1 of 5 · Gateway Policy & Bifrost Routing',
    desc: 'Configure Bifrost endpoint routing, live Google Search / Tavily grounding, and a 0–100 Freshness Policy threshold.',
    anchor: '.cg-config-bar',
  },
  {
    title: 'Step 2 of 5 · Live 3-Stage Stale Trap Verification',
    desc: 'ChronoGate runs an ungrounded Bifrost draft, extracts structured JSON temporal claims, and grounds every claim against live web search.',
    anchor: '#cgStepperMount',
  },
  {
    title: 'Step 3 of 5 · Split-Screen Diff & Radial Freshness Telemetry',
    desc: 'Outdated claims are struck through on the left and surgically patched with clickable [Verified Source] citations on the right.',
    anchor: '#cgDiffMount',
  },
  {
    title: 'Step 4 of 5 · Forensic Claim Audit Ledger & Compliance Export',
    desc: 'Inspect every claim score (FRESH / AGING / STALE), filter by category, or export JSON & Markdown audit reports.',
    anchor: '#cgLedgerMount',
  },
  {
    title: 'Step 5 of 5 · Drop-In 5-Line Proxy SDK & Spatial XR Reactor',
    desc: 'Drop ChronoGate in front of any OpenAI-compatible agent by swapping base_url, or switch into 3D Spatial XR View.',
    anchor: '.cg-topbar',
  },
];

export class DashboardController {
  private rootEl: HTMLElement;
  private unsubscribe?: () => void;
  private copyResetTimer?: number;
  private copied = false;

  // Demo Video Studio local state
  private videoRendering = false;
  private videoProgress = 0;
  private videoStageLabel = '';
  private videoArtifact: DemoVideoArtifact | null = null;
  private videoError: string | null = null;

  // Persistent DOM containers
  private shellEl!: HTMLElement;
  private spatialReturnBar!: HTMLElement;
  private bifrostInput!: HTMLInputElement;
  private providerSelect!: HTMLSelectElement;
  private modelSelect!: HTMLSelectElement;
  private policyModeSelect!: HTMLSelectElement;
  private thresholdSlider!: HTMLInputElement;
  private thresholdValueEl!: HTMLElement;
  private autoHealCheck!: HTMLInputElement;
  private demoModeCheck!: HTMLInputElement;
  private bypassCacheCheck!: HTMLInputElement;
  private promptInput!: HTMLTextAreaElement;
  private runBtn!: HTMLButtonElement;
  private benchmarkBtn!: HTMLButtonElement;
  private statusTextEl!: HTMLElement;
  private tavilyHintEl!: HTMLElement;
  private errorBannerEl!: HTMLElement;
  private stepperMount!: HTMLElement;
  private kpiMount!: HTMLElement;
  private benchmarkMount!: HTMLElement;
  private diffMount!: HTMLElement;
  private ledgerMount!: HTMLElement;
  private historyMount!: HTMLElement;
  private tourBarMount!: HTMLElement;
  private drawerBackdrop!: HTMLElement;
  private drawerBodyMount!: HTMLElement;
  private demoModalBackdrop!: HTMLElement;
  private demoModalBodyMount!: HTMLElement;
  private presetBtns: HTMLButtonElement[] = [];

  constructor(rootEl: HTMLElement) {
    this.rootEl = rootEl;
    this.buildStaticShell();
    this.bindEvents();
    this.unsubscribe = chronoStore.subscribe((state) => this.render(state));
  }

  private buildStaticShell(): void {
    this.rootEl.innerHTML = `
      <div class="cg-spatial-bar" id="cgSpatialReturnBar" hidden>
        <div class="cg-spatial-bar-inner">
          <span class="cg-spatial-brand">ChronoGate Spatial XR</span>
          <span class="cg-sep" aria-hidden="true">·</span>
          <span class="cg-spatial-hint">Pinch or click the floating 3D cards · Orbital satellites reflect claim health</span>
          <button type="button" class="cg-btn-primary cg-btn-sm" id="cgReturnDashboardBtn">
            Return to Dashboard
          </button>
        </div>
      </div>

      <div class="cg-shell" id="cgShell">
        <!-- TOP BAR (3-Zone Contract) -->
        <header class="cg-topbar">
          <div class="cg-brand-zone">
            <svg class="cg-logo-mark" width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M12 2L3 6.5V12.5C3 17.6 6.84 22.12 12 23.5C17.16 22.12 21 17.6 21 12.5V6.5L12 2Z" stroke="#06B6D4" stroke-width="1.8" stroke-linejoin="round"/>
              <path d="M12 7V12L15.5 14" stroke="#10B981" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <span class="cg-brand-title">ChronoGate</span>
          </div>

          <div class="cg-status-zone" id="cgGatewayStatus">
            Gateway Active · Semantic Cache Ready
          </div>

          <div class="cg-actions-zone">
            <button type="button" class="cg-btn-ghost" id="cgProxyDrawerBtn">
              Drop-In Proxy SDK
            </button>
            <button type="button" class="cg-btn-secondary" id="cgSpatialModeBtn">
              Spatial XR View
            </button>
            <button type="button" class="cg-btn-primary" id="cgDemoStudioBtn">
              Demo Video Studio
            </button>
          </div>
        </header>

        <!-- GATEWAY CONFIGURATION & POLICY BAR -->
        <section class="cg-config-bar" aria-label="Gateway Configuration and Policy Engine">
          <div class="cg-field cg-field-wide">
            <label for="cgBifrostInput">Bifrost Gateway Endpoint</label>
            <input
              id="cgBifrostInput"
              type="text"
              class="cg-input cg-mono"
              value="http://localhost:8080/v1"
              spellcheck="false"
              placeholder="http://localhost:8080/v1"
            />
          </div>

          <div class="cg-field">
            <label for="cgProviderSelect">Live Web Grounding</label>
            <select id="cgProviderSelect" class="cg-select">
              <option value="google-grounding">Google Search Grounding (Built-in)</option>
              <option value="tavily-hybrid">Tavily Proxy + Google Grounding</option>
            </select>
            <span class="cg-field-note" id="cgTavilyHint">Server proxy active · Built-in grounding ready</span>
          </div>

          <div class="cg-field">
            <label for="cgModelSelect">Primary Model Route</label>
            <select id="cgModelSelect" class="cg-select cg-mono">
              ${PRIMARY_MODEL_OPTIONS.map(
                (m) => `<option value="${m.id}">${m.label}</option>`
              ).join('')}
            </select>
          </div>

          <div class="cg-field cg-field-policy">
            <label for="cgPolicyModeSelect">Freshness Policy Mode</label>
            <select id="cgPolicyModeSelect" class="cg-select">
              <option value="patch">Auto-Patch Below Threshold</option>
              <option value="quarantine">Quarantine Critical (&lt; 45)</option>
              <option value="audit">Audit Only (No Rewrite)</option>
            </select>
          </div>

          <div class="cg-field cg-field-slider">
            <div class="cg-slider-head">
              <label for="cgThresholdSlider">Min Freshness Policy</label>
              <span class="cg-mono cg-slider-val" id="cgThresholdValue">90 / 100</span>
            </div>
            <input
              id="cgThresholdSlider"
              type="range"
              min="50"
              max="95"
              step="5"
              value="90"
              class="cg-range"
            />
          </div>

          <div class="cg-toggles-group">
            <label class="cg-switch-label">
              <input id="cgAutoHealCheck" type="checkbox" checked />
              <span class="cg-switch-track"><span class="cg-switch-thumb"></span></span>
              <span class="cg-switch-text">Auto-Heal</span>
            </label>

            <label class="cg-switch-label">
              <input id="cgDemoModeCheck" type="checkbox" checked />
              <span class="cg-switch-track"><span class="cg-switch-thumb"></span></span>
              <span class="cg-switch-text">Demo Mode</span>
            </label>

            <label class="cg-switch-label" title="Disable Stage 1 semantic cache lookup to force fresh generation">
              <input id="cgBypassCacheCheck" type="checkbox" />
              <span class="cg-switch-track"><span class="cg-switch-thumb"></span></span>
              <span class="cg-switch-text">Bypass Cache</span>
            </label>
          </div>
        </section>

        <!-- MAIN WORKSPACE -->
        <main class="cg-main">
          <!-- PROMPT & 4 STALE TRAP PRESETS -->
          <section class="cg-prompt-panel" aria-label="Prompt and Stale Trap Presets">
            <div class="cg-prompt-row">
              <textarea
                id="cgPromptInput"
                class="cg-prompt-input"
                rows="2"
                placeholder="Ask a time-sensitive question about versions, API pricing, regulations, or product releases..."
              ></textarea>
              <div class="cg-prompt-actions">
                <button type="button" class="cg-btn-primary cg-run-btn" id="cgRunBtn">
                  Verify &amp; Heal
                </button>
                <button type="button" class="cg-btn-secondary cg-bench-btn" id="cgBenchmarkBtn">
                  Benchmark 3 Models
                </button>
              </div>
            </div>

            <div class="cg-presets-row">
              <span class="cg-presets-label">Stale Trap Presets</span>
              <div class="cg-presets-list">
                ${STALE_TRAP_PRESETS.map(
                  (p) => `
                  <button type="button" class="cg-preset-btn" data-preset-id="${p.id}">
                    <span class="cg-preset-cat">${p.category.replace('_', ' ')}</span>
                    <span class="cg-preset-title">${escapeHtml(p.label)}</span>
                  </button>
                `
                ).join('')}
              </div>
            </div>

            <div class="cg-error-banner" id="cgErrorBanner" hidden></div>
          </section>

          <!-- 3-STAGE ANIMATED STEPPER -->
          <section class="cg-stepper-section" id="cgStepperMount" aria-label="3-Stage Verification Pipeline"></section>

          <!-- TOP KPI ROW -->
          <section class="cg-kpi-grid" id="cgKpiMount" aria-label="Freshness Telemetry"></section>

          <!-- MULTI-MODEL DRIFT BENCHMARK (Renders when triggered) -->
          <section class="cg-benchmark-section" id="cgBenchmarkMount" aria-label="Multi-Model Drift Benchmark" hidden></section>

          <!-- SPLIT-SCREEN DIFF -->
          <section class="cg-diff-grid" id="cgDiffMount" aria-label="Raw vs Healed Response Diff"></section>

          <!-- CLAIM-BY-CLAIM AUDIT LEDGER -->
          <section class="cg-ledger-section" id="cgLedgerMount" aria-label="Claim-by-Claim Audit Ledger"></section>

          <!-- AUDIT HISTORY & FRESHNESS TREND -->
          <section class="cg-history-section" id="cgHistoryMount" aria-label="Audit Run History and Trend"></section>
        </main>
      </div>

      <!-- FLOATING GUIDED TOUR NARRATION BAR -->
      <div class="cg-tour-bar" id="cgTourBarMount" hidden></div>

      <!-- DEVELOPER DROP-IN PROXY DRAWER -->
      <div class="cg-drawer-backdrop" id="cgDrawerBackdrop" hidden>
        <aside class="cg-drawer" role="dialog" aria-modal="true" aria-label="Drop-In Proxy SDK Drawer">
          <div class="cg-drawer-header">
            <div>
              <h2>Drop-In Bifrost Proxy Integration</h2>
              <p>Point any existing OpenAI-compatible agent to ChronoGate with zero workflow refactoring.</p>
            </div>
            <button type="button" class="cg-btn-ghost" id="cgCloseDrawerBtn">Close</button>
          </div>
          <div class="cg-drawer-body" id="cgDrawerBodyMount"></div>
        </aside>
      </div>

      <!-- DEMO VIDEO STUDIO MODAL -->
      <div class="cg-modal-backdrop" id="cgDemoModalBackdrop" hidden>
        <section class="cg-modal" role="dialog" aria-modal="true" aria-label="ChronoGate Demo Video Studio">
          <div class="cg-drawer-header">
            <div>
              <h2>ChronoGate Demo Video Studio</h2>
              <p>Render a 720p narrated WebM product demo video from live audit data, or launch an interactive auto-piloted tour.</p>
            </div>
            <button type="button" class="cg-btn-ghost" id="cgCloseDemoModalBtn">Close</button>
          </div>
          <div class="cg-modal-body" id="cgDemoModalBodyMount"></div>
        </section>
      </div>
    `;

    this.shellEl = this.rootEl.querySelector('#cgShell')!;
    this.spatialReturnBar = this.rootEl.querySelector('#cgSpatialReturnBar')!;
    this.bifrostInput = this.rootEl.querySelector('#cgBifrostInput')!;
    this.providerSelect = this.rootEl.querySelector('#cgProviderSelect')!;
    this.modelSelect = this.rootEl.querySelector('#cgModelSelect')!;
    this.policyModeSelect = this.rootEl.querySelector('#cgPolicyModeSelect')!;
    this.thresholdSlider = this.rootEl.querySelector('#cgThresholdSlider')!;
    this.thresholdValueEl = this.rootEl.querySelector('#cgThresholdValue')!;
    this.autoHealCheck = this.rootEl.querySelector('#cgAutoHealCheck')!;
    this.demoModeCheck = this.rootEl.querySelector('#cgDemoModeCheck')!;
    this.bypassCacheCheck = this.rootEl.querySelector('#cgBypassCacheCheck')!;
    this.promptInput = this.rootEl.querySelector('#cgPromptInput')!;
    this.runBtn = this.rootEl.querySelector('#cgRunBtn')!;
    this.benchmarkBtn = this.rootEl.querySelector('#cgBenchmarkBtn')!;
    this.statusTextEl = this.rootEl.querySelector('#cgGatewayStatus')!;
    this.tavilyHintEl = this.rootEl.querySelector('#cgTavilyHint')!;
    this.errorBannerEl = this.rootEl.querySelector('#cgErrorBanner')!;
    this.stepperMount = this.rootEl.querySelector('#cgStepperMount')!;
    this.kpiMount = this.rootEl.querySelector('#cgKpiMount')!;
    this.benchmarkMount = this.rootEl.querySelector('#cgBenchmarkMount')!;
    this.diffMount = this.rootEl.querySelector('#cgDiffMount')!;
    this.ledgerMount = this.rootEl.querySelector('#cgLedgerMount')!;
    this.historyMount = this.rootEl.querySelector('#cgHistoryMount')!;
    this.tourBarMount = this.rootEl.querySelector('#cgTourBarMount')!;
    this.drawerBackdrop = this.rootEl.querySelector('#cgDrawerBackdrop')!;
    this.drawerBodyMount = this.rootEl.querySelector('#cgDrawerBodyMount')!;
    this.demoModalBackdrop = this.rootEl.querySelector('#cgDemoModalBackdrop')!;
    this.demoModalBodyMount = this.rootEl.querySelector(
      '#cgDemoModalBodyMount'
    )!;
    this.presetBtns = Array.from(
      this.rootEl.querySelectorAll<HTMLButtonElement>('.cg-preset-btn')
    );
  }

  private bindEvents(): void {
    this.bifrostInput.addEventListener('input', () => {
      chronoStore.updateConfig({bifrostEndpoint: this.bifrostInput.value});
    });

    this.providerSelect.addEventListener('change', () => {
      chronoStore.updateConfig({
        verificationProvider: this.providerSelect.value as VerificationProvider,
      });
    });

    this.modelSelect.addEventListener('change', () => {
      chronoStore.updateConfig({
        primaryModel: this.modelSelect.value as PrimaryModelId,
      });
    });

    this.policyModeSelect.addEventListener('change', () => {
      chronoStore.updateConfig({
        policyMode: this.policyModeSelect.value as PolicyMode,
      });
    });

    this.thresholdSlider.addEventListener('input', () => {
      const val = Number(this.thresholdSlider.value);
      chronoStore.updateConfig({freshnessThreshold: val});
    });

    this.autoHealCheck.addEventListener('change', () => {
      chronoStore.updateConfig({autoHeal: this.autoHealCheck.checked});
    });

    this.demoModeCheck.addEventListener('change', () => {
      chronoStore.updateConfig({demoMode: this.demoModeCheck.checked});
    });

    this.bypassCacheCheck.addEventListener('change', () => {
      chronoStore.updateConfig({bypassCache: this.bypassCacheCheck.checked});
    });

    this.promptInput.addEventListener('input', () => {
      chronoStore.setPrompt(this.promptInput.value);
    });

    this.promptInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!chronoStore.getState().running) {
          void chronoStore.runVerificationPipeline();
        }
      }
    });

    this.runBtn.addEventListener('click', () => {
      void chronoStore.runVerificationPipeline();
    });

    this.benchmarkBtn.addEventListener('click', () => {
      void chronoStore.runMultiModelBenchmark();
    });

    for (const btn of this.presetBtns) {
      btn.addEventListener('click', () => {
        const id = btn.dataset.presetId;
        if (id && !chronoStore.getState().running) {
          void chronoStore.runPreset(id);
        }
      });
    }

    this.rootEl
      .querySelector('#cgProxyDrawerBtn')
      ?.addEventListener('click', () => {
        chronoStore.setProxyDrawerOpen(true);
      });

    this.rootEl
      .querySelector('#cgCloseDrawerBtn')
      ?.addEventListener('click', () => {
        chronoStore.setProxyDrawerOpen(false);
      });

    this.drawerBackdrop.addEventListener('click', (e) => {
      if (e.target === this.drawerBackdrop) {
        chronoStore.setProxyDrawerOpen(false);
      }
    });

    this.rootEl
      .querySelector('#cgDemoStudioBtn')
      ?.addEventListener('click', () => {
        chronoStore.setDemoStudioOpen(true);
      });

    this.rootEl
      .querySelector('#cgCloseDemoModalBtn')
      ?.addEventListener('click', () => {
        chronoStore.setDemoStudioOpen(false);
      });

    this.demoModalBackdrop.addEventListener('click', (e) => {
      if (e.target === this.demoModalBackdrop) {
        chronoStore.setDemoStudioOpen(false);
      }
    });

    this.rootEl
      .querySelector('#cgSpatialModeBtn')
      ?.addEventListener('click', () => {
        chronoStore.setSpatialMode(true);
      });

    this.rootEl
      .querySelector('#cgReturnDashboardBtn')
      ?.addEventListener('click', () => {
        chronoStore.setSpatialMode(false);
      });

    // Delegated Ledger events
    this.ledgerMount.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const filterBtn = target.closest<HTMLButtonElement>('[data-filter-cat]');
      if (filterBtn) {
        const cat = filterBtn.dataset.filterCat as 'ALL' | ClaimCategory;
        chronoStore.setCategoryFilter(cat);
        return;
      }
      if (target.closest('#cgExpandAllBtn')) {
        chronoStore.expandAllClaims();
        return;
      }
      if (target.closest('#cgCollapseAllBtn')) {
        chronoStore.collapseAllClaims();
        return;
      }
      if (target.closest('#cgExportJsonBtn')) {
        chronoStore.exportCurrentReport('json');
        return;
      }
      if (target.closest('#cgExportMdBtn')) {
        chronoStore.exportCurrentReport('markdown');
        return;
      }
      const toggleRow = target.closest<HTMLElement>('[data-toggle-claim]');
      if (toggleRow && !target.closest('a')) {
        const claimId = toggleRow.dataset.toggleClaim;
        if (claimId) chronoStore.toggleClaimExpanded(claimId);
      }
    });

    // Delegated History events
    this.historyMount.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('#cgClearHistoryBtn')) {
        chronoStore.clearHistory();
        return;
      }
      const runBtn = target.closest<HTMLButtonElement>('[data-history-run]');
      if (runBtn?.dataset.historyRun) {
        chronoStore.selectHistoryRun(runBtn.dataset.historyRun);
      }
    });

    // Delegated Proxy Drawer events
    this.drawerBodyMount.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const langBtn = target.closest<HTMLButtonElement>('[data-proxy-lang]');
      if (langBtn) {
        const lang = langBtn.dataset.proxyLang as
          | 'python'
          | 'typescript'
          | 'curl';
        chronoStore.setProxyLang(lang);
        return;
      }
      if (target.closest('#cgCopySnippetBtn')) {
        const st = chronoStore.getState();
        const snippets = getProxySnippets(
          st.config.bifrostEndpoint,
          st.config.primaryModel
        );
        const text = snippets[st.proxyLang];
        void navigator.clipboard?.writeText(text).then(() => {
          this.copied = true;
          this.renderDrawer(chronoStore.getState());
          window.clearTimeout(this.copyResetTimer);
          this.copyResetTimer = window.setTimeout(() => {
            this.copied = false;
            this.renderDrawer(chronoStore.getState());
          }, 1800);
        });
      }
    });

    // Delegated Demo Video Studio modal events
    this.demoModalBodyMount.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('#cgRenderVideoBtn')) {
        void this.handleGenerateDemoVideo(false);
        return;
      }
      if (target.closest('#cgAuditAndRenderVideoBtn')) {
        void this.handleGenerateDemoVideo(true);
        return;
      }
      if (target.closest('#cgStartGuidedTourBtn')) {
        chronoStore.setDemoStudioOpen(false);
        void this.goToTourStep(0);
        return;
      }
    });

    // Delegated Guided Tour bar events
    this.tourBarMount.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const cur = chronoStore.getState().guidedTourStep;
      if (cur === null) return;
      if (target.closest('#cgTourPrevBtn')) {
        void this.goToTourStep(Math.max(0, cur - 1));
      } else if (target.closest('#cgTourNextBtn')) {
        if (cur >= TOUR_STEPS.length - 1) {
          chronoStore.setGuidedTourStep(null);
        } else {
          void this.goToTourStep(cur + 1);
        }
      } else if (target.closest('#cgTourStopBtn')) {
        chronoStore.setGuidedTourStep(null);
      }
    });
  }

  private async handleGenerateDemoVideo(runFreshAuditFirst: boolean) {
    if (this.videoRendering) return;
    this.videoRendering = true;
    this.videoError = null;
    this.videoProgress = 0;
    this.videoStageLabel = runFreshAuditFirst
      ? 'Running live 3-stage audit before encoding video…'
      : 'Initializing 720p WebM video canvas…';
    this.renderDemoModal(chronoStore.getState());

    try {
      if (runFreshAuditFirst || !chronoStore.getState().currentResult) {
        const res = await chronoStore.runVerificationPipeline();
        if (!res && runFreshAuditFirst) {
          throw new Error('Live audit did not complete before rendering video.');
        }
      }

      if (this.videoArtifact) {
        URL.revokeObjectURL(this.videoArtifact.url);
        this.videoArtifact = null;
      }

      const st = chronoStore.getState();
      const artifact = await renderDemoVideoWebM({
        result: st.currentResult,
        config: st.config,
        cumulativeSavingsUsd: st.cumulativeSavingsUsd,
        onProgress: (percent, stageLabel) => {
          this.videoProgress = percent;
          this.videoStageLabel = stageLabel;
          const bar = this.demoModalBodyMount.querySelector<HTMLElement>(
            '#cgVideoProgressFill'
          );
          const lbl = this.demoModalBodyMount.querySelector<HTMLElement>(
            '#cgVideoProgressLabel'
          );
          if (bar) bar.style.width = `${percent}%`;
          if (lbl) lbl.textContent = `${stageLabel} (${percent}%)`;
        },
      });
      this.videoArtifact = artifact;
    } catch (err) {
      this.videoError =
        err instanceof Error ? err.message : 'Demo video rendering failed.';
    } finally {
      this.videoRendering = false;
      this.renderDemoModal(chronoStore.getState());
    }
  }

  private async goToTourStep(stepIndex: number) {
    chronoStore.setGuidedTourStep(stepIndex);
    const meta = TOUR_STEPS[stepIndex];
    if (!meta) return;

    const anchorEl = this.rootEl.querySelector(meta.anchor);
    anchorEl?.scrollIntoView({behavior: 'smooth', block: 'center'});

    if (stepIndex === 1 && !chronoStore.getState().currentResult) {
      void chronoStore.runPreset(STALE_TRAP_PRESETS[0].id);
    } else if (stepIndex === 3) {
      chronoStore.expandAllClaims();
    } else if (stepIndex === 4) {
      chronoStore.setProxyDrawerOpen(true);
    } else {
      chronoStore.setProxyDrawerOpen(false);
    }
  }

  private render(state: ChronoAppState): void {
    this.shellEl.hidden = state.spatialMode;
    this.spatialReturnBar.hidden = !state.spatialMode;
    document.body.classList.toggle('cg-spatial-active', state.spatialMode);

    if (document.activeElement !== this.bifrostInput) {
      this.bifrostInput.value = state.config.bifrostEndpoint;
    }
    if (document.activeElement !== this.promptInput) {
      this.promptInput.value = state.prompt;
    }
    this.providerSelect.value = state.config.verificationProvider;
    this.modelSelect.value = state.config.primaryModel;
    this.policyModeSelect.value = state.config.policyMode;
    this.thresholdSlider.value = String(state.config.freshnessThreshold);
    this.thresholdValueEl.textContent = `${state.config.freshnessThreshold} / 100`;
    this.autoHealCheck.checked = state.config.autoHeal;
    this.demoModeCheck.checked = state.config.demoMode;
    this.bypassCacheCheck.checked = state.config.bypassCache;

    if (state.running || state.benchmarkRunning) {
      this.statusTextEl.textContent = state.benchmarkRunning
        ? 'Benchmarking 3 Model Routes · Live Grounding'
        : 'Pipeline Auditing Live Web · Grounding Stream Active';
      this.statusTextEl.className = 'cg-status-zone cg-status-busy';
    } else {
      this.statusTextEl.textContent = state.telemetry.cacheHit
        ? 'Gateway Active · Semantic Cache Hit'
        : 'Gateway Active · Semantic Cache Ready';
      this.statusTextEl.className = 'cg-status-zone cg-status-ready';
    }

    this.tavilyHintEl.textContent = state.serverCapabilities.tavilyConfigured
      ? 'Tavily server proxy configured · Hybrid grounding ready'
      : 'Server proxy active · Built-in Google Search Grounding ready';

    this.runBtn.disabled = state.running;
    this.runBtn.textContent = state.running
      ? 'Auditing Pipeline…'
      : 'Verify & Heal';
    this.benchmarkBtn.disabled = state.benchmarkRunning || state.running;
    this.benchmarkBtn.textContent = state.benchmarkRunning
      ? 'Benchmarking…'
      : 'Benchmark 3 Models';

    for (const btn of this.presetBtns) {
      btn.disabled = state.running;
    }

    if (state.error) {
      this.errorBannerEl.hidden = false;
      this.errorBannerEl.textContent = state.error;
    } else {
      this.errorBannerEl.hidden = true;
      this.errorBannerEl.textContent = '';
    }

    this.renderStepper(state);
    this.renderKpis(state);
    this.renderBenchmark(state);
    this.renderDiff(state);
    this.renderLedger(state);
    this.renderHistory(state);
    this.renderTourBar(state);
    this.renderDrawer(state);
    this.renderDemoModal(state);
  }

  private renderStepper(state: ChronoAppState): void {
    const t = state.telemetry;
    const result = state.currentResult;
    const steps: {
      num: string;
      title: string;
      subtitle: string;
      status: StageState;
      latencyMs: number;
    }[] = [
      {
        num: '01',
        title: 'Generate via Bifrost Route',
        subtitle: t.cacheHit
          ? `${t.routeUsed} (Cache Hit)`
          : t.routeUsed || state.config.primaryModel,
        status: t.stage1,
        latencyMs: t.stage1Ms,
      },
      {
        num: '02',
        title: 'Temporal Claim Extraction',
        subtitle:
          t.stage2 === 'complete'
            ? `${result?.extractedClaims.length ?? 0} time-sensitive claims isolated`
            : 'Structured JSON parse: Pricing, API, Regulation, Company',
        status: t.stage2,
        latencyMs: t.stage2Ms,
      },
      {
        num: '03',
        title: 'Live Web Verification & Self-Healing',
        subtitle:
          t.stage3 === 'complete'
            ? `${t.groundingProvider} · Policy >= ${state.config.freshnessThreshold}`
            : `${t.groundingProvider} + Freshness Policy (${state.config.freshnessThreshold}/100)`,
        status: t.stage3,
        latencyMs: t.stage3Ms,
      },
    ];

    this.stepperMount.innerHTML = `
      <div class="cg-stepper">
        ${steps
          .map(
            (s, i) => `
          <div class="cg-step cg-step-${s.status}">
            <div class="cg-step-head">
              <span class="cg-step-num cg-mono">${s.num}</span>
              <span class="cg-step-title">${escapeHtml(s.title)}</span>
              <span class="cg-step-state cg-mono">${stageLabel(s.status)}${s.latencyMs > 0 ? ` · ${s.latencyMs}ms` : ''}</span>
            </div>
            <div class="cg-step-sub">${escapeHtml(s.subtitle)}</div>
            <div class="cg-step-bar"><div class="cg-step-bar-fill"></div></div>
          </div>
          ${i < 2 ? `<div class="cg-step-connector ${s.status === 'complete' ? 'cg-conn-done' : ''}" aria-hidden="true"></div>` : ''}
        `
          )
          .join('')}
      </div>
    `;
  }

  private renderKpis(state: ChronoAppState): void {
    const res = state.currentResult;
    const hasVerified = Boolean(res && res.verifiedClaims.length > 0);
    const score = hasVerified && res ? res.overallFreshnessScore : 0;
    const tier = hasVerified ? getScoreTier(score) : null;

    const radius = 32;
    const circumference = 2 * Math.PI * radius;
    const dashOffset = hasVerified
      ? circumference * (1 - score / 100)
      : circumference;
    const strokeColor = !hasVerified
      ? '#334155'
      : score >= 90
        ? '#10B981'
        : score >= 50
          ? '#F59E0B'
          : '#EF4444';

    const staleCount =
      res?.verifiedClaims.filter((c) => c.status === 'STALE').length ?? 0;
    const agingCount =
      res?.verifiedClaims.filter((c) => c.status === 'AGING').length ?? 0;
    const verdict = res?.policyVerdict ?? 'PASS';

    this.kpiMount.innerHTML = `
      <article class="cg-kpi-card cg-kpi-gauge-card">
        <div class="cg-gauge-wrap">
          <svg class="cg-gauge-svg" width="80" height="80" viewBox="0 0 80 80" aria-label="Overall Freshness Score">
            <circle cx="40" cy="40" r="${radius}" fill="none" stroke="#1E293B" stroke-width="7" />
            <circle
              cx="40"
              cy="40"
              r="${radius}"
              fill="none"
              stroke="${strokeColor}"
              stroke-width="7"
              stroke-linecap="round"
              stroke-dasharray="${circumference.toFixed(1)}"
              stroke-dashoffset="${dashOffset.toFixed(1)}"
              transform="rotate(-90 40 40)"
              class="cg-gauge-arc"
            />
          </svg>
          <div class="cg-gauge-center cg-mono">${hasVerified ? score : '--'}</div>
        </div>
        <div class="cg-kpi-meta">
          <div class="cg-kpi-label">Overall Freshness Score</div>
          <div class="cg-kpi-sub">
            ${
              hasVerified && tier
                ? `<span class="cg-tier-text cg-tier-${tier.toLowerCase()}">${tier}</span> · Policy: <span class="cg-mono">${verdict}</span>`
                : `Policy threshold ${state.config.freshnessThreshold}/100`
            }
          </div>
        </div>
      </article>

      <article class="cg-kpi-card">
        <div class="cg-kpi-label">Claims Audited</div>
        <div class="cg-kpi-value cg-mono">${res?.claimsAudited ?? 0}</div>
        <div class="cg-kpi-sub">
          ${
            hasVerified
              ? `${staleCount} stale · ${agingCount} aging · ${(res?.claimsAudited ?? 0) - staleCount - agingCount} fresh`
              : 'Structured temporal extraction'
          }
        </div>
      </article>

      <article class="cg-kpi-card">
        <div class="cg-kpi-label">Stale Claims Patched</div>
        <div class="cg-kpi-value cg-mono ${res && res.stalePatched > 0 ? 'cg-val-emerald' : ''}">${res?.stalePatched ?? 0}</div>
        <div class="cg-kpi-sub">
          ${state.config.autoHeal ? `Policy: ${state.config.policyMode} (< ${state.config.freshnessThreshold})` : 'Auto-Heal paused (audit only)'}
        </div>
      </article>

      <article class="cg-kpi-card">
        <div class="cg-kpi-label">Est. Cache / Routing Savings</div>
        <div class="cg-kpi-value cg-mono cg-val-cyan">$${state.cumulativeSavingsUsd.toFixed(4)}</div>
        <div class="cg-kpi-sub">
          ${state.cumulativeRuns} gateway runs · ${state.cacheHits} semantic cache hits
        </div>
      </article>
    `;
  }

  private renderBenchmark(state: ChronoAppState): void {
    const bm = state.benchmarkResult;
    if (!state.benchmarkRunning && !bm) {
      this.benchmarkMount.hidden = true;
      return;
    }
    this.benchmarkMount.hidden = false;

    if (state.benchmarkRunning) {
      this.benchmarkMount.innerHTML = `
        <div class="cg-panel-head">
          <div>
            <h3>Multi-Model Temporal Drift Benchmark</h3>
            <p class="cg-panel-meta">Racing gemini-2.5-flash, openai/gpt-4o-mini, and anthropic/claude-3-5-sonnet against live Google Search Grounding…</p>
          </div>
          <span class="cg-panel-tag cg-val-cyan">Benchmarking</span>
        </div>
        <div class="cg-panel-body">
          <div class="cg-skeleton-group"><div class="cg-skel"></div><div class="cg-skel cg-skel-mid"></div></div>
        </div>
      `;
      return;
    }

    if (!bm) return;

    this.benchmarkMount.innerHTML = `
      <div class="cg-panel-head">
        <div>
          <h3>Multi-Model Temporal Drift Benchmark</h3>
          <p class="cg-panel-meta">Prompt audited at ${escapeHtml(bm.timestamp)} · ${escapeHtml(bm.groundingProvider)}</p>
        </div>
        <span class="cg-panel-tag cg-val-cyan">3 Bifrost Routes</span>
      </div>
      <div class="cg-bench-grid">
        ${bm.models
          .map((m) => {
            const tier = getScoreTier(m.freshnessScore).toLowerCase();
            return `
            <article class="cg-bench-card">
              <div class="cg-bench-top">
                <span class="cg-mono cg-bench-model">${escapeHtml(m.model)}</span>
                <span class="cg-mono cg-tier-${tier}">${m.freshnessScore}/100</span>
              </div>
              <div class="cg-bench-meta">
                Cutoff: ${escapeHtml(m.assumedCutoff)} · ${m.staleClaimsFound} stale · ${m.latencyMs}ms · ${m.verdict}
              </div>
              <div class="cg-bench-bar">
                <div class="cg-bench-bar-fill cg-bg-${tier}" style="width:${m.freshnessScore}%"></div>
              </div>
              <p class="cg-bench-drift">${escapeHtml(m.sampleDrift)}</p>
            </article>
          `;
          })
          .join('')}
      </div>
    `;
  }

  private renderDiff(state: ChronoAppState): void {
    const res = state.currentResult;
    const rawHtml = res?.rawOutput
      ? renderRawHighlightedHtml(res.rawOutput, res.verifiedClaims)
      : '';
    const healedHtml = res?.healedOutput
      ? renderHealedHighlightedHtml(
          res.healedOutput,
          res.verifiedClaims,
          res.autoHealed
        )
      : '';

    const assumptionsHtml =
      res && res.cutoffAssumptions.length > 0
        ? `<div class="cg-assumptions">
            <div class="cg-assumptions-title">Detected Cutoff Assumptions</div>
            <ul>${res.cutoffAssumptions.map((a) => `<li>${escapeHtml(a)}</li>`).join('')}</ul>
          </div>`
        : '';

    const sourcesStrip =
      res && res.groundingSources.length > 0
        ? `<div class="cg-sources-bar">
            <span class="cg-sources-label">Live Citations</span>
            <div class="cg-sources-links">
              ${res.groundingSources
                .slice(0, 5)
                .map(
                  (s) =>
                    `<a href="${escapeHtml(safeUrl(s.url))}" target="_blank" rel="noopener noreferrer" class="cg-source-link">${escapeHtml(s.domain)}</a>`
                )
                .join('<span class="cg-sep" aria-hidden="true">·</span>')}
            </div>
          </div>`
        : '';

    const quarantineBanner =
      res?.policyVerdict === 'QUARANTINED'
        ? `<div class="cg-quarantine-banner">Policy Action: QUARANTINED — Critical staleness detected (&lt; 45). Patched output held for review.</div>`
        : '';

    this.diffMount.innerHTML = `
      <article class="cg-diff-panel cg-diff-raw">
        <header class="cg-panel-head">
          <div>
            <h3>Raw Unverified Output</h3>
            <p class="cg-panel-meta">${escapeHtml(state.telemetry.routeUsed)} · Frozen training weights</p>
          </div>
          <span class="cg-panel-tag cg-tag-raw">Ungrounded</span>
        </header>
        <div class="cg-panel-body">
          ${
            rawHtml
              ? `<div class="cg-prose">${rawHtml}</div>${assumptionsHtml}`
              : state.running
                ? `<div class="cg-skeleton-group"><div class="cg-skel"></div><div class="cg-skel cg-skel-mid"></div><div class="cg-skel cg-skel-short"></div></div>`
                : `<div class="cg-empty">Click any <strong>Stale Trap</strong> preset above or enter a time-sensitive query to inspect raw LLM output.</div>`
          }
        </div>
      </article>

      <article class="cg-diff-panel cg-diff-healed">
        <header class="cg-panel-head">
          <div>
            <h3>ChronoGate Healed Output</h3>
            <p class="cg-panel-meta">${escapeHtml(state.telemetry.groundingProvider)}${res && res.totalLatencyMs > 0 ? ` · ${res.totalLatencyMs}ms total` : ''}</p>
          </div>
          <span class="cg-panel-tag cg-tag-healed">${res?.policyVerdict === 'QUARANTINED' ? 'Quarantined' : state.config.autoHeal ? 'Self-Healed' : 'Audit Only'}</span>
        </header>
        <div class="cg-panel-body">
          ${quarantineBanner}
          ${
            healedHtml
              ? `<div class="cg-prose">${healedHtml}</div>${sourcesStrip}`
              : state.running
                ? `<div class="cg-skeleton-group"><div class="cg-skel"></div><div class="cg-skel cg-skel-mid"></div><div class="cg-skel cg-skel-short"></div></div>`
                : `<div class="cg-empty">Verified live patches and clickable <strong>[Verified Source]</strong> citations will appear here once Stage 3 completes.</div>`
          }
        </div>
      </article>
    `;
  }

  private renderLedger(state: ChronoAppState): void {
    const res = state.currentResult;
    const allClaims = res?.verifiedClaims ?? [];
    const filtered =
      state.categoryFilter === 'ALL'
        ? allClaims
        : allClaims.filter((c) => c.category === state.categoryFilter);

    const categories: ('ALL' | ClaimCategory)[] = [
      'ALL',
      'PRICING',
      'API_VERSION',
      'REGULATION',
      'COMPANY_INFO',
    ];

    this.ledgerMount.innerHTML = `
      <div class="cg-ledger-head">
        <div>
          <h3>Claim-by-Claim Audit Ledger</h3>
          <p class="cg-panel-meta">Expand any detected claim to compare the original assertion against live verified evidence.</p>
        </div>
        <div class="cg-ledger-controls">
          <div class="cg-filter-group" role="tablist" aria-label="Filter claims by category">
            ${categories
              .map((cat) => {
                const count =
                  cat === 'ALL'
                    ? allClaims.length
                    : allClaims.filter((c) => c.category === cat).length;
                const active = state.categoryFilter === cat;
                return `<button type="button" class="cg-filter-btn ${active ? 'is-active' : ''}" data-filter-cat="${cat}">
                  ${cat === 'ALL' ? 'All' : cat.replace('_', ' ')} <span class="cg-mono">${count}</span>
                </button>`;
              })
              .join('')}
          </div>
          ${
            allClaims.length > 0
              ? `<div class="cg-ledger-expand-btns">
                  <button type="button" class="cg-btn-text" id="cgExpandAllBtn">Expand All</button>
                  <span class="cg-sep" aria-hidden="true">·</span>
                  <button type="button" class="cg-btn-text" id="cgCollapseAllBtn">Collapse All</button>
                  <span class="cg-sep" aria-hidden="true">·</span>
                  <button type="button" class="cg-btn-text" id="cgExportJsonBtn">Export JSON</button>
                  <span class="cg-sep" aria-hidden="true">·</span>
                  <button type="button" class="cg-btn-text" id="cgExportMdBtn">Export Markdown</button>
                </div>`
              : ''
          }
        </div>
      </div>

      <div class="cg-ledger-list">
        ${
          filtered.length > 0
            ? filtered
                .map((claim) => {
                  const isOpen = state.expandedClaimIds.has(claim.id);
                  const statusClass = claim.status.toLowerCase();
                  return `
                  <article class="cg-claim-row ${isOpen ? 'is-open' : ''}">
                    <div class="cg-claim-summary" data-toggle-claim="${escapeHtml(claim.id)}" role="button" tabindex="0">
                      <span class="cg-claim-status cg-status-${statusClass} cg-mono">
                        ${claim.status} ${claim.freshnessScore}
                      </span>
                      <span class="cg-claim-cat cg-mono">${claim.category}</span>
                      <span class="cg-claim-text">${escapeHtml(claim.claimText)}</span>
                      <span class="cg-claim-chevron" aria-hidden="true">${isOpen ? '▾' : '▸'}</span>
                    </div>
                    ${
                      isOpen
                        ? `<div class="cg-claim-detail">
                            <div class="cg-claim-compare">
                              <div class="cg-compare-col">
                                <div class="cg-compare-label">Original Unverified Claim</div>
                                <p class="${claim.status !== 'FRESH' ? 'cg-orig-stale' : ''}">${escapeHtml(claim.exactQuote || claim.claimText)}</p>
                              </div>
                              <div class="cg-compare-col">
                                <div class="cg-compare-label">Live Verified Fact</div>
                                <p class="cg-verified-fact">${escapeHtml(claim.verifiedFact)}</p>
                              </div>
                            </div>
                            <div class="cg-claim-footer">
                              <span class="cg-claim-rationale">${escapeHtml(claim.explanation)}</span>
                              <a class="cg-claim-source" href="${escapeHtml(safeUrl(claim.sourceUrl))}" target="_blank" rel="noopener noreferrer">
                                ${escapeHtml(claim.sourceTitle)} ↗
                              </a>
                            </div>
                          </div>`
                        : ''
                    }
                  </article>
                `;
                })
                .join('')
            : state.running
              ? `<div class="cg-empty">Extracting and verifying temporal claims against live web search…</div>`
              : `<div class="cg-empty">No claims audited yet. Run one of the 4 Stale Trap scenarios to populate the audit ledger.</div>`
        }
      </div>
    `;
  }

  private renderHistory(state: ChronoAppState): void {
    const history = state.history;
    if (history.length === 0) {
      this.historyMount.innerHTML = `
        <div class="cg-history-head">
          <div>
            <h3>Audit History &amp; Freshness Trend</h3>
            <p class="cg-panel-meta">Completed gateway audits persist locally for instant diff replay and score trend tracking.</p>
          </div>
        </div>
        <div class="cg-empty">Run your first verification audit to start recording temporal drift telemetry.</div>
      `;
      return;
    }

    // Build simple SVG freshness sparkline (chronological left->right)
    const chrono = [...history].reverse();
    const w = 240;
    const h = 44;
    const points = chrono
      .map((item, idx) => {
        const x =
          chrono.length === 1 ? w / 2 : (idx / (chrono.length - 1)) * (w - 16) + 8;
        const y = h - 6 - (item.overallFreshnessScore / 100) * (h - 12);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');

    this.historyMount.innerHTML = `
      <div class="cg-history-head">
        <div>
          <h3>Audit History &amp; Freshness Trend</h3>
          <p class="cg-panel-meta">${history.length} archived audits · Click any run to replay its full diff &amp; claim ledger</p>
        </div>
        <div class="cg-history-right">
          <svg class="cg-sparkline" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-label="Freshness Score Trend">
            <line x1="0" y1="${h - 6 - 0.9 * (h - 12)}" x2="${w}" y2="${h - 6 - 0.9 * (h - 12)}" stroke="rgba(16,185,129,0.28)" stroke-dasharray="3 3" />
            <polyline fill="none" stroke="#06B6D4" stroke-width="2" points="${points}" />
            ${chrono
              .map((item, idx) => {
                const x =
                  chrono.length === 1
                    ? w / 2
                    : (idx / (chrono.length - 1)) * (w - 16) + 8;
                const y = h - 6 - (item.overallFreshnessScore / 100) * (h - 12);
                const c =
                  item.overallFreshnessScore >= 90
                    ? '#10B981'
                    : item.overallFreshnessScore >= 50
                      ? '#F59E0B'
                      : '#EF4444';
                return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.2" fill="${c}" />`;
              })
              .join('')}
          </svg>
          <button type="button" class="cg-btn-text" id="cgClearHistoryBtn">Clear History</button>
        </div>
      </div>

      <div class="cg-history-grid">
        ${history
          .slice(0, 6)
          .map((item) => {
            const active = state.currentResult?.runId === item.runId;
            const tier = getScoreTier(item.overallFreshnessScore).toLowerCase();
            return `
            <button type="button" class="cg-history-item ${active ? 'is-active' : ''}" data-history-run="${escapeHtml(item.runId)}">
              <div class="cg-history-item-top">
                <span class="cg-mono cg-tier-${tier}">${item.overallFreshnessScore}/100</span>
                <span class="cg-mono cg-history-meta">${escapeHtml(item.model)} · ${item.timestamp}</span>
              </div>
              <div class="cg-history-prompt">${escapeHtml(item.prompt)}</div>
            </button>
          `;
          })
          .join('')}
      </div>
    `;
  }

  private renderTourBar(state: ChronoAppState): void {
    const step = state.guidedTourStep;
    if (step === null || state.spatialMode) {
      this.tourBarMount.hidden = true;
      return;
    }
    const meta = TOUR_STEPS[step];
    if (!meta) return;

    this.tourBarMount.hidden = false;
    this.tourBarMount.innerHTML = `
      <div class="cg-tour-inner">
        <div class="cg-tour-copy">
          <div class="cg-tour-title cg-mono">${escapeHtml(meta.title)}</div>
          <div class="cg-tour-desc">${escapeHtml(meta.desc)}</div>
        </div>
        <div class="cg-tour-actions">
          <button type="button" class="cg-btn-ghost cg-btn-sm" id="cgTourPrevBtn" ${step === 0 ? 'disabled' : ''}>Prev</button>
          <button type="button" class="cg-btn-primary cg-btn-sm" id="cgTourNextBtn">${step === TOUR_STEPS.length - 1 ? 'Finish' : 'Next'}</button>
          <button type="button" class="cg-btn-text" id="cgTourStopBtn">Close</button>
        </div>
      </div>
    `;
  }

  private renderDrawer(state: ChronoAppState): void {
    this.drawerBackdrop.hidden = !state.proxyDrawerOpen;
    if (!state.proxyDrawerOpen) return;

    const snippets = getProxySnippets(
      state.config.bifrostEndpoint,
      state.config.primaryModel
    );
    const activeCode = snippets[state.proxyLang];

    this.drawerBodyMount.innerHTML = `
      <div class="cg-drawer-tabs">
        <button type="button" class="cg-filter-btn ${state.proxyLang === 'python' ? 'is-active' : ''}" data-proxy-lang="python">Python (OpenAI SDK)</button>
        <button type="button" class="cg-filter-btn ${state.proxyLang === 'typescript' ? 'is-active' : ''}" data-proxy-lang="typescript">TypeScript</button>
        <button type="button" class="cg-filter-btn ${state.proxyLang === 'curl' ? 'is-active' : ''}" data-proxy-lang="curl">cURL / Bifrost</button>
        <button type="button" class="cg-btn-primary cg-btn-sm cg-copy-btn" id="cgCopySnippetBtn">
          ${this.copied ? 'Copied' : 'Copy Snippet'}
        </button>
      </div>

      <pre class="cg-code-block"><code>${escapeHtml(activeCode)}</code></pre>

      <div class="cg-drawer-notes">
        <h4>How Drop-In Self-Healing Works</h4>
        <ol>
          <li><strong>Zero Code Changes:</strong> Swap only <code>base_url</code> to your Bifrost / ChronoGate endpoint.</li>
          <li><strong>Semantic Cache Hit:</strong> Repeated prompts short-circuit Stage 1 generation and cut inference cost.</li>
          <li><strong>Surgical Grounding:</strong> Temporal claims below threshold <code>${state.config.freshnessThreshold}</code> are patched inline with verified URLs before returning to your agent.</li>
        </ol>
      </div>
    `;
  }

  private renderDemoModal(state: ChronoAppState): void {
    this.demoModalBackdrop.hidden = !state.demoStudioOpen;
    if (!state.demoStudioOpen) return;

    const hasResult = Boolean(state.currentResult?.verifiedClaims.length);

    this.demoModalBodyMount.innerHTML = `
      <div class="cg-demo-actions-grid">
        <div class="cg-demo-option">
          <h3>Export 720p Narrated Demo Video (.webm)</h3>
          <p>Encodes an 18-second, 5-scene HD product walkthrough directly in your browser using your live ChronoGate telemetry, diff, claim ledger, and Drop-In SDK snippet.</p>
          <div class="cg-demo-btn-row">
            <button type="button" class="cg-btn-primary" id="cgRenderVideoBtn" ${this.videoRendering ? 'disabled' : ''}>
              ${this.videoRendering ? 'Rendering Video…' : hasResult ? 'Generate Video from Current Audit' : 'Generate Quick Demo Video'}
            </button>
            <button type="button" class="cg-btn-secondary" id="cgAuditAndRenderVideoBtn" ${this.videoRendering ? 'disabled' : ''}>
              Run Fresh Live Audit + Record Video
            </button>
          </div>
        </div>

        <div class="cg-demo-option">
          <h3>Interactive Live Guided Tour</h3>
          <p>Walks through the live dashboard step-by-step with synchronized narration banners, auto-running a real Stale Trap audit and highlighting every control.</p>
          <div class="cg-demo-btn-row">
            <button type="button" class="cg-btn-secondary" id="cgStartGuidedTourBtn" ${this.videoRendering ? 'disabled' : ''}>
              Start 5-Step Live Guided Tour
            </button>
          </div>
        </div>
      </div>

      ${
        this.videoRendering
          ? `<div class="cg-video-progress-box">
              <div class="cg-mono cg-video-progress-label" id="cgVideoProgressLabel">${escapeHtml(this.videoStageLabel)} (${this.videoProgress}%)</div>
              <div class="cg-video-progress-track">
                <div class="cg-video-progress-fill" id="cgVideoProgressFill" style="width:${this.videoProgress}%"></div>
              </div>
            </div>`
          : ''
      }

      ${
        this.videoError
          ? `<div class="cg-error-banner">${escapeHtml(this.videoError)}</div>`
          : ''
      }

      ${
        this.videoArtifact
          ? `<div class="cg-video-preview-wrap">
              <div class="cg-video-preview-head">
                <span class="cg-mono cg-val-emerald">Ready · 1280×720 · ${this.videoArtifact.durationSec}s · ${(this.videoArtifact.blob.size / (1024 * 1024)).toFixed(2)} MB</span>
                <a
                  href="${this.videoArtifact.url}"
                  download="chronogate-demo.webm"
                  class="cg-btn-primary cg-btn-sm cg-download-link"
                >
                  Download chronogate-demo.webm
                </a>
              </div>
              <video class="cg-demo-video" src="${this.videoArtifact.url}" controls autoplay loop playsinline></video>
            </div>`
          : ''
      }
    `;
  }

  dispose(): void {
    this.unsubscribe?.();
    window.clearTimeout(this.copyResetTimer);
    if (this.videoArtifact) {
      URL.revokeObjectURL(this.videoArtifact.url);
    }
  }
}
