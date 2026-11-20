import * as xb from 'xrblocks';

import {chronoStore} from './state/ChronoStore.ts';
import {DashboardController} from './ui/DashboardController.ts';
import {ChronoGateScene} from './xr/ChronoGateScene.ts';

async function startChronoGate() {
  // 1. Mount the 2D Command Console overlay synchronized with ChronoStore
  const rootEl = document.getElementById('root');
  if (rootEl) {
    new DashboardController(rootEl);
  }

  // 2. Query server capabilities (Gemini grounding & optional Tavily proxy)
  void chronoStore.checkServerHealth();

  // 3. Initialize the XR Blocks spatial 3D scene & simulator environment
  const options = new xb.Options();
  options.setAppTitle('ChronoGate');
  options.setAppDescription(
    'Real-time LLM Freshness Verification & Self-Healing Gateway in Spatial XR.'
  );
  options.xrButton.showEnterSimulatorButton = true;

  xb.add(new ChronoGateScene());
  await xb.init(options);
}

document.addEventListener('DOMContentLoaded', () => {
  void startChronoGate();
});
