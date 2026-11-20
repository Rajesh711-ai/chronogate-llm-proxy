import * as THREE from 'three';
import type {VerifiedClaim} from '../types.ts';

const MAX_NODES = 8;
const ORBIT_RADIUS = 0.37;

const _colorFresh = new THREE.Color(0x10b981);
const _colorAging = new THREE.Color(0xf59e0b);
const _colorStale = new THREE.Color(0xef4444);

interface OrbitSatellite {
  pivot: THREE.Group;
  crystal: THREE.Mesh;
  mat: THREE.MeshStandardMaterial;
  ring: THREE.Mesh;
  baseAngle: number;
  bobPhase: number;
}

export class ClaimOrbitRig extends THREE.Group {
  private trackRing: THREE.Mesh;
  private satellites: OrbitSatellite[] = [];
  private activeCount = 0;
  private disposables: {dispose: () => void}[] = [];

  constructor() {
    super();
    this.name = 'ChronoGate Orbital Claim Satellites';

    const trackGeo = new THREE.TorusGeometry(ORBIT_RADIUS, 0.0022, 8, 72);
    const trackMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.22,
    });
    this.trackRing = new THREE.Mesh(trackGeo, trackMat);
    this.trackRing.rotation.x = Math.PI / 2;
    this.add(this.trackRing);

    const crystalGeo = new THREE.OctahedronGeometry(0.022, 0);
    const haloGeo = new THREE.TorusGeometry(0.032, 0.0025, 8, 24);
    this.disposables.push(trackGeo, trackMat, crystalGeo, haloGeo);

    for (let i = 0; i < MAX_NODES; i++) {
      const pivot = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({
        color: 0x06b6d4,
        emissive: 0x06b6d4,
        emissiveIntensity: 1.1,
        metalness: 0.35,
        roughness: 0.22,
      });
      const crystal = new THREE.Mesh(crystalGeo, mat);
      const ring = new THREE.Mesh(haloGeo, mat);
      ring.rotation.x = Math.PI / 2;

      pivot.add(crystal, ring);
      pivot.visible = false;
      this.add(pivot);
      this.disposables.push(mat);

      this.satellites.push({
        pivot,
        crystal,
        mat,
        ring,
        baseAngle: (i / MAX_NODES) * Math.PI * 2,
        bobPhase: i * 0.9,
      });
    }
  }

  setClaims(claims: VerifiedClaim[]): void {
    const count = Math.min(claims.length, MAX_NODES);
    this.activeCount = count;

    for (let i = 0; i < MAX_NODES; i++) {
      const sat = this.satellites[i];
      if (i < count) {
        const claim = claims[i];
        sat.pivot.visible = true;
        sat.baseAngle = (i / Math.max(1, count)) * Math.PI * 2;
        const target =
          claim.status === 'FRESH'
            ? _colorFresh
            : claim.status === 'AGING'
              ? _colorAging
              : _colorStale;
        sat.mat.color.copy(target);
        sat.mat.emissive.copy(target);
      } else {
        sat.pivot.visible = false;
      }
    }
  }

  update(delta: number, elapsed: number): void {
    const dt = Math.min(delta, 0.1);
    this.trackRing.rotation.z += dt * 0.15;

    for (let i = 0; i < this.activeCount; i++) {
      const sat = this.satellites[i];
      const angle = sat.baseAngle + elapsed * 0.38;
      sat.pivot.position.set(
        Math.cos(angle) * ORBIT_RADIUS,
        Math.sin(elapsed * 1.9 + sat.bobPhase) * 0.025,
        Math.sin(angle) * ORBIT_RADIUS
      );
      sat.crystal.rotation.y += dt * 1.8;
      sat.crystal.rotation.x += dt * 0.8;
      sat.ring.rotation.z -= dt * 1.2;
    }
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
  }
}
