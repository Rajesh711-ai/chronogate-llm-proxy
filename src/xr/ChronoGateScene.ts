import * as THREE from 'three';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import * as xb from 'xrblocks';

import {STALE_TRAP_PRESETS} from '../constants.ts';
import {chronoStore} from '../state/ChronoStore.ts';
import type {ChronoAppState} from '../types.ts';
import {ClaimOrbitRig} from './ClaimOrbitRig.ts';
import {ChronoCoreRig} from './ChronoCoreRig.ts';
import {PipelineConduitRig} from './PipelineConduitRig.ts';

function truncateSpatial(text: string, maxChars: number): string {
  const clean = text.replace(/\[\[([^|\]]+)\|[^\]]+\]\]/g, '[$1]').trim();
  if (clean.length <= maxChars) return clean;
  return clean.slice(0, maxChars - 1) + '…';
}

export class ChronoGateScene extends xb.Script {
  private coreRig?: ChronoCoreRig;
  private orbitRig?: ClaimOrbitRig;
  private pipelineRig?: PipelineConduitRig;
  private envRT?: THREE.WebGLRenderTarget;
  private unsubscribe?: () => void;
  private elapsed = 0;

  // Retained XR UI references for direct property updates
  private scoreText?: xb.UIText;
  private statsText?: xb.UIText;
  private pipelineStatusText?: xb.UIText;
  private autoHealBtn?: xb.UIButton;
  private rawOutputText?: xb.UIText;
  private rawSubtitleText?: xb.UIText;
  private healedOutputText?: xb.UIText;
  private ledgerText?: xb.UIText;
  private presetButtons: xb.UIButton[] = [];

  init() {
    this.setupAtmosphereAndLights();

    // 3D ChronoGate Freshness Reactor centered slightly below eye line
    this.coreRig = new ChronoCoreRig();
    this.coreRig.position.set(0, 0.72, -1.45);
    this.add(this.coreRig);

    // 3D Orbital Claim Satellites around the core crystal
    this.orbitRig = new ClaimOrbitRig();
    this.orbitRig.position.set(0, 1.06, -1.45);
    this.add(this.orbitRig);

    // 3D 3-Stage Pipeline Conduit Arc right in front of reactor
    this.pipelineRig = new PipelineConduitRig();
    this.pipelineRig.position.set(0, 0.72, -1.22);
    this.add(this.pipelineRig);

    // Build 3 ergonomic world-space XR Blocks UICards
    this.buildSpatialCards();

    // Subscribe to reactive ChronoStore so 2D and XR stay synchronized
    this.unsubscribe = chronoStore.subscribe((state) => {
      this.syncFromState(state);
    });
  }

  private setupAtmosphereAndLights() {
    const scene = xb.core.scene;
    const renderer = xb.core.renderer;

    if (scene && renderer instanceof THREE.WebGLRenderer) {
      scene.background = new THREE.Color(0x0b0f19);
      scene.fog = new THREE.FogExp2(0x0b0f19, 0.11);

      const pmrem = new THREE.PMREMGenerator(renderer);
      this.envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
      scene.environment = this.envRT.texture;
      pmrem.dispose();
    } else if (scene) {
      scene.background = new THREE.Color(0x0b0f19);
      scene.fog = new THREE.FogExp2(0x0b0f19, 0.11);
    }

    // Cool sky/ground hemisphere fill
    this.add(new THREE.HemisphereLight(0xcbe8ff, 0x0f172a, 1.8));

    // Warm key light
    const keyLight = new THREE.DirectionalLight(0xfff4e6, 2.2);
    keyLight.position.set(2.5, 4.2, 2.0);
    this.add(keyLight);

    // Cyan rim accent
    const rimLight = new THREE.DirectionalLight(0x06b6d4, 1.4);
    rimLight.position.set(-2.8, 2.4, -2.5);
    this.add(rimLight);
  }

  private buildSpatialCards() {
    // 1. CENTER SPATIAL CARD: ChronoGate Telemetry & 4 Stale Trap Presets
    this.scoreText = new xb.UIText({
      text: 'FRESHNESS -- / 100',
      style: {
        fontSize: 28,
        fontWeight: 'bold',
        color: '#06b6d4',
        textAlign: 'center',
      },
    });
    this.statsText = new xb.UIText({
      text: 'Claims Audited: 0  ·  Patched: 0  ·  Savings: $0.0184',
      style: {
        fontSize: 14,
        color: '#cbd5e1',
        textAlign: 'center',
      },
    });
    this.pipelineStatusText = new xb.UIText({
      text: 'Stage 1: Ready  |  Stage 2: Ready  |  Stage 3: Ready',
      style: {
        fontSize: 13,
        color: '#94a3b8',
        textAlign: 'center',
        padding: 10,
        backgroundColor: 'rgba(15, 23, 42, 0.85)',
        borderRadius: 10,
      },
    });

    this.presetButtons = STALE_TRAP_PRESETS.map(
      (preset) =>
        new xb.UIButton({
          label: preset.shortLabel,
          icon: 'bolt',
          style: {width: '100%'},
          onClick: () => {
            void chronoStore.runPreset(preset.id);
          },
        })
    );

    this.autoHealBtn = new xb.UIButton({
      label: 'Auto-Heal: ON',
      icon: 'verified_user',
      style: {width: '100%'},
      onClick: () => {
        const current = chronoStore.getState().config.autoHeal;
        chronoStore.updateConfig({autoHeal: !current});
      },
    });

    const centerCard = new xb.UICard({
      size: {width: 0.64, height: 'auto'},
      manipulation: true,
      edge: true,
      style: {
        flexDirection: 'column',
        gap: 12,
        padding: 20,
        backgroundColor: 'rgba(11, 15, 25, 0.92)',
        borderRadius: 20,
      },
      children: [
        new xb.UIPanel({
          style: {
            width: '100%',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
          },
          children: [
            new xb.UIIcon({
              icon: 'shield',
              style: {width: 28, height: 28, color: '#06b6d4'},
            }),
            new xb.UIText({
              text: 'ChronoGate Spatial Gateway',
              style: {fontSize: 22, fontWeight: 'bold', color: '#f8fafc'},
            }),
          ],
        }),
        this.scoreText,
        this.statsText,
        this.pipelineStatusText,
        new xb.UIText({
          text: 'Select a Stale Trap Preset to Audit Live:',
          style: {fontSize: 14, color: '#94a3b8', textAlign: 'center'},
        }),
        ...this.presetButtons,
        this.autoHealBtn,
      ],
    });
    centerCard.name = 'ChronoGate Spatial Control Card';
    centerCard.position.set(0, 1.56, -1.45);
    this.add(centerCard);

    // 2. LEFT SPATIAL CARD: Raw Unverified Output
    this.rawSubtitleText = new xb.UIText({
      text: 'Ungrounded Bifrost Route',
      style: {fontSize: 13, color: '#f59e0b'},
    });
    this.rawOutputText = new xb.UIText({
      text: 'Run any Stale Trap preset to inspect frozen-cutoff model output.',
      style: {
        width: '100%',
        fontSize: 15,
        lineHeight: 1.4,
        color: '#e2e8f0',
        whiteSpace: 'pre-line',
      },
    });

    const leftCard = new xb.UICard({
      size: {width: 0.58, height: 0.56},
      manipulation: true,
      edge: true,
      style: {
        flexDirection: 'column',
        gap: 12,
        padding: 18,
        backgroundColor: 'rgba(17, 24, 39, 0.92)',
        borderRadius: 20,
      },
      children: [
        new xb.UIText({
          text: 'Raw Unverified Output',
          style: {fontSize: 20, fontWeight: 'bold', color: '#f87171'},
        }),
        this.rawSubtitleText,
        new xb.UIScrollView({
          ariaLabel: 'Raw unverified LLM response',
          style: {flexGrow: 1, flexBasis: 0, minHeight: 140},
          children: [this.rawOutputText],
        }),
      ],
    });
    leftCard.name = 'Raw Unverified Output Card';
    leftCard.position.set(-0.68, 1.52, -1.32);
    leftCard.rotation.y = 0.28;
    this.add(leftCard);

    // 3. RIGHT SPATIAL CARD: ChronoGate Healed Output & Audit Ledger
    this.healedOutputText = new xb.UIText({
      text: 'Live-verified response with patched claims will appear here.',
      style: {
        width: '100%',
        fontSize: 15,
        lineHeight: 1.4,
        color: '#ecfdf5',
        whiteSpace: 'pre-line',
      },
    });
    this.ledgerText = new xb.UIText({
      text: 'Audit Ledger: Awaiting temporal extraction.',
      style: {
        width: '100%',
        fontSize: 13,
        lineHeight: 1.35,
        color: '#94a3b8',
        whiteSpace: 'pre-line',
      },
    });

    const rightCard = new xb.UICard({
      size: {width: 0.58, height: 0.56},
      manipulation: true,
      edge: true,
      style: {
        flexDirection: 'column',
        gap: 12,
        padding: 18,
        backgroundColor: 'rgba(17, 24, 39, 0.92)',
        borderRadius: 20,
      },
      children: [
        new xb.UIText({
          text: 'ChronoGate Healed Output',
          style: {fontSize: 20, fontWeight: 'bold', color: '#10b981'},
        }),
        new xb.UIScrollView({
          ariaLabel: 'Healed response and audit ledger',
          style: {flexGrow: 1, flexBasis: 0, minHeight: 140, gap: 12},
          children: [this.healedOutputText, this.ledgerText],
        }),
      ],
    });
    rightCard.name = 'ChronoGate Healed Output Card';
    rightCard.position.set(0.68, 1.52, -1.32);
    rightCard.rotation.y = -0.28;
    this.add(rightCard);
  }

  private syncFromState(state: ChronoAppState) {
    const result = state.currentResult;
    const t = state.telemetry;
    const hasVerified = Boolean(result && result.verifiedClaims.length > 0);

    this.coreRig?.setTelemetry(
      result?.overallFreshnessScore ?? 0,
      state.running,
      hasVerified
    );
    this.orbitRig?.setClaims(result?.verifiedClaims ?? []);
    this.pipelineRig?.setStageStates(t.stage1, t.stage2, t.stage3);

    if (this.scoreText) {
      if (state.running) {
        this.scoreText.text = 'AUDITING LIVE WEB…';
        this.scoreText.style.color = '#06b6d4';
      } else if (hasVerified && result) {
        this.scoreText.text = `FRESHNESS ${result.overallFreshnessScore} / 100`;
        this.scoreText.style.color =
          result.overallFreshnessScore >= 90
            ? '#10b981'
            : result.overallFreshnessScore >= 50
              ? '#f59e0b'
              : '#ef4444';
      } else {
        this.scoreText.text = 'FRESHNESS -- / 100';
        this.scoreText.style.color = '#06b6d4';
      }
    }

    if (this.statsText) {
      this.statsText.text = `Claims: ${result?.claimsAudited ?? 0}  ·  Patched: ${result?.stalePatched ?? 0}  ·  Saved: $${state.cumulativeSavingsUsd.toFixed(4)}`;
    }

    if (this.pipelineStatusText) {
      const fmt = (s: string, ms: number) =>
        s === 'complete' ? `OK (${ms}ms)` : s === 'running' ? 'ACTIVE…' : s.toUpperCase();
      this.pipelineStatusText.text = `1. Bifrost: ${fmt(t.stage1, t.stage1Ms)}  |  2. Extract: ${fmt(t.stage2, t.stage2Ms)}  |  3. Ground: ${fmt(t.stage3, t.stage3Ms)}`;
    }

    if (this.autoHealBtn) {
      this.autoHealBtn.label = state.config.autoHeal
        ? 'Auto-Heal: ON'
        : 'Auto-Heal: OFF';
    }

    for (const btn of this.presetButtons) {
      btn.disabled = state.running;
    }

    if (this.rawSubtitleText) {
      this.rawSubtitleText.text = t.routeUsed;
    }

    if (this.rawOutputText) {
      if (result?.rawOutput) {
        this.rawOutputText.text = truncateSpatial(result.rawOutput, 520);
      } else if (state.running) {
        this.rawOutputText.text = 'Generating initial ungrounded draft via Bifrost…';
      } else {
        this.rawOutputText.text =
          'Run any Stale Trap preset to inspect frozen-cutoff model output.';
      }
    }

    if (this.healedOutputText) {
      if (result?.healedOutput) {
        this.healedOutputText.text = truncateSpatial(result.healedOutput, 460);
      } else if (state.running) {
        this.healedOutputText.text =
          'Running live Google Search Grounding & surgical claim healing…';
      } else {
        this.healedOutputText.text =
          'Live-verified response with patched claims will appear here.';
      }
    }

    if (this.ledgerText) {
      if (result && result.verifiedClaims.length > 0) {
        const lines = result.verifiedClaims
          .slice(0, 5)
          .map(
            (c) =>
              `[${c.status} ${c.freshnessScore}] (${c.category}) ${truncateSpatial(c.verifiedFact, 96)}`
          );
        this.ledgerText.text = `CLAIM LEDGER\n${lines.join('\n')}`;
      } else {
        this.ledgerText.text = 'Audit Ledger: Awaiting temporal extraction.';
      }
    }
  }

  onXRSessionStarted() {
    chronoStore.setSpatialMode(true);
  }

  onSimulatorStarted() {
    chronoStore.setSpatialMode(true);
  }

  update() {
    const dt = xb.getDeltaTime() || 0.016;
    this.elapsed += dt;
    this.coreRig?.update(dt, this.elapsed);
    this.orbitRig?.update(dt, this.elapsed);
    this.pipelineRig?.update(dt, this.elapsed);
  }

  dispose() {
    this.unsubscribe?.();
    this.coreRig?.dispose();
    this.orbitRig?.dispose();
    this.pipelineRig?.dispose();
    this.envRT?.dispose();
  }
}
