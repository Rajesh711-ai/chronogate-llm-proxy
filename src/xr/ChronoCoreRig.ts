import * as THREE from 'three';

const SEGMENT_COUNT = 36;
const GAUGE_RADIUS = 0.255;

const _dummy = new THREE.Object3D();
const _colorLit = new THREE.Color();
const _colorDim = new THREE.Color(0x162033);
const _colorTarget = new THREE.Color();

export class ChronoCoreRig extends THREE.Group {
  private outerGimbal: THREE.Mesh;
  private innerGimbal: THREE.Mesh;
  private coreCrystal: THREE.Mesh;
  private coreWireframe: THREE.Mesh;
  private gaugeSegments: THREE.InstancedMesh;
  private pedestalRing: THREE.Mesh;
  private coreMaterial: THREE.MeshPhysicalMaterial;
  private wireMaterial: THREE.MeshBasicMaterial;
  private ringMaterial: THREE.MeshStandardMaterial;

  private disposables: {dispose: () => void}[] = [];

  private targetScore = 0;
  private displayScore = 0;
  private isScanning = false;
  private hasResult = false;

  constructor() {
    super();
    this.name = 'ChronoGate Freshness Reactor';

    // 1. Multi-part brushed titanium pedestal base
    const baseGeo = new THREE.CylinderGeometry(0.16, 0.21, 0.045, 8);
    const baseMat = new THREE.MeshStandardMaterial({
      color: 0x151e2e,
      metalness: 0.85,
      roughness: 0.28,
    });
    const baseMesh = new THREE.Mesh(baseGeo, baseMat);
    baseMesh.position.y = 0.0225;
    this.add(baseMesh);

    const collarGeo = new THREE.CylinderGeometry(0.115, 0.145, 0.032, 24);
    const collarMat = new THREE.MeshStandardMaterial({
      color: 0x223047,
      metalness: 0.9,
      roughness: 0.22,
    });
    const collarMesh = new THREE.Mesh(collarGeo, collarMat);
    collarMesh.position.y = 0.06;
    this.add(collarMesh);

    // Pedestal illuminated calibration ring
    const pedRingGeo = new THREE.TorusGeometry(0.175, 0.0045, 12, 48);
    this.ringMaterial = new THREE.MeshStandardMaterial({
      color: 0x06b6d4,
      emissive: 0x06b6d4,
      emissiveIntensity: 1.4,
      roughness: 0.2,
      metalness: 0.4,
    });
    this.pedestalRing = new THREE.Mesh(pedRingGeo, this.ringMaterial);
    this.pedestalRing.rotation.x = Math.PI / 2;
    this.pedestalRing.position.y = 0.048;
    this.add(this.pedestalRing);

    // 2. Contact floor grid disk (procedural canvas texture)
    const floorTex = this.createRadialGridTexture();
    const floorGeo = new THREE.CircleGeometry(0.38, 48);
    const floorMat = new THREE.MeshBasicMaterial({
      map: floorTex,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.y = 0.002;
    this.add(floorMesh);

    // 3. Outer brushed slate titanium gimbal ring
    const outerGeo = new THREE.TorusGeometry(0.205, 0.011, 16, 64);
    const outerMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      metalness: 0.88,
      roughness: 0.24,
    });
    this.outerGimbal = new THREE.Mesh(outerGeo, outerMat);
    this.outerGimbal.position.y = 0.34;
    this.add(this.outerGimbal);

    // 4. Inner angled calibration gimbal
    const innerGeo = new THREE.TorusGeometry(0.155, 0.007, 14, 56);
    const innerMat = new THREE.MeshStandardMaterial({
      color: 0x06b6d4,
      emissive: 0x0891b2,
      emissiveIntensity: 0.8,
      metalness: 0.65,
      roughness: 0.32,
    });
    this.innerGimbal = new THREE.Mesh(innerGeo, innerMat);
    this.innerGimbal.position.y = 0.34;
    this.add(this.innerGimbal);

    // 5. Central faceted optical crystal core
    const coreGeo = new THREE.IcosahedronGeometry(0.088, 1);
    this.coreMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x06b6d4,
      emissive: 0x0284c7,
      emissiveIntensity: 0.65,
      metalness: 0.15,
      roughness: 0.14,
      clearcoat: 1.0,
      clearcoatRoughness: 0.08,
      transparent: true,
      opacity: 0.9,
    });
    this.coreCrystal = new THREE.Mesh(coreGeo, this.coreMaterial);
    this.coreCrystal.position.y = 0.34;
    this.add(this.coreCrystal);

    // 6. Wireframe geodesic meridian cage around core
    const wireGeo = new THREE.IcosahedronGeometry(0.112, 1);
    this.wireMaterial = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      wireframe: true,
      transparent: true,
      opacity: 0.32,
    });
    this.coreWireframe = new THREE.Mesh(wireGeo, this.wireMaterial);
    this.coreWireframe.position.y = 0.34;
    this.add(this.coreWireframe);

    // 7. 36-segment 3D Radial Freshness Arc Gauge (InstancedMesh)
    const segGeo = new THREE.BoxGeometry(0.016, 0.032, 0.014);
    const segMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0x0f172a,
      emissiveIntensity: 0.5,
      metalness: 0.35,
      roughness: 0.3,
    });
    this.gaugeSegments = new THREE.InstancedMesh(segGeo, segMat, SEGMENT_COUNT);
    this.gaugeSegments.position.y = 0.34;
    this.gaugeSegments.frustumCulled = false;

    for (let i = 0; i < SEGMENT_COUNT; i++) {
      // Clockwise starting at 12 o'clock
      const angle = Math.PI / 2 - (i / SEGMENT_COUNT) * Math.PI * 2;
      _dummy.position.set(
        Math.cos(angle) * GAUGE_RADIUS,
        Math.sin(angle) * GAUGE_RADIUS,
        0
      );
      _dummy.rotation.set(0, 0, angle - Math.PI / 2);
      _dummy.scale.set(1, 1, 1);
      _dummy.updateMatrix();
      this.gaugeSegments.setMatrixAt(i, _dummy.matrix);
      this.gaugeSegments.setColorAt(i, _colorDim);
    }
    this.gaugeSegments.instanceMatrix.needsUpdate = true;
    if (this.gaugeSegments.instanceColor) {
      this.gaugeSegments.instanceColor.needsUpdate = true;
    }
    this.add(this.gaugeSegments);

    this.disposables.push(
      baseGeo,
      baseMat,
      collarGeo,
      collarMat,
      pedRingGeo,
      this.ringMaterial,
      floorTex,
      floorGeo,
      floorMat,
      outerGeo,
      outerMat,
      innerGeo,
      innerMat,
      coreGeo,
      this.coreMaterial,
      wireGeo,
      this.wireMaterial,
      segGeo,
      segMat
    );
  }

  private createRadialGridTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const cx = 256;
      const cy = 256;
      const grad = ctx.createRadialGradient(cx, cy, 30, cx, cy, 250);
      grad.addColorStop(0, 'rgba(6, 182, 212, 0.25)');
      grad.addColorStop(0.55, 'rgba(15, 23, 42, 0.35)');
      grad.addColorStop(1, 'rgba(11, 15, 25, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 512, 512);

      ctx.strokeStyle = 'rgba(6, 182, 212, 0.32)';
      ctx.lineWidth = 2;
      for (const r of [90, 150, 210]) {
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.2)';
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * 65, cy + Math.sin(a) * 65);
        ctx.lineTo(cx + Math.cos(a) * 235, cy + Math.sin(a) * 235);
        ctx.stroke();
      }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  setTelemetry(score: number, scanning: boolean, hasResult: boolean): void {
    this.targetScore = THREE.MathUtils.clamp(score, 0, 100);
    this.isScanning = scanning;
    this.hasResult = hasResult;
  }

  update(delta: number, elapsed: number): void {
    const dt = Math.min(delta, 0.1);
    const spinSpeed = this.isScanning ? 2.4 : 0.45;

    this.outerGimbal.rotation.y += dt * spinSpeed * 0.7;
    this.outerGimbal.rotation.x = Math.sin(elapsed * 0.6) * 0.22;

    this.innerGimbal.rotation.y -= dt * spinSpeed * 1.15;
    this.innerGimbal.rotation.z += dt * spinSpeed * 0.55;

    this.coreCrystal.rotation.y += dt * spinSpeed * 0.8;
    this.coreCrystal.rotation.x += dt * spinSpeed * 0.35;
    this.coreWireframe.rotation.y -= dt * spinSpeed * 0.4;

    const bob = Math.sin(elapsed * 1.8) * 0.008;
    this.coreCrystal.position.y = 0.34 + bob;
    this.coreWireframe.position.y = 0.34 + bob;

    // Smoothly damp score readout
    this.displayScore = THREE.MathUtils.damp(
      this.displayScore,
      this.hasResult ? this.targetScore : 0,
      4.5,
      dt
    );

    // Choose target semantic accent color
    if (this.isScanning) {
      _colorTarget.setHex(0x06b6d4); // Cyan live scan
    } else if (!this.hasResult) {
      _colorTarget.setHex(0x06b6d4); // Ready cyan
    } else if (this.targetScore >= 90) {
      _colorTarget.setHex(0x10b981); // Emerald fresh
    } else if (this.targetScore >= 50) {
      _colorTarget.setHex(0xf59e0b); // Amber aging
    } else {
      _colorTarget.setHex(0xef4444); // Crimson stale
    }

    this.coreMaterial.color.lerp(_colorTarget, Math.min(1, dt * 5));
    this.coreMaterial.emissive.lerp(_colorTarget, Math.min(1, dt * 5));
    this.ringMaterial.color.lerp(_colorTarget, Math.min(1, dt * 5));
    this.ringMaterial.emissive.lerp(_colorTarget, Math.min(1, dt * 5));
    this.wireMaterial.color.lerp(_colorTarget, Math.min(1, dt * 5));

    // Update 3D segmented radial gauge
    const litCount = Math.round((this.displayScore / 100) * SEGMENT_COUNT);
    const scanHead = Math.floor((elapsed * 22) % SEGMENT_COUNT);

    for (let i = 0; i < SEGMENT_COUNT; i++) {
      if (this.isScanning) {
        const dist = (scanHead - i + SEGMENT_COUNT) % SEGMENT_COUNT;
        if (dist < 7) {
          const intensity = 1 - dist / 7;
          _colorLit.copy(_colorDim).lerp(_colorTarget, intensity);
          this.gaugeSegments.setColorAt(i, _colorLit);
        } else {
          this.gaugeSegments.setColorAt(i, _colorDim);
        }
      } else if (this.hasResult && i < litCount) {
        this.gaugeSegments.setColorAt(i, _colorTarget);
      } else {
        this.gaugeSegments.setColorAt(i, _colorDim);
      }
    }
    if (this.gaugeSegments.instanceColor) {
      this.gaugeSegments.instanceColor.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const item of this.disposables) {
      item.dispose();
    }
    this.disposables = [];
  }
}
