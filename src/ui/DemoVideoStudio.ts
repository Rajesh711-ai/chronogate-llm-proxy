import {getProxySnippets} from '../constants.ts';
import type {AuditRunResult, GatewayConfig, VerifiedClaim} from '../types.ts';

export interface DemoRenderOptions {
  result: AuditRunResult | null;
  config: GatewayConfig;
  cumulativeSavingsUsd: number;
  onProgress: (percent: number, stageLabel: string) => void;
}

export interface DemoVideoArtifact {
  blob: Blob;
  url: string;
  durationSec: number;
  mimeType: string;
}

const WIDTH = 1280;
const HEIGHT = 720;
const FPS = 30;
const TOTAL_SECONDS = 18;

function pickMimeType(): string {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  for (const type of candidates) {
    if (
      typeof MediaRecorder !== 'undefined' &&
      MediaRecorder.isTypeSupported(type)
    ) {
      return type;
    }
  }
  return 'video/webm';
}

function easeOutCubic(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return 1 - Math.pow(1 - c, 3);
}

function wrapLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number
): string[] {
  const clean = text
    .replace(/\[\[([^|\]]+)\|[^\]]+\]\]/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  const words = clean.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
      if (lines.length >= maxLines) break;
    } else {
      line = test;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines && words.length > 0) {
    const last = lines[maxLines - 1];
    if (last.length > 3 && !clean.endsWith(last)) {
      lines[maxLines - 1] = last.slice(0, Math.max(0, last.length - 1)) + '…';
    }
  }
  return lines;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawGridBackground(ctx: CanvasRenderingContext2D, t: number) {
  ctx.fillStyle = '#0B0F19';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Subtle dark slate radial gradient
  const grad = ctx.createRadialGradient(
    WIDTH * 0.5,
    HEIGHT * 0.32,
    40,
    WIDTH * 0.5,
    HEIGHT * 0.5,
    760
  );
  grad.addColorStop(0, 'rgba(6, 182, 212, 0.11)');
  grad.addColorStop(0.55, 'rgba(16, 185, 129, 0.04)');
  grad.addColorStop(1, 'rgba(11, 15, 25, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Subtle technical grid
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.06)';
  ctx.lineWidth = 1;
  const shift = (t * 14) % 48;
  for (let x = shift; x < WIDTH; x += 48) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, HEIGHT);
    ctx.stroke();
  }
  for (let y = 0; y < HEIGHT; y += 48) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(WIDTH, y);
    ctx.stroke();
  }
}

function drawCaptionBar(
  ctx: CanvasRenderingContext2D,
  caption: string,
  progress01: number
) {
  // Bottom narration bar
  ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
  ctx.fillRect(0, HEIGHT - 66, WIDTH, 66);
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.18)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, HEIGHT - 66);
  ctx.lineTo(WIDTH, HEIGHT - 66);
  ctx.stroke();

  // Progress hairline
  ctx.fillStyle = '#1E293B';
  ctx.fillRect(0, HEIGHT - 4, WIDTH, 4);
  ctx.fillStyle = '#06B6D4';
  ctx.fillRect(0, HEIGHT - 4, WIDTH * progress01, 4);

  // Caption text
  ctx.fillStyle = '#F1F5F9';
  ctx.font = '500 20px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(caption, WIDTH / 2, HEIGHT - 35);
}

function drawTopBrand(ctx: CanvasRenderingContext2D, sceneLabel: string) {
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#06B6D4';
  ctx.font = '700 22px "Outfit", system-ui, sans-serif';
  ctx.fillText('ChronoGate', 48, 42);

  ctx.fillStyle = '#64748B';
  ctx.font = '500 15px "JetBrains Mono", monospace';
  ctx.fillText(`  /  ${sceneLabel}`, 176, 42);

  ctx.textAlign = 'right';
  ctx.fillStyle = '#10B981';
  ctx.font = '600 14px "JetBrains Mono", monospace';
  ctx.fillText('GATEWAY ACTIVE · LIVE GROUNDING', WIDTH - 48, 42);
}

function drawFallbackClaims(): VerifiedClaim[] {
  return [
    {
      id: 'CLM-1',
      category: 'API_VERSION',
      claimText: 'React 18.2 is the latest stable version; React 19 is unreleased.',
      exactQuote: 'React 18.2 is the latest stable version',
      temporalSensitivity: 'high',
      reason: 'Major framework release cycle',
      freshnessScore: 22,
      status: 'STALE',
      verifiedFact: 'React 19 is stably released with Actions, useActionState, and Server Actions.',
      patchReplacement: 'React 19 stable',
      sourceTitle: 'react.dev',
      sourceUrl: 'https://react.dev',
      explanation: 'Superseded by React 19 stable release.',
      patched: true,
    },
    {
      id: 'CLM-2',
      category: 'PRICING',
      claimText: 'Flagship API pricing remains $10/$30 per 1M tokens.',
      exactQuote: '$10 per million input tokens',
      temporalSensitivity: 'high',
      reason: 'Frequent LLM provider price reductions',
      freshnessScore: 34,
      status: 'STALE',
      verifiedFact: 'Modern flagship flash & mini tiers dropped 70–90% in per-million token pricing.',
      patchReplacement: 'updated 2025/2026 API pricing tiers',
      sourceTitle: 'ai.google.dev',
      sourceUrl: 'https://ai.google.dev/pricing',
      explanation: 'Provider pricing sheets changed significantly since early 2024.',
      patched: true,
    },
    {
      id: 'CLM-3',
      category: 'REGULATION',
      claimText: 'EU AI Act prohibited practices are not yet enforceable.',
      exactQuote: 'not yet enforceable in the EU',
      temporalSensitivity: 'high',
      reason: 'Phased statutory enforcement milestones',
      freshnessScore: 18,
      status: 'STALE',
      verifiedFact: 'Prohibited AI practices took effect Feb 2025 and GPAI rules took effect Aug 2025.',
      patchReplacement: 'enforced since February & August 2025',
      sourceTitle: 'digital-strategy.ec.europa.eu',
      sourceUrl: 'https://digital-strategy.ec.europa.eu',
      explanation: 'Enforcement deadlines have already passed.',
      patched: true,
    },
  ];
}

function drawFrame(
  ctx: CanvasRenderingContext2D,
  t: number,
  opts: DemoRenderOptions
) {
  const progress01 = Math.min(1, t / TOTAL_SECONDS);
  drawGridBackground(ctx, t);

  const res = opts.result;
  const claims =
    res && res.verifiedClaims.length > 0
      ? res.verifiedClaims
      : drawFallbackClaims();
  const score = res ? res.overallFreshnessScore : 28;
  const audited = res ? res.claimsAudited : claims.length;
  const patched = res ? res.stalePatched : claims.filter((c) => c.patched).length;
  const rawSample =
    res?.rawOutput ||
    'React 18.2 is currently the latest stable release while React 19 remains experimental. Next.js 14.1 is the newest production release, and GPT-4 Turbo API pricing stands at $10 input / $30 output per million tokens.';
  const healedSample =
    res?.healedOutput ||
    '[[React 19 is stably released|CLM-1]] alongside modern [[Next.js 15/16 stable releases|CLM-2]] with async request APIs and Turbopack improvements, while flagship token pricing has [[dropped dramatically across Gemini, OpenAI, and Anthropic tiers|CLM-3]].';

  // SCENE 1 (0 - 3.2s): Hero Intro & Problem Statement
  if (t < 3.2) {
    const p = easeOutCubic(t / 1.1);

    // Animated kinetic shield + clock emblem
    const cx = WIDTH / 2;
    const cy = 225;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = 'rgba(6, 182, 212, 0.32)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 74 + Math.sin(t * 3) * 3, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = '#06B6D4';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, 0, 54, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p);
    ctx.stroke();

    // Clock hands
    ctx.strokeStyle = '#10B981';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -28);
    ctx.moveTo(0, 0);
    ctx.lineTo(22 * Math.cos(t * 2.4), 22 * Math.sin(t * 2.4));
    ctx.stroke();
    ctx.restore();

    ctx.globalAlpha = p;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#F8FAFC';
    ctx.font = '700 64px "Outfit", system-ui, sans-serif';
    ctx.fillText('ChronoGate', cx, 360);

    ctx.fillStyle = '#06B6D4';
    ctx.font = '600 24px "Plus Jakarta Sans", system-ui, sans-serif';
    ctx.fillText(
      'Real-Time LLM Freshness Verification & Self-Healing Gateway',
      cx,
      415
    );

    ctx.fillStyle = '#94A3B8';
    ctx.font = '400 20px "Plus Jakarta Sans", system-ui, sans-serif';
    ctx.fillText(
      'Bifrost AI Routing  ·  Structured Temporal Claim Audit  ·  Live Web Grounding  ·  XR Spatial Telemetry',
      cx,
      468
    );
    ctx.globalAlpha = 1;

    drawCaptionBar(
      ctx,
      '1/5 — Frozen LLM weights silently hallucinate outdated APIs, token pricing, and regulations.',
      progress01
    );
    return;
  }

  // SCENE 2 (3.2 - 7.2s): 3-Stage Verification Pipeline
  if (t < 7.2) {
    const local = t - 3.2;
    drawTopBrand(ctx, '02 · 3-STAGE VERIFICATION PIPELINE');

    ctx.textAlign = 'left';
    ctx.fillStyle = '#F1F5F9';
    ctx.font = '700 34px "Outfit", system-ui, sans-serif';
    ctx.fillText('Real-Time Self-Healing Pipeline', 56, 118);

    ctx.fillStyle = '#94A3B8';
    ctx.font = '400 18px "Plus Jakarta Sans", system-ui, sans-serif';
    ctx.fillText(
      `Model Route: ${opts.config.primaryModel}   ·   Policy Threshold: ${opts.config.freshnessThreshold}/100   ·   Auto-Heal: ${opts.config.autoHeal ? 'ON' : 'OFF'}`,
      56,
      152
    );

    const stages = [
      {
        num: '01',
        title: 'Bifrost Route',
        desc: 'Generates initial draft & checks semantic cache for routing savings.',
        stat: res ? `${Math.round(res.totalLatencyMs * 0.28)}ms` : '420ms',
        activeAt: 0.2,
      },
      {
        num: '02',
        title: 'Claim Extractor',
        desc: 'Strict JSON schema isolates PRICING, API_VERSION, REGULATION & COMPANY facts.',
        stat: `${audited} claims`,
        activeAt: 1.3,
      },
      {
        num: '03',
        title: 'Live Grounding',
        desc: 'Google Search + Tavily proxy verifies live web facts & patches stale text.',
        stat: `${patched} patched`,
        activeAt: 2.4,
      },
    ];

    const cardW = 340;
    const cardH = 260;
    const startX = 56;
    const gap = 74;
    const cardY = 230;

    for (let i = 0; i < 3; i++) {
      const s = stages[i];
      const x = startX + i * (cardW + gap);
      const stageP = easeOutCubic((local - s.activeAt) / 0.8);
      const done = local > s.activeAt + 0.7;

      roundRect(ctx, x, cardY, cardW, cardH, 16);
      ctx.fillStyle = '#111827';
      ctx.fill();
      ctx.strokeStyle = done
        ? '#10B981'
        : stageP > 0
          ? '#06B6D4'
          : 'rgba(148,163,184,0.2)';
      ctx.lineWidth = done || stageP > 0 ? 2.5 : 1.2;
      ctx.stroke();

      ctx.textAlign = 'left';
      ctx.fillStyle = done ? '#10B981' : '#06B6D4';
      ctx.font = '700 18px "JetBrains Mono", monospace';
      ctx.fillText(`STAGE ${s.num}`, x + 24, cardY + 38);

      ctx.fillStyle = '#F8FAFC';
      ctx.font = '700 24px "Outfit", system-ui, sans-serif';
      ctx.fillText(s.title, x + 24, cardY + 76);

      ctx.fillStyle = '#CBD5E1';
      ctx.font = '400 16px "Plus Jakarta Sans", system-ui, sans-serif';
      const lines = wrapLines(ctx, s.desc, cardW - 48, 3);
      lines.forEach((ln, idx) => ctx.fillText(ln, x + 24, cardY + 120 + idx * 24));

      // Progress bar
      ctx.fillStyle = '#1E293B';
      roundRect(ctx, x + 24, cardY + 206, cardW - 48, 8, 4);
      ctx.fill();
      ctx.fillStyle = done ? '#10B981' : '#06B6D4';
      roundRect(ctx, x + 24, cardY + 206, (cardW - 48) * stageP, 8, 4);
      ctx.fill();

      ctx.fillStyle = done ? '#10B981' : '#94A3B8';
      ctx.font = '600 15px "JetBrains Mono", monospace';
      ctx.fillText(
        done ? `VERIFIED · ${s.stat}` : stageP > 0 ? 'EXECUTING…' : 'STANDBY',
        x + 24,
        cardY + 236
      );

      // Connecting beam + traveling data packet
      if (i < 2) {
        const bx1 = x + cardW + 8;
        const bx2 = x + cardW + gap - 8;
        const by = cardY + cardH / 2;
        ctx.strokeStyle = done ? '#10B981' : 'rgba(148,163,184,0.28)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(bx1, by);
        ctx.lineTo(bx2, by);
        ctx.stroke();

        if (stageP > 0.2) {
          const pktX = bx1 + ((local * 1.4) % 1) * (bx2 - bx1);
          ctx.fillStyle = '#22D3EE';
          ctx.beginPath();
          ctx.arc(pktX, by, 6, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    drawCaptionBar(
      ctx,
      '2/5 — Every prompt runs through Bifrost routing, structured JSON claim extraction, and live web grounding.',
      progress01
    );
    return;
  }

  // SCENE 3 (7.2 - 11.6s): Split-Screen Diff & Radial Freshness Gauge
  if (t < 11.6) {
    const local = t - 7.2;
    const p = easeOutCubic(local / 1.1);
    drawTopBrand(ctx, '03 · SPLIT-SCREEN DIFF & FRESHNESS TELEMETRY');

    // Top KPI Ribbon with Radial Gauge
    const gCx = 128;
    const gCy = 152;
    const gR = 48;
    const animatedScore = Math.round(score * p);
    const gaugeColor =
      score >= 90 ? '#10B981' : score >= 50 ? '#F59E0B' : '#EF4444';

    ctx.strokeStyle = '#1E293B';
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.arc(gCx, gCy, gR, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = gaugeColor;
    ctx.lineWidth = 10;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(
      gCx,
      gCy,
      gR,
      -Math.PI / 2,
      -Math.PI / 2 + Math.PI * 2 * (animatedScore / 100)
    );
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.fillStyle = '#F8FAFC';
    ctx.font = '700 30px "JetBrains Mono", monospace';
    ctx.fillText(`${animatedScore}`, gCx, gCy + 2);

    ctx.textAlign = 'left';
    ctx.fillStyle = '#94A3B8';
    ctx.font = '600 14px "Plus Jakarta Sans", sans-serif';
    ctx.fillText('OVERALL FRESHNESS', 200, 128);
    ctx.fillStyle = gaugeColor;
    ctx.font = '700 26px "JetBrains Mono", monospace';
    ctx.fillText(
      score >= 90 ? 'FRESH' : score >= 50 ? 'AGING' : 'STALE DRIFT DETECTED',
      200,
      160
    );

    // Additional KPIs
    const kpis = [
      {label: 'CLAIMS AUDITED', val: `${audited}`, color: '#F1F5F9', x: 560},
      {label: 'STALE PATCHED', val: `${patched}`, color: '#10B981', x: 780},
      {
        label: 'CACHE SAVINGS',
        val: `$${opts.cumulativeSavingsUsd.toFixed(4)}`,
        color: '#06B6D4',
        x: 990,
      },
    ];
    for (const k of kpis) {
      ctx.fillStyle = '#94A3B8';
      ctx.font = '600 13px "Plus Jakarta Sans", sans-serif';
      ctx.fillText(k.label, k.x, 128);
      ctx.fillStyle = k.color;
      ctx.font = '700 28px "JetBrains Mono", monospace';
      ctx.fillText(k.val, k.x, 162);
    }

    // Left panel: Raw Output
    roundRect(ctx, 56, 230, 568, 380, 14);
    ctx.fillStyle = '#111827';
    ctx.fill();
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.45)';
    ctx.lineWidth = 1.6;
    ctx.stroke();

    ctx.fillStyle = '#F87171';
    ctx.font = '700 18px "Outfit", system-ui, sans-serif';
    ctx.fillText('Raw Unverified Output (Frozen Weights)', 82, 266);

    ctx.fillStyle = '#FCA5A5';
    ctx.font = '400 18px "Plus Jakarta Sans", system-ui, sans-serif';
    const rawLines = wrapLines(ctx, rawSample, 516, 8);
    rawLines.forEach((ln, idx) => {
      const y = 314 + idx * 32;
      ctx.fillText(ln, 82, y);
      // Red strikethrough accent on first two lines to emphasize stale phrases
      if (idx < 2) {
        const w = ctx.measureText(ln).width;
        ctx.strokeStyle = 'rgba(239, 68, 68, 0.75)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(82, y);
        ctx.lineTo(82 + w * p, y);
        ctx.stroke();
      }
    });

    // Right panel: Healed Output
    roundRect(ctx, 656, 230, 568, 380, 14);
    ctx.fillStyle = '#111827';
    ctx.fill();
    ctx.strokeStyle = 'rgba(16, 185, 129, 0.55)';
    ctx.lineWidth = 1.8;
    ctx.stroke();

    ctx.fillStyle = '#10B981';
    ctx.font = '700 18px "Outfit", system-ui, sans-serif';
    ctx.fillText('ChronoGate Healed Output (Live Grounded)', 682, 266);

    ctx.fillStyle = '#A7F3D0';
    ctx.font = '500 18px "Plus Jakarta Sans", system-ui, sans-serif';
    const healedLines = wrapLines(ctx, healedSample, 516, 8);
    healedLines.forEach((ln, idx) => {
      ctx.fillText(ln, 682, 314 + idx * 32);
    });

    ctx.fillStyle = '#06B6D4';
    ctx.font = '600 14px "JetBrains Mono", monospace';
    ctx.fillText('[Verified Source]  Inline citations attached automatically', 682, 578);

    drawCaptionBar(
      ctx,
      '3/5 — Stale facts are struck through on the left and surgically patched with live citations on the right.',
      progress01
    );
    return;
  }

  // SCENE 4 (11.6 - 15.2s): Claim-by-Claim Audit Ledger
  if (t < 15.2) {
    const local = t - 11.6;
    drawTopBrand(ctx, '04 · CLAIM-BY-CLAIM AUDIT LEDGER');

    ctx.textAlign = 'left';
    ctx.fillStyle = '#F8FAFC';
    ctx.font = '700 32px "Outfit", system-ui, sans-serif';
    ctx.fillText('Forensic Claim Audit Ledger', 56, 114);

    const visibleClaims = claims.slice(0, 4);
    visibleClaims.forEach((c, idx) => {
      const rowP = easeOutCubic((local - idx * 0.25) / 0.55);
      const y = 154 + idx * 116;
      const offsetX = (1 - rowP) * 36;

      ctx.globalAlpha = rowP;
      roundRect(ctx, 56 + offsetX, y, WIDTH - 112, 98, 12);
      ctx.fillStyle = '#111827';
      ctx.fill();
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.22)';
      ctx.lineWidth = 1.2;
      ctx.stroke();

      const badgeColor =
        c.status === 'FRESH'
          ? '#10B981'
          : c.status === 'AGING'
            ? '#F59E0B'
            : '#EF4444';

      ctx.fillStyle = badgeColor;
      ctx.font = '700 16px "JetBrains Mono", monospace';
      ctx.fillText(`${c.status} ${c.freshnessScore}`, 80 + offsetX, y + 32);

      ctx.fillStyle = '#06B6D4';
      ctx.font = '600 14px "JetBrains Mono", monospace';
      ctx.fillText(c.category, 210 + offsetX, y + 32);

      ctx.fillStyle = '#E2E8F0';
      ctx.font = '600 17px "Plus Jakarta Sans", sans-serif';
      const titleLine = wrapLines(ctx, c.claimText, 760, 1)[0] || c.claimText;
      ctx.fillText(titleLine, 350 + offsetX, y + 32);

      ctx.fillStyle = '#A7F3D0';
      ctx.font = '400 15px "Plus Jakarta Sans", sans-serif';
      const factLine = wrapLines(ctx, `Verified: ${c.verifiedFact}`, 880, 1)[0];
      ctx.fillText(factLine, 80 + offsetX, y + 68);

      ctx.textAlign = 'right';
      ctx.fillStyle = '#38BDF8';
      ctx.font = '500 14px "JetBrains Mono", monospace';
      ctx.fillText(c.sourceTitle.slice(0, 28), WIDTH - 80 + offsetX, y + 68);
      ctx.textAlign = 'left';
      ctx.globalAlpha = 1;
    });

    drawCaptionBar(
      ctx,
      '4/5 — Every extracted claim receives a 0–100 Freshness Score, policy verdict, and clickable proof URL.',
      progress01
    );
    return;
  }

  // SCENE 5 (15.2 - 18.0s): Drop-In 5-Line Bifrost Proxy + Spatial XR Outro
  const local = t - 15.2;
  const p = easeOutCubic(local / 0.8);
  drawTopBrand(ctx, '05 · DROP-IN PROXY SDK & SPATIAL XR');

  ctx.textAlign = 'left';
  ctx.fillStyle = '#F8FAFC';
  ctx.font = '700 34px "Outfit", system-ui, sans-serif';
  ctx.fillText('Zero-Refactor Drop-In Gateway', 56, 122);

  // Code card on left
  roundRect(ctx, 56, 166, 720, 415, 14);
  ctx.fillStyle = '#0D1322';
  ctx.fill();
  ctx.strokeStyle = '#06B6D4';
  ctx.lineWidth = 1.6;
  ctx.stroke();

  const snippet = getProxySnippets(
    opts.config.bifrostEndpoint,
    opts.config.primaryModel
  ).python;
  ctx.fillStyle = '#E2E8F0';
  ctx.font = '400 16px "JetBrains Mono", monospace';
  snippet.split('\n').forEach((line, i) => {
    ctx.fillStyle = line.trim().startsWith('#')
      ? '#64748B'
      : line.includes('base_url') || line.includes('AutoHeal')
        ? '#10B981'
        : '#E2E8F0';
    ctx.fillText(line.slice(0, 68), 82, 212 + i * 28);
  });

  // 3D Spatial Reactor Preview Graphic on right
  const rx = 1010;
  const ry = 360;
  ctx.save();
  ctx.translate(rx, ry);
  for (let ring = 0; ring < 3; ring++) {
    ctx.strokeStyle = ring === 0 ? '#06B6D4' : ring === 1 ? '#10B981' : '#38BDF8';
    ctx.lineWidth = 3 - ring * 0.6;
    ctx.beginPath();
    ctx.ellipse(
      0,
      0,
      120 - ring * 26,
      54 + ring * 20,
      local * (0.9 - ring * 0.35),
      0,
      Math.PI * 2
    );
    ctx.stroke();
  }
  ctx.fillStyle = '#06B6D4';
  ctx.globalAlpha = 0.25 + p * 0.45;
  ctx.beginPath();
  ctx.arc(0, 0, 26, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.textAlign = 'center';
  ctx.fillStyle = '#F8FAFC';
  ctx.font = '700 22px "Outfit", system-ui, sans-serif';
  ctx.fillText('Android XR & Spatial Telemetry', rx, 526);
  ctx.fillStyle = '#94A3B8';
  ctx.font = '400 16px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('Interactive 3D Reactor + Floating UICards', rx, 554);

  drawCaptionBar(
    ctx,
    '5/5 — Swap one line (base_url) to protect every AI agent in production — on desktop or Spatial XR.',
    progress01
  );
}

export async function renderDemoVideoWebM(
  opts: DemoRenderOptions
): Promise<DemoVideoArtifact> {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D context is unavailable for video export.');
  }

  const videoStream = canvas.captureStream(FPS);
  const tracks: MediaStreamTrack[] = [...videoStream.getVideoTracks()];

  // Optional subtle synthesized Web Audio pulse track for scene transitions
  let audioCtx: AudioContext | null = null;
  try {
    audioCtx = new AudioContext();
    const dest = audioCtx.createMediaStreamDestination();
    const gain = audioCtx.createGain();
    gain.gain.value = 0.08;
    gain.connect(dest);

    const cues = [0.1, 3.25, 7.25, 11.65, 15.25];
    const freqs = [440, 523.25, 659.25, 587.33, 783.99];
    const now = audioCtx.currentTime;
    cues.forEach((offset, i) => {
      if (!audioCtx) return;
      const osc = audioCtx.createOscillator();
      const env = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freqs[i], now + offset);
      env.gain.setValueAtTime(0.0001, now + offset);
      env.gain.exponentialRampToValueAtTime(0.5, now + offset + 0.04);
      env.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.35);
      osc.connect(env);
      env.connect(gain);
      osc.start(now + offset);
      osc.stop(now + offset + 0.4);
    });
    tracks.push(...dest.stream.getAudioTracks());
  } catch {
    // Proceed silently with video-only stream if Web Audio is restricted
  }

  const combined = new MediaStream(tracks);
  const mimeType = pickMimeType();
  const chunks: BlobPart[] = [];
  const recorder = new MediaRecorder(combined, {
    mimeType,
    videoBitsPerSecond: 4_500_000,
  });

  recorder.ondataavailable = (ev) => {
    if (ev.data && ev.data.size > 0) chunks.push(ev.data);
  };

  const stopped = new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => resolve(new Blob(chunks, {type: mimeType}));
    recorder.onerror = () => reject(new Error('MediaRecorder encoding error.'));
  });

  recorder.start(250);

  const startedAt = performance.now();
  await new Promise<void>((resolve) => {
    const step = () => {
      const elapsedSec = (performance.now() - startedAt) / 1000;
      const clamped = Math.min(elapsedSec, TOTAL_SECONDS);
      drawFrame(ctx, clamped, opts);

      const pct = Math.min(100, Math.round((clamped / TOTAL_SECONDS) * 100));
      const stageLabel =
        clamped < 3.2
          ? 'Rendering Scene 1/5: Title & Stale-Weight Problem'
          : clamped < 7.2
            ? 'Rendering Scene 2/5: 3-Stage Verification Pipeline'
            : clamped < 11.6
              ? 'Rendering Scene 3/5: Split-Screen Diff & Radial Gauge'
              : clamped < 15.2
                ? 'Rendering Scene 4/5: Claim-by-Claim Audit Ledger'
                : 'Rendering Scene 5/5: Drop-In Proxy SDK & Spatial XR';
      opts.onProgress(pct, stageLabel);

      if (elapsedSec < TOTAL_SECONDS) {
        requestAnimationFrame(step);
      } else {
        resolve();
      }
    };
    requestAnimationFrame(step);
  });

  recorder.stop();
  const blob = await stopped;
  if (audioCtx) {
    void audioCtx.close().catch(() => {});
  }
  const url = URL.createObjectURL(blob);

  return {
    blob,
    url,
    durationSec: TOTAL_SECONDS,
    mimeType,
  };
}
