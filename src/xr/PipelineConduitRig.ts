import * as THREE from 'three';
import type {StageState} from '../types.ts';

const PACKETS_PER_LINK = 10;
const TOTAL_PACKETS = PACKETS_PER_LINK * 2;

const _dummy = new THREE.Object3D();
const _pos = new THREE.Vector3();
const _colorIdle = new THREE.Color(0x334155);
const _colorRun = new THREE.Color(0x06b6d4);
const _colorDone = new THREE.Color(0x10b981);
const _colorErr = new THREE.Color(0xef4444);

interface StageNodeVisual {
  group: THREE.Group;
  beacon: THREE.Mesh;
  beaconMat: THREE.MeshStandardMaterial;
  halo: THREE.Mesh;
  haloMat: THREE.MeshStandardMaterial;
}

export class PipelineConduitRig extends THREE.Group {
  private nodes: StageNodeVisual[] = [];
  private curve12: THREE.QuadraticBezierCurve3;
  private curve23: THREE.QuadraticBezierCurve3;
  private packetMesh: THREE.InstancedMesh;
  private packetMat: THREE.MeshBasicMaterial;
  private disposables: {dispose: () => void}[] = [];

  private states: [StageState, StageState, StageState] = [
    'idle',
    'idle',
    'idle',
  ];

  constructor() {
    super();
    this.name = 'ChronoGate 3-Stage Pipeline Conduits';

    const nodePositions = [
      new THREE.Vector3(-0.58, 0, 0.08),
      new THREE.Vector3(0, 0, -0.05),
      new THREE.Vector3(0.58, 0, 0.08),
    ];

    const plinthGeo = new THREE.CylinderGeometry(0.055, 0.072, 0.036, 6);
    const plinthMat = new THREE.MeshStandardMaterial({
      color: 0x162032,
      metalness: 0.85,
      roughness: 0.28,
    });
    const ringGeo = new THREE.TorusGeometry(0.068, 0.004, 10, 32);
    const beaconGeo = new THREE.OctahedronGeometry(0.042, 0);
    this.disposables.push(plinthGeo, plinthMat, ringGeo, beaconGeo);

    for (let i = 0; i < 3; i++) {
      const group = new THREE.Group();
      group.position.copy(nodePositions[i]);

      const plinth = new THREE.Mesh(plinthGeo, plinthMat);
      plinth.position.y = 0.018;
      group.add(plinth);

      const haloMat = new THREE.MeshStandardMaterial({
        color: 0x334155,
        emissive: 0x1e293b,
        emissiveIntensity: 0.8,
        metalness: 0.5,
        roughness: 0.3,
      });
      const halo = new THREE.Mesh(ringGeo, haloMat);
      halo.rotation.x = Math.PI / 2;
      halo.position.y = 0.042;
      group.add(halo);

      const beaconMat = new THREE.MeshStandardMaterial({
        color: 0x334155,
        emissive: 0x0f172a,
        emissiveIntensity: 0.7,
        metalness: 0.3,
        roughness: 0.22,
      });
      const beacon = new THREE.Mesh(beaconGeo, beaconMat);
      beacon.position.y = 0.115;
      group.add(beacon);

      this.disposables.push(haloMat, beaconMat);
      this.nodes.push({group, beacon, beaconMat, halo, haloMat});
      this.add(group);
    }

    // Curved data conduits connecting Stage 1 -> Stage 2 -> Stage 3
    this.curve12 = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(-0.52, 0.09, 0.08),
      new THREE.Vector3(-0.29, 0.17, -0.02),
      new THREE.Vector3(-0.06, 0.09, -0.05)
    );
    this.curve23 = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(0.06, 0.09, -0.05),
      new THREE.Vector3(0.29, 0.17, -0.02),
      new THREE.Vector3(0.52, 0.09, 0.08)
    );

    const tubeMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      emissive: 0x06b6d4,
      emissiveIntensity: 0.2,
      metalness: 0.7,
      roughness: 0.3,
      transparent: true,
      opacity: 0.72,
    });
    const tube1Geo = new THREE.TubeGeometry(this.curve12, 28, 0.0055, 8, false);
    const tube2Geo = new THREE.TubeGeometry(this.curve23, 28, 0.0055, 8, false);
    this.add(new THREE.Mesh(tube1Geo, tubeMat));
    this.add(new THREE.Mesh(tube2Geo, tubeMat));
    this.disposables.push(tube1Geo, tube2Geo, tubeMat);

    // Instanced energy packets streaming along the conduits
    const packetGeo = new THREE.SphereGeometry(0.011, 10, 10);
    this.packetMat = new THREE.MeshBasicMaterial({color: 0x38bdf8});
    this.packetMesh = new THREE.InstancedMesh(
      packetGeo,
      this.packetMat,
      TOTAL_PACKETS
    );
    this.packetMesh.frustumCulled = false;
    this.add(this.packetMesh);
    this.disposables.push(packetGeo, this.packetMat);
  }

  setStageStates(s1: StageState, s2: StageState, s3: StageState): void {
    this.states = [s1, s2, s3];
  }

  private colorForState(state: StageState): THREE.Color {
    if (state === 'running') return _colorRun;
    if (state === 'complete') return _colorDone;
    if (state === 'error') return _colorErr;
    return _colorIdle;
  }

  update(delta: number, elapsed: number): void {
    const dt = Math.min(delta, 0.1);

    for (let i = 0; i < 3; i++) {
      const node = this.nodes[i];
      const st = this.states[i];
      const targetColor = this.colorForState(st);

      node.beaconMat.color.lerp(targetColor, Math.min(1, dt * 6));
      node.beaconMat.emissive.lerp(targetColor, Math.min(1, dt * 6));
      node.beaconMat.emissiveIntensity =
        st === 'running' ? 1.5 + Math.sin(elapsed * 7) * 0.4 : st === 'complete' ? 1.0 : 0.35;

      node.haloMat.color.lerp(targetColor, Math.min(1, dt * 6));
      node.haloMat.emissive.lerp(targetColor, Math.min(1, dt * 6));

      const rotSpeed = st === 'running' ? 3.2 : 0.65;
      node.beacon.rotation.y += dt * rotSpeed;
      node.beacon.position.y = 0.115 + Math.sin(elapsed * 2.2 + i * 1.4) * 0.008;
    }

    const link1Active =
      this.states[0] === 'running' ||
      this.states[0] === 'complete' ||
      this.states[1] === 'running';
    const link2Active =
      this.states[1] === 'complete' ||
      this.states[2] === 'running' ||
      this.states[2] === 'complete';

    for (let i = 0; i < PACKETS_PER_LINK; i++) {
      const t1 = (elapsed * 0.65 + i / PACKETS_PER_LINK) % 1;
      this.curve12.getPointAt(t1, _pos);
      _dummy.position.copy(_pos);
      _dummy.scale.setScalar(link1Active ? 1.0 : 0.001);
      _dummy.updateMatrix();
      this.packetMesh.setMatrixAt(i, _dummy.matrix);

      const t2 = (elapsed * 0.65 + i / PACKETS_PER_LINK) % 1;
      this.curve23.getPointAt(t2, _pos);
      _dummy.position.copy(_pos);
      _dummy.scale.setScalar(link2Active ? 1.0 : 0.001);
      _dummy.updateMatrix();
      this.packetMesh.setMatrixAt(PACKETS_PER_LINK + i, _dummy.matrix);
    }
    this.packetMesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    for (const item of this.disposables) {
      item.dispose();
    }
    this.disposables = [];
  }
}
