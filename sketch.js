/* =========================================================================
   2D 다중 단백질 열역학 & 돌연변이 시뮬레이터
   - p5.js: 물리 연산 + 렌더링
   - Chart.js: 실시간 ΔG 그래프
   - 순수 바닐라 JS, 번들러 없음 (GitHub Pages 배포 전제)
   ========================================================================= */

/* -------------------------------------------------------------------------
   CONFIG: 튜닝 가능한 모든 매직넘버를 이곳에 모아둡니다.
   ------------------------------------------------------------------------- */
const CONFIG = {
  // 공유 결합 (사슬 내 인접 입자, Hooke's Law)
  springK: 0.03,
  springRestLength: 32,

  // 입체 장애 (모든 입자 쌍 반발력)
  repulsionStrength: 900,
  repulsionMinDist: 24,      // 이 거리 이하에서 강하게 반발
  repulsionCutoff: 40,       // 이 거리 이상이면 반발력 없음 (성능 최적화)

  // 소수성 붕괴 (H-H)
  hydrophobicStrength: 0.045,
  hydrophobicRange: 90,      // 이 거리 이내에서만 인력 작용

  // 이황화 결합 (C-C)
  disulfideFormDist: 28,     // 이 거리 이내로 접근하면 결합 형성
  disulfideRestLength: 26,
  disulfideStrength: 0.28,   // springK 대비 약 9~10배 (사실상 불가역)

  // 정전기 (A/B, 염교 & 척력)
  // repulsionStrength(900)에 비해 너무 약하면 염교가 형성돼도 반발력에 상쇄돼
  // 시각적으로 "약하게" 느껴짐. 근거리(~20-30px)에서 반발력과 경쟁 가능한 수준으로 튜닝.
  electrostaticStrength: 2.0,
  electrostaticEnergyScale: 1.5, // ΔG 계산에서 힘과 같은 형태(선형 감쇠)로 스케일 맞추는 계수
  electrostaticRange: 140,
  phLowThreshold: 4,         // pH < 4 : A(산성) 완전 중성화
  phHighThreshold: 10,       // pH > 10 : B(염기성) 완전 중성화

  // 용매 환경 (수용성 vs 지용성)
  // - 수용성(water): 전하가 물 분자에 의해 차폐되어 정전기력이 약해짐. H(소수성) 잔기가 뭉침.
  // - 지용성(lipid): 차폐가 거의 없어 정전기력이 강해짐. 반대로 P(친수성) 잔기가 "역미셀"처럼 뭉침.
  electrostaticEnvFactor: { aqueous: 0.6, lipid: 1.9 },
  clusteringResidueByEnv: { aqueous: 'H', lipid: 'P' },

  // 열 노이즈 (Langevin dynamics 단순화)
  thermalForceScale: 0.16,   // 온도(0~100) 1단위당 무작위 힘의 표준편차 배율
  denaturationTempThreshold: 60, // 이 온도 이상부터 "변성" UI 연출 시작

  // 적분 / 감쇠
  damping: 0.88,
  maxSpeed: 7,
  particleMass: 1,

  // 입자 형태
  particleRadius: 11,
  chainSpacing: 30,          // 사슬 생성 시 초기 입자 간격

  // ΔG 계산용 계수
  temperaturePenaltyCoeff: 0.02, // -TΔS 근사 (온도가 높을수록 ΔG 상승 = 풀림 유도)
  maxBondEnergy: 15, // 스프링/이황화 결합의 stretch² 항은 상한이 없어서, 드래그로 순간적으로
                      // 크게 늘리면 ΔG가 다른 항들과 비교가 안 될 만큼 폭증함. 표시용 ΔG에서만 캡을 걸어줌.

  // 그래프
  chartWindow: 200,          // 화면에 보여줄 최근 프레임 수 (전체 기록은 별도 보관)
  chartUpdateEvery: 4,       // N프레임마다 차트 갱신 (성능)

  // 마이크로 인터랙션
  pulseDuration: 14,         // 돌연변이 펄스 지속 프레임
  flashDuration: 8,          // 이황화 결합 형성 플래시 지속 프레임 (약 130ms @60fps)

  // 용매(물) 분자 시각화 — 소수성 붕괴의 엔트로피 증가를 직접 보여주기 위한 배경 입자층.
  // 노출된 클러스터링 잔기(수용성:H, 지용성:P) 주변엔 "정렬된(카고) 물"이 느리게 움직이다가,
  // 잔기들이 뭉쳐 파묻히면 그 물이 풀려나 "자유로운(벌크) 물"처럼 빨라진다.
  solventCount: 260,
  solventRadius: 3.2,            // 잘 보이도록 큼직하게
  solventCageRadius: 46,        // 노출된 클러스터링 잔기 주변, 카고 물이 형성되는 반경
  solventBuryContactDist: 32,   // 같은 클러스터링 잔기끼리 이 거리 이내면 "파묻힘(뭉침)"으로 간주
  solventCagedSpeedCap: 0.35,   // 카고 물의 최대 속도 (느림)
  solventBulkSpeedCap: 2.2,     // 벌크(자유) 물의 기본 최대 속도 (빠름)
  solventBulkTempScale: 0.012,  // 온도가 높을수록 벌크 물도 추가로 더 빨라짐
  solventForceScale: 0.35,      // 무작위 워크(브라운 운동) 가속도 크기
  solventDamping: 0.9,
  solventEaseRate: 0.06,        // 카고 <-> 벌크 속도 전환의 부드러움 (관성처럼 서서히 바뀜)

  // 물 <-> 사슬(단백질 입자) 상호작용 — 물이 잔기를 그냥 통과하지 않고 표면에서 튕겨나가며,
  // 반대로 잔기도 부딪히는 물 분자들에 의해 아주 미세하게 밀린다 (용매 압력 느낌).
  solventCollisionMargin: 3,       // 잔기 반지름 + 물 반지름에 더해지는 여유 거리
  solventBounceRestitution: 0.5,   // 충돌 시 속도 반사 정도 (0=흡수, 1=완전 탄성)
  solventProteinPushback: 0.022,   // 물이 잔기에 주는 아주 작은 반작용 힘
};

const RESIDUE_COLORS = {
  H: '#E2933D',
  P: '#3FA7B8',
  C: '#D4A828',
  A: '#D65A5A',
  B: '#4A7FD6',
  N: '#9AA0AA',
};

/* -------------------------------------------------------------------------
   Particle: 단일 아미노산 입자
   ------------------------------------------------------------------------- */
class Particle {
  constructor(x, y, type, chainId, id) {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.fx = 0;
    this.fy = 0;
    this.type = type;
    this.chainId = chainId;
    this.id = id;
    this.fixed = false;    // 드래그 중 true
    this.pulse = 0;        // 돌연변이 펄스 애니메이션 (0~1)
  }

  setType(newType) {
    this.type = newType;
    this.pulse = 1;
  }

  // pH에 따른 부분 전하 (-1 ~ +1), A는 음전하, B는 양전하
  charge(pH) {
    if (this.type === 'A') {
      // pH < low: 완전 중성(0). low~high: 선형 보간으로 -1까지. pH>=high: -1 유지
      const t = constrainMap(pH, CONFIG.phLowThreshold, CONFIG.phHighThreshold, 0, 1);
      return -t;
    }
    if (this.type === 'B') {
      // pH > high: 완전 중성(0). low~high 구간에서 low쪽일수록 +1
      const t = constrainMap(pH, CONFIG.phLowThreshold, CONFIG.phHighThreshold, 1, 0);
      return t;
    }
    return 0;
  }
}

function constrainMap(v, inMin, inMax, outMin, outMax) {
  const t = (v - inMin) / (inMax - inMin);
  const tc = Math.min(1, Math.max(0, t));
  return outMin + tc * (outMax - outMin);
}

/* -------------------------------------------------------------------------
   Chain: 폴리펩타이드 사슬 (Particle 배열 + 메타데이터)
   ------------------------------------------------------------------------- */
class Chain {
  constructor(id, name, originX, originY) {
    this.id = id;
    this.name = name;
    this.particles = [];
    this.visible = true;
    this.originX = originX;
    this.originY = originY;
  }

  addResidue(type) {
    const n = this.particles.length;
    const x = this.originX + n * CONFIG.chainSpacing;
    const y = this.originY;
    const p = new Particle(x, y, type, this.id, `${this.id}-${n}-${Date.now()}`);
    this.particles.push(p);
    return p;
  }
}

/* -------------------------------------------------------------------------
   전역 상태
   ------------------------------------------------------------------------- */
let chains = [];
let nextChainId = 1;
let activeChainId = null;

let disulfideBonds = []; // { a: Particle, b: Particle }
let flashes = [];        // { x, y, life }

let temperature = 50;
let pH = 7.0;
let reducingAgent = false;
let paused = false;
let environment = 'aqueous'; // 'aqueous'(수용성) | 'lipid'(지용성)
let simSpeed = 1; // 시뮬레이션 속도 배율 (0.25x ~ 3x)

let frameCounter = 0;
let history = []; // { frame, temperature, pH, dG }
let lastDG = 0;

let interactionParticle = null;
let pressX = 0, pressY = 0;
let dragMoved = false;

let chart = null;
let canvasWidth = 600, canvasHeight = 560;

let solventParticles = []; // { x, y, vx, vy, speedCap, caged }
let showSolvent = true;

/* -------------------------------------------------------------------------
   p5.js: setup / draw
   ------------------------------------------------------------------------- */
function setup() {
  const container = document.getElementById('canvas-container');
  canvasWidth = container.clientWidth;
  canvasHeight = Math.max(480, window.innerHeight - 320);
  const cnv = createCanvas(canvasWidth, canvasHeight);
  cnv.parent('canvas-container');
  frameRate(60);

  createStarterChain();
  initSolvent();
  setupChart();
  wireUI();

  window.addEventListener('resize', () => {
    const c = document.getElementById('canvas-container');
    resizeCanvas(c.clientWidth, canvasHeight);
  });
}

function draw() {
  background('#FDFDFE');

  const dtSeconds = Math.min(deltaTime, 50) / 1000;
  const dtFactor = dtSeconds * 60 * simSpeed; // 60fps 기준 정규화 + 속도 배율

  if (!paused) {
    stepPhysics(dtFactor);
    frameCounter++;
  }

  renderSolvent();
  renderChains();
  renderFlashes(dtFactor);
  updateDenaturationUI();
  updateEnvironmentUI();

  if (!paused && frameCounter % CONFIG.chartUpdateEvery === 0) {
    recordHistoryAndUpdateChart();
  }
}

/* -------------------------------------------------------------------------
   초기 데모 사슬 생성
   ------------------------------------------------------------------------- */
function createStarterChain() {
  const chain = new Chain(nextChainId++, '사슬 1', canvasWidth / 2 - 90, canvasHeight / 2);
  ['P', 'H', 'H', 'C', 'P', 'C', 'N', 'H'].forEach(t => chain.addResidue(t));
  chains.push(chain);
  activeChainId = chain.id;
  renderChainTabs();
}

/* -------------------------------------------------------------------------
   물리 연산
   ------------------------------------------------------------------------- */
function allVisibleParticles() {
  let arr = [];
  for (const c of chains) {
    if (c.visible) arr = arr.concat(c.particles);
  }
  return arr;
}

function stepPhysics(dtFactor) {
  const particles = allVisibleParticles();
  for (const p of particles) { p.fx = 0; p.fy = 0; }

  applySpringForces();
  applyRepulsion(particles);
  applyHydrophobic(particles);
  applyElectrostatic(particles);
  applyDisulfide();
  applyThermalNoise(particles);
  integrate(particles, dtFactor);
  stepSolvent(dtFactor);

  for (const p of particles) {
    if (p.pulse > 0) p.pulse = Math.max(0, p.pulse - 1 / CONFIG.pulseDuration);
  }
}

function applySpringForces() {
  for (const chain of chains) {
    if (!chain.visible) continue;
    const arr = chain.particles;
    for (let i = 0; i < arr.length - 1; i++) {
      const a = arr[i], b = arr[i + 1];
      const dx = b.x - a.x, dy = b.y - a.y;
      const dist = Math.max(0.001, Math.hypot(dx, dy));
      const stretch = dist - CONFIG.springRestLength;
      const f = CONFIG.springK * stretch;
      const fx = (dx / dist) * f;
      const fy = (dy / dist) * f;
      a.fx += fx; a.fy += fy;
      b.fx -= fx; b.fy -= fy;
    }
  }
}

function applyRepulsion(particles) {
  const n = particles.length;
  for (let i = 0; i < n; i++) {
    const a = particles[i];
    for (let j = i + 1; j < n; j++) {
      const b = particles[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      const dist = Math.hypot(dx, dy);
      if (dist > CONFIG.repulsionCutoff || dist < 0.001) continue;
      const clamped = Math.max(dist, CONFIG.repulsionMinDist * 0.4);
      const f = CONFIG.repulsionStrength / (clamped * clamped);
      const fx = (dx / dist) * f;
      const fy = (dy / dist) * f;
      a.fx -= fx; a.fy -= fy;
      b.fx += fx; b.fy += fy;
    }
  }
}

function applyHydrophobic(particles) {
  // 수용성 환경: H(소수성) 잔기끼리 뭉침 (원래 소수성 붕괴).
  // 지용성 환경: 반대로 P(친수성) 잔기끼리 뭉침 (물이 없으니 P가 서로를 감싸는 "역미셀" 효과).
  const clusterType = CONFIG.clusteringResidueByEnv[environment];
  const hs = particles.filter(p => p.type === clusterType);
  for (let i = 0; i < hs.length; i++) {
    for (let j = i + 1; j < hs.length; j++) {
      const a = hs[i], b = hs[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      const dist = Math.hypot(dx, dy);
      if (dist > CONFIG.hydrophobicRange || dist < 0.001) continue;
      // 가까울수록 강한 인력 (임계 거리 이상은 힘 없음 - range로 컷오프)
      const f = CONFIG.hydrophobicStrength * (1 - dist / CONFIG.hydrophobicRange);
      const fx = (dx / dist) * f;
      const fy = (dy / dist) * f;
      a.fx += fx; a.fy += fy;
      b.fx -= fx; b.fy -= fy;
    }
  }
}

function applyElectrostatic(particles) {
  const charged = particles.filter(p => p.type === 'A' || p.type === 'B');
  for (let i = 0; i < charged.length; i++) {
    for (let j = i + 1; j < charged.length; j++) {
      const a = charged[i], b = charged[j];
      const qa = a.charge(pH), qb = b.charge(pH);
      if (qa === 0 || qb === 0) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const dist = Math.hypot(dx, dy);
      if (dist > CONFIG.electrostaticRange || dist < 0.001) continue;
      // 쿨롱 형태 단순화: 반대 부호면 인력(f<0 방향 반전), 같은 부호면 척력
      // 매질에 따른 차폐: 수용액은 극성 물 분자가 전하를 차폐해 정전기력이 약해지고,
      // 지용성(비극성) 환경은 차폐가 거의 없어 정전기력이 훨씬 강하게 작용한다.
      const envFactor = CONFIG.electrostaticEnvFactor[environment];
      const sign = -(qa * qb); // qa*qb<0(반대전하)->sign>0(인력 쪽으로 당김)
      const magnitude = CONFIG.electrostaticStrength * envFactor * Math.abs(qa * qb) *
        (1 - dist / CONFIG.electrostaticRange);
      const f = sign * magnitude;
      const fx = (dx / dist) * f;
      const fy = (dy / dist) * f;
      a.fx += fx; a.fy += fy;
      b.fx -= fx; b.fy -= fy;
    }
  }
}

function applyDisulfide() {
  // 환원제 투입 시 기존 결합 전부 파괴
  if (reducingAgent && disulfideBonds.length > 0) {
    disulfideBonds = [];
  }

  // 기존 결합 유지 (강한 스프링)
  for (const bond of disulfideBonds) {
    const a = bond.a, b = bond.b;
    const dx = b.x - a.x, dy = b.y - a.y;
    const dist = Math.max(0.001, Math.hypot(dx, dy));
    const stretch = dist - CONFIG.disulfideRestLength;
    const f = CONFIG.disulfideStrength * stretch;
    const fx = (dx / dist) * f;
    const fy = (dy / dist) * f;
    a.fx += fx; a.fy += fy;
    b.fx -= fx; b.fy -= fy;
  }

  // 새 결합 형성 (환원제 투입 중이 아닐 때만)
  if (reducingAgent) return;
  const cs = allVisibleParticles().filter(p => p.type === 'C');
  for (let i = 0; i < cs.length; i++) {
    for (let j = i + 1; j < cs.length; j++) {
      const a = cs[i], b = cs[j];
      if (isBonded(a, b)) continue;
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      if (dist <= CONFIG.disulfideFormDist) {
        disulfideBonds.push({ a, b });
        flashes.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, life: CONFIG.flashDuration });
      }
    }
  }
}

function isBonded(a, b) {
  return disulfideBonds.some(bond =>
    (bond.a === a && bond.b === b) || (bond.a === b && bond.b === a));
}

function applyThermalNoise(particles) {
  const std = temperature * CONFIG.thermalForceScale / 100 * 10;
  for (const p of particles) {
    if (p.fixed) continue;
    p.fx += (Math.random() * 2 - 1) * std;
    p.fy += (Math.random() * 2 - 1) * std;
  }
}

function integrate(particles, dtFactor) {
  const margin = CONFIG.particleRadius + 2;
  for (const p of particles) {
    if (p.fixed) { p.vx = 0; p.vy = 0; continue; }
    p.vx = (p.vx + (p.fx / CONFIG.particleMass) * dtFactor) * CONFIG.damping;
    p.vy = (p.vy + (p.fy / CONFIG.particleMass) * dtFactor) * CONFIG.damping;

    const speed = Math.hypot(p.vx, p.vy);
    if (speed > CONFIG.maxSpeed) {
      p.vx = (p.vx / speed) * CONFIG.maxSpeed;
      p.vy = (p.vy / speed) * CONFIG.maxSpeed;
    }

    p.x += p.vx * dtFactor;
    p.y += p.vy * dtFactor;

    // 경계 처리 (부드러운 반사)
    if (p.x < margin) { p.x = margin; p.vx *= -0.4; }
    if (p.x > canvasWidth - margin) { p.x = canvasWidth - margin; p.vx *= -0.4; }
    if (p.y < margin) { p.y = margin; p.vy *= -0.4; }
    if (p.y > canvasHeight - margin) { p.y = canvasHeight - margin; p.vy *= -0.4; }
  }
}

/* -------------------------------------------------------------------------
   용매(물) 분자 시각화
   - 배경에 작은 점들을 물 분자로 띄운다.
   - 노출된 클러스터링 잔기(수용성 환경: H, 지용성 환경: P) 주변은 "정렬된(카고) 물" 구역으로,
     이 구역의 물은 느리게 움직인다 (엔트로피가 낮은 정렬 상태).
   - 같은 종류의 잔기끼리 서로 가까이 뭉쳐 "파묻히면" 그 표면을 감싸던 카고 물이 더 이상
     붙잡히지 못하고 "자유로운(벌크) 물"처럼 빠르게 움직인다 (엔트로피 증가).
   ------------------------------------------------------------------------- */
function initSolvent() {
  solventParticles = [];
  for (let i = 0; i < CONFIG.solventCount; i++) {
    const cap = CONFIG.solventBulkSpeedCap;
    const angle = Math.random() * Math.PI * 2;
    solventParticles.push({
      x: Math.random() * canvasWidth,
      y: Math.random() * canvasHeight,
      vx: Math.cos(angle) * cap * 0.4,
      vy: Math.sin(angle) * cap * 0.4,
      speedCap: cap,
      caged: false,
    });
  }
}

// 클러스터링 잔기(수용성:H / 지용성:P)별로 "노출도"를 계산.
// 같은 종류 이웃이 없으면 완전히 노출(1), 이웃이 많을수록 파묻혀 노출도가 줄어든다(0으로 수렴).
function computeClusterExposure(allParticles) {
  const clusterType = CONFIG.clusteringResidueByEnv[environment];
  const particles = allParticles.filter(p => p.type === clusterType);
  const result = [];
  for (let i = 0; i < particles.length; i++) {
    let neighborCount = 0;
    for (let j = 0; j < particles.length; j++) {
      if (i === j) continue;
      const dist = Math.hypot(particles[j].x - particles[i].x, particles[j].y - particles[i].y);
      if (dist <= CONFIG.solventBuryContactDist) neighborCount++;
    }
    const exposure = Math.max(0, 1 - neighborCount * 0.5); // 0명:1(노출) / 1명:0.5 / 2명 이상:0(파묻힘)
    result.push({ p: particles[i], exposure });
  }
  return result;
}

function stepSolvent(dtFactor) {
  if (!showSolvent || solventParticles.length === 0) return;

  const proteinParticles = allVisibleParticles();
  const exposedList = computeClusterExposure(proteinParticles).filter(e => e.exposure > 0);
  const bulkCap = CONFIG.solventBulkSpeedCap + temperature * CONFIG.solventBulkTempScale;
  const collisionMinDist = CONFIG.particleRadius + CONFIG.solventRadius + CONFIG.solventCollisionMargin;

  for (const w of solventParticles) {
    // 이 물 분자에 가장 강하게 영향을 주는 "카고" 요인을 찾는다 (가장 가까운/노출된 잔기가 지배적).
    let cageFactor = 0;
    for (const e of exposedList) {
      const cageR = CONFIG.solventCageRadius * e.exposure;
      if (cageR <= 0.001) continue;
      const dist = Math.hypot(w.x - e.p.x, w.y - e.p.y);
      if (dist < cageR) {
        const f = (1 - dist / cageR) * e.exposure;
        if (f > cageFactor) cageFactor = f;
      }
    }

    const targetCap = cageFactor > 0
      ? bulkCap + (CONFIG.solventCagedSpeedCap - bulkCap) * cageFactor
      : bulkCap;
    // 즉시 전환이 아니라 서서히 풀려나도록(=카고 -> 벌크 전환이 눈에 보이도록) 이징 처리.
    w.speedCap += (targetCap - w.speedCap) * CONFIG.solventEaseRate;
    w.caged = cageFactor > 0.45;

    // 브라운 운동(무작위 워크)
    w.vx += (Math.random() * 2 - 1) * CONFIG.solventForceScale * dtFactor;
    w.vy += (Math.random() * 2 - 1) * CONFIG.solventForceScale * dtFactor;
    w.vx *= CONFIG.solventDamping;
    w.vy *= CONFIG.solventDamping;

    const speed = Math.hypot(w.vx, w.vy);
    if (speed > w.speedCap) {
      w.vx = (w.vx / speed) * w.speedCap;
      w.vy = (w.vy / speed) * w.speedCap;
    }

    w.x += w.vx * dtFactor;
    w.y += w.vy * dtFactor;

    // 물 <-> 사슬 충돌: 잔기 원판을 그냥 통과하지 않고 표면에서 튕겨나간다.
    // 동시에 부딪힌 잔기도 아주 작은 반작용을 받아 미세하게 밀린다 (양방향 상호작용).
    for (const p of proteinParticles) {
      const dx = w.x - p.x, dy = w.y - p.y;
      const dist = Math.hypot(dx, dy);
      if (dist >= collisionMinDist || dist < 0.0001) continue;

      const nx = dx / dist, ny = dy / dist;
      const overlap = collisionMinDist - dist;
      w.x += nx * overlap;
      w.y += ny * overlap;

      const vn = w.vx * nx + w.vy * ny;
      if (vn < 0) {
        w.vx -= (1 + CONFIG.solventBounceRestitution) * vn * nx;
        w.vy -= (1 + CONFIG.solventBounceRestitution) * vn * ny;
      }

      if (!p.fixed) {
        p.vx -= nx * CONFIG.solventProteinPushback * dtFactor;
        p.vy -= ny * CONFIG.solventProteinPushback * dtFactor;
      }
    }

    // 경계는 순환(wrap-around) — 물은 캔버스 전체를 채우는 배경이므로 반사보다 자연스럽다.
    if (w.x < 0) w.x += canvasWidth;
    if (w.x > canvasWidth) w.x -= canvasWidth;
    if (w.y < 0) w.y += canvasHeight;
    if (w.y > canvasHeight) w.y -= canvasHeight;
  }
}

function renderSolvent() {
  if (!showSolvent) return;
  for (const w of solventParticles) {
    if (w.caged) {
      // 정렬된(카고) 물: 진하고 선명하게, 옅은 흰 테두리로 "붙잡혀 있는" 질서를 표현
      noStroke();
      fill(74, 127, 214, 225);
      circle(w.x, w.y, CONFIG.solventRadius * 2.1);
      stroke(255, 255, 255, 130);
      strokeWeight(1);
      noFill();
      circle(w.x, w.y, CONFIG.solventRadius * 2.1 + 3);
    } else {
      // 자유로운(벌크) 물: 빠르게 스쳐가는 느낌을 속도 방향 잔상(스트릭)으로 표현
      const speed = Math.hypot(w.vx, w.vy);
      if (speed > 0.35) {
        stroke(120, 185, 220, 130);
        strokeWeight(CONFIG.solventRadius * 0.9);
        strokeCap(ROUND);
        line(w.x, w.y, w.x - w.vx * 3.2, w.y - w.vy * 3.2);
      }
      noStroke();
      fill(140, 195, 225, 200);
      circle(w.x, w.y, CONFIG.solventRadius * 1.9);
    }
  }
}

/* -------------------------------------------------------------------------
   ΔG 계산 (에너지 항의 합)
   ------------------------------------------------------------------------- */
function computeGibbsFreeEnergy() {
  const particles = allVisibleParticles();
  let eSpring = 0, eHydrophobic = 0, eRepulsion = 0, eDisulfide = 0, eElectrostatic = 0;

  for (const chain of chains) {
    if (!chain.visible) continue;
    const arr = chain.particles;
    for (let i = 0; i < arr.length - 1; i++) {
      const a = arr[i], b = arr[i + 1];
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      const stretch = dist - CONFIG.springRestLength;
      eSpring += Math.min(0.5 * CONFIG.springK * stretch * stretch, CONFIG.maxBondEnergy);
    }
  }

  for (const bond of disulfideBonds) {
    const dist = Math.hypot(bond.b.x - bond.a.x, bond.b.y - bond.a.y);
    const stretch = dist - CONFIG.disulfideRestLength;
    eDisulfide += Math.min(0.5 * CONFIG.disulfideStrength * stretch * stretch, CONFIG.maxBondEnergy) - 8; // 형성 시 큰 음의 기여
  }

  const clusterType = CONFIG.clusteringResidueByEnv[environment];
  const hs = particles.filter(p => p.type === clusterType);
  for (let i = 0; i < hs.length; i++) {
    for (let j = i + 1; j < hs.length; j++) {
      const dist = Math.hypot(hs[j].x - hs[i].x, hs[j].y - hs[i].y);
      if (dist < CONFIG.hydrophobicRange) {
        eHydrophobic -= CONFIG.hydrophobicStrength * (1 - dist / CONFIG.hydrophobicRange) * 10;
      }
    }
  }

  const n = particles.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dist = Math.hypot(particles[j].x - particles[i].x, particles[j].y - particles[i].y);
      if (dist < CONFIG.repulsionCutoff && dist > 0.001) {
        // applyRepulsion()의 힘 계산과 동일하게 거리 하한을 클램프해야 함.
        // 클램프 없이 dist로 그대로 나누면, 입자가 순간적으로 아주 가까워지는 프레임에서
        // (열 노이즈 등으로) 이 항만 비정상적으로 폭증해 다른 안정화 항들을 압도해버림.
        const clamped = Math.max(dist, CONFIG.repulsionMinDist * 0.4);
        eRepulsion += CONFIG.repulsionStrength / (clamped * clamped) * 0.02;
      }
    }
  }

  const charged = particles.filter(p => p.type === 'A' || p.type === 'B');
  for (let i = 0; i < charged.length; i++) {
    for (let j = i + 1; j < charged.length; j++) {
      const a = charged[i], b = charged[j];
      const qa = a.charge(pH), qb = b.charge(pH);
      if (qa === 0 || qb === 0) continue;
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      if (dist < CONFIG.electrostaticRange && dist > 0.001) {
        // applyElectrostatic()의 실제 힘 형태(선형 감쇠, (1-dist/range))와 일치시켜야
        // ΔG가 실제로 가해지는 힘을 반영함. qa*qb<0(반대전하, 인력)이면 음수(안정화),
        // qa*qb>0(같은전하, 척력)이면 양수(불안정화)가 자동으로 나옴.
        eElectrostatic += (qa * qb) * CONFIG.electrostaticStrength * CONFIG.electrostaticEnvFactor[environment] *
          (1 - dist / CONFIG.electrostaticRange) * CONFIG.electrostaticEnergyScale;
      }
    }
  }

  const temperaturePenalty = temperature * CONFIG.temperaturePenaltyCoeff * Math.max(1, n * 0.3);

  const dG = eSpring + eHydrophobic + eRepulsion + eDisulfide + eElectrostatic + temperaturePenalty;
  return dG;
}

/* -------------------------------------------------------------------------
   렌더링
   ------------------------------------------------------------------------- */
function renderChains() {
  // 염교 (점선) - 배경 레이어
  strokeCap(ROUND);
  const particles = allVisibleParticles();
  const charged = particles.filter(p => (p.type === 'A' || p.type === 'B') && p.charge(pH) !== 0);
  for (let i = 0; i < charged.length; i++) {
    for (let j = i + 1; j < charged.length; j++) {
      const a = charged[i], b = charged[j];
      if (a.type === b.type) continue;
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      if (dist < 65) {
        drawDashedLine(a.x, a.y, b.x, b.y, a.type === 'A' ? '#D65A5A' : '#4A7FD6',
          b.type === 'A' ? '#D65A5A' : '#4A7FD6');
      }
    }
  }

  // 사슬 백본 (스프링)
  for (const chain of chains) {
    if (!chain.visible) continue;
    const isActive = chain.id === activeChainId;
    stroke(isActive ? '#34406B' : '#C7CBD1');
    strokeWeight(isActive ? 2.4 : 1.6);
    noFill();
    for (let i = 0; i < chain.particles.length - 1; i++) {
      const a = chain.particles[i], b = chain.particles[i + 1];
      line(a.x, a.y, b.x, b.y);
    }
  }

  // 이황화 결합 (골드 실선, 두껍게)
  stroke('#C9971E');
  strokeWeight(3.2);
  for (const bond of disulfideBonds) {
    line(bond.a.x, bond.a.y, bond.b.x, bond.b.y);
  }

  // 입자
  noStroke();
  for (const chain of chains) {
    if (!chain.visible) continue;
    for (const p of chain.particles) {
      drawParticle(p, chain.id === activeChainId);
    }
  }
}

function drawParticle(p, isActiveChain) {
  const col = RESIDUE_COLORS[p.type];
  const r = CONFIG.particleRadius;

  // 돌연변이 펄스 링
  if (p.pulse > 0) {
    noFill();
    stroke(col);
    strokeWeight(2);
    const pulseR = r + p.pulse * 14;
    circle(p.x, p.y, pulseR * 2);
    noStroke();
  }

  // 활성 사슬 강조 얇은 외곽 링
  if (isActiveChain) {
    fill('#34406B');
    circle(p.x, p.y, (r + 4) * 2);
  }

  fill(col);
  circle(p.x, p.y, r * 2);

  fill('#FFFFFF');
  textAlign(CENTER, CENTER);
  textSize(10);
  textFont('JetBrains Mono');
  text(p.type, p.x, p.y + 0.5);
}

function drawDashedLine(x1, y1, x2, y2, colA, colB) {
  const dashLen = 6;
  const dist = Math.hypot(x2 - x1, y2 - y1);
  const steps = Math.max(1, Math.floor(dist / dashLen));
  for (let i = 0; i < steps; i += 2) {
    const t0 = i / steps, t1 = Math.min(1, (i + 1) / steps);
    const c = t0 < 0.5 ? colA : colB;
    stroke(c);
    strokeWeight(1.6);
    line(
      lerp(x1, x2, t0), lerp(y1, y2, t0),
      lerp(x1, x2, t1), lerp(y1, y2, t1)
    );
  }
}

function renderFlashes(dtFactor) {
  for (let i = flashes.length - 1; i >= 0; i--) {
    const f = flashes[i];
    const t = 1 - f.life / CONFIG.flashDuration;
    noFill();
    stroke(255, 214, 102, (1 - t) * 255);
    strokeWeight(2);
    circle(f.x, f.y, 10 + t * 40);
    f.life -= dtFactor;
    if (f.life <= 0) flashes.splice(i, 1);
  }
}

function updateDenaturationUI() {
  const denaturing = temperature >= CONFIG.denaturationTempThreshold;
  document.getElementById('canvas-panel').classList.toggle('denaturing', denaturing);
  document.getElementById('temp-slider-block').classList.toggle('denaturing', denaturing);
}

function updateEnvironmentUI() {
  const isLipid = environment === 'lipid';
  document.getElementById('canvas-panel').classList.toggle('lipid-env', isLipid);
}

function updateEnvironmentHint() {
  const hint = document.getElementById('env-hint');
  if (hint) {
    if (environment === 'aqueous') {
      hint.textContent = '💧 수용성: H(소수성) 잔기가 뭉쳐 소수성 코어를 형성 · 정전기력 약화(차폐)';
    } else {
      hint.textContent = '🛢 지용성: P(친수성) 잔기가 뭉치는 역미셀 형성 · 정전기력 강화(차폐 없음)';
    }
  }

  const solventHint = document.getElementById('solvent-hint');
  if (solventHint) {
    const clusterLabel = environment === 'aqueous' ? 'H(소수성)' : 'P(친수성)';
    solventHint.textContent =
      `${clusterLabel} 잔기 표면엔 정렬된(카고) 물이 느리게 붙어있다가, 잔기들이 뭉쳐 파묻히면 ` +
      `그 물이 풀려나 자유로운(벌크) 물처럼 빨라집니다 — 소수성 붕괴가 물의 엔트로피를 높이는 과정을 직접 보여줍니다.`;
  }
}

/* -------------------------------------------------------------------------
   마우스 상호작용: 드래그 & 돌연변이 팝업
   ------------------------------------------------------------------------- */
function findParticleAt(mx, my) {
  const particles = allVisibleParticles();
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    if (Math.hypot(p.x - mx, p.y - my) <= CONFIG.particleRadius + 3) return p;
  }
  return null;
}

function mousePressed(event) {
  // p5는 마우스 이벤트를 document 전역에서 감지하므로, 팝업 버튼(DOM 요소)을 누르는 순간에도
  // 이 함수가 먼저 실행되어 hideMutationPopup()이 클릭 완료 전에 팝업을 닫아버리는 문제가 있었다.
  // 실제 눌린 대상(event.target)이 팝업 내부라면 이 함수는 아무 것도 하지 않고 지나간다.
  const popup = document.getElementById('mutation-popup');
  if (event && popup && popup.contains(event.target)) return;

  if (mouseX < 0 || mouseX > canvasWidth || mouseY < 0 || mouseY > canvasHeight) return;
  const hit = findParticleAt(mouseX, mouseY);
  if (hit) {
    interactionParticle = hit;
    pressX = mouseX; pressY = mouseY;
    dragMoved = false;
  }
  hideMutationPopup();
}

function mouseDragged() {
  if (!interactionParticle) return;
  const moved = Math.hypot(mouseX - pressX, mouseY - pressY);
  if (moved > 4) dragMoved = true;
  if (dragMoved) {
    interactionParticle.fixed = true;
    interactionParticle.x = constrain(mouseX, CONFIG.particleRadius, canvasWidth - CONFIG.particleRadius);
    interactionParticle.y = constrain(mouseY, CONFIG.particleRadius, canvasHeight - CONFIG.particleRadius);
    interactionParticle.vx = 0;
    interactionParticle.vy = 0;
  }
}

function mouseReleased() {
  if (!interactionParticle) return;
  interactionParticle.fixed = false;
  if (!dragMoved) {
    showMutationPopup(interactionParticle, mouseX, mouseY);
  }
  interactionParticle = null;
}

function showMutationPopup(particle, x, y) {
  const popup = document.getElementById('mutation-popup');
  const canvasRect = document.getElementById('canvas-container').getBoundingClientRect();
  const pageX = canvasRect.left + x + window.scrollX;
  const pageY = canvasRect.top + y + window.scrollY;

  popup.style.left = Math.min(pageX + 12, window.innerWidth - 170) + 'px';
  popup.style.top = pageY + 12 + 'px';
  popup.classList.remove('hidden');

  document.querySelectorAll('.mp-btn').forEach(btn => {
    btn.classList.toggle('current', btn.dataset.type === particle.type);
    btn.onclick = (e) => {
      e.stopPropagation();
      particle.setType(btn.dataset.type);
      hideMutationPopup();
    };
  });

  popup._targetParticle = particle;
}

function hideMutationPopup() {
  document.getElementById('mutation-popup').classList.add('hidden');
}

document.addEventListener('click', (e) => {
  const popup = document.getElementById('mutation-popup');
  if (!popup.contains(e.target) && e.target.id !== 'defaultCanvas0') {
    hideMutationPopup();
  }
});

/* -------------------------------------------------------------------------
   Chart.js: 실시간 ΔG 그래프
   ------------------------------------------------------------------------- */
function setupChart() {
  const ctx = document.getElementById('dg-chart').getContext('2d');
  chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        label: 'ΔG',
        data: [],
        borderColor: '#34406B',
        backgroundColor: 'rgba(52, 64, 107, 0.08)',
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.15,
        fill: true,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      scales: {
        x: {
          display: true,
          grid: { color: '#EEF0F3' },
          ticks: { color: '#6B7078', font: { family: 'JetBrains Mono', size: 9 }, maxTicksLimit: 6 },
        },
        y: {
          grid: { color: '#EEF0F3' },
          ticks: { color: '#6B7078', font: { family: 'JetBrains Mono', size: 9 } },
        },
      },
      plugins: {
        legend: { display: false },
      },
    },
  });
}

function recordHistoryAndUpdateChart() {
  const dG = computeGibbsFreeEnergy();
  lastDG = dG;
  history.push({ frame: frameCounter, temperature, pH, environment, dG });

  chart.data.labels.push(frameCounter);
  chart.data.datasets[0].data.push(dG);
  if (chart.data.labels.length > CONFIG.chartWindow) {
    chart.data.labels.shift();
    chart.data.datasets[0].data.shift();
  }
  chart.update('none');

  document.getElementById('dg-value').textContent = dG.toFixed(2);
  document.getElementById('frame-value').textContent = frameCounter;
}

/* -------------------------------------------------------------------------
   좌측 패널 UI 로직 (사슬 탭, 버튼, 슬라이더)
   ------------------------------------------------------------------------- */
function renderChainTabs() {
  const wrap = document.getElementById('chain-tabs');
  wrap.innerHTML = '';
  for (const chain of chains) {
    const tab = document.createElement('div');
    tab.className = 'chain-tab' + (chain.id === activeChainId ? ' active' : '') +
      (!chain.visible ? ' hidden-chain' : '');

    const nameSpan = document.createElement('span');
    nameSpan.className = 'chain-name';
    nameSpan.textContent = `${chain.name} (${chain.particles.length})`;
    nameSpan.onclick = () => { activeChainId = chain.id; renderChainTabs(); };

    const visBtn = document.createElement('button');
    visBtn.textContent = chain.visible ? '👁' : '🚫';
    visBtn.title = '표시/숨김';
    visBtn.onclick = (e) => { e.stopPropagation(); chain.visible = !chain.visible; renderChainTabs(); };

    const delBtn = document.createElement('button');
    delBtn.textContent = '✕';
    delBtn.title = '삭제';
    delBtn.onclick = (e) => {
      e.stopPropagation();
      disulfideBonds = disulfideBonds.filter(b =>
        b.a.chainId !== chain.id && b.b.chainId !== chain.id);
      chains = chains.filter(c => c.id !== chain.id);
      if (activeChainId === chain.id) {
        activeChainId = chains.length ? chains[0].id : null;
      }
      renderChainTabs();
    };

    tab.appendChild(nameSpan);
    tab.appendChild(visBtn);
    tab.appendChild(delBtn);
    tab.onclick = () => { activeChainId = chain.id; renderChainTabs(); };
    wrap.appendChild(tab);
  }
}

function getActiveChain() {
  return chains.find(c => c.id === activeChainId) || null;
}

function wireUI() {
  document.getElementById('btn-add-chain').onclick = () => {
    const idx = chains.length;
    const chain = new Chain(
      nextChainId++,
      `사슬 ${idx + 1}`,
      80 + (idx % 3) * 40,
      80 + Math.floor(idx / 3) * 60
    );
    chain.addResidue('P');
    chain.addResidue('H');
    chains.push(chain);
    activeChainId = chain.id;
    renderChainTabs();
  };

  document.querySelectorAll('.residue-btn').forEach(btn => {
    btn.onclick = () => {
      const chain = getActiveChain();
      if (!chain) return;
      chain.addResidue(btn.dataset.type);
      renderChainTabs();
    };
  });

  const tempSlider = document.getElementById('temp-slider');
  const tempValue = document.getElementById('temp-value');
  tempSlider.oninput = () => {
    temperature = parseFloat(tempSlider.value);
    tempValue.textContent = temperature.toFixed(0);
  };

  const phSlider = document.getElementById('ph-slider');
  const phValue = document.getElementById('ph-value');
  phSlider.oninput = () => {
    pH = parseFloat(phSlider.value);
    phValue.textContent = pH.toFixed(1);
  };

  const speedSlider = document.getElementById('speed-slider');
  const speedValue = document.getElementById('speed-value');
  speedSlider.oninput = () => {
    simSpeed = parseFloat(speedSlider.value);
    speedValue.textContent = simSpeed.toFixed(2) + 'x';
  };

  document.querySelectorAll('.env-btn').forEach(btn => {
    btn.onclick = () => {
      environment = btn.dataset.env;
      document.querySelectorAll('.env-btn').forEach(b => b.classList.toggle('active', b === btn));
      updateEnvironmentHint();
    };
  });
  updateEnvironmentHint();

  const solventToggle = document.getElementById('btn-toggle-solvent');
  const solventState = document.getElementById('solvent-state');
  if (solventToggle) {
    solventToggle.onclick = () => {
      showSolvent = !showSolvent;
      solventState.textContent = showSolvent ? 'ON' : 'OFF';
      solventToggle.classList.toggle('active', showSolvent);
    };
  }

  const reduceBtn = document.getElementById('btn-reducing-agent');
  const reduceState = document.getElementById('reducing-state');
  reduceBtn.onclick = () => {
    reducingAgent = !reducingAgent;
    reduceState.textContent = reducingAgent ? 'ON' : 'OFF';
    reduceBtn.classList.toggle('active', reducingAgent);
  };

  document.getElementById('btn-pause').onclick = (e) => {
    paused = !paused;
    e.target.textContent = paused ? '▶ 재생' : '⏸ 일시정지';
  };

  document.getElementById('btn-reset').onclick = () => {
    chains = [];
    disulfideBonds = [];
    flashes = [];
    history = [];
    frameCounter = 0;
    nextChainId = 1;
    environment = 'aqueous';
    simSpeed = 1;
    document.getElementById('speed-slider').value = 1;
    document.getElementById('speed-value').textContent = '1.00x';
    document.querySelectorAll('.env-btn').forEach(b => b.classList.toggle('active', b.dataset.env === 'aqueous'));
    updateEnvironmentHint();
    createStarterChain();
    initSolvent();
    if (chart) {
      chart.data.labels = [];
      chart.data.datasets[0].data = [];
      chart.update('none');
    }
  };

  document.getElementById('btn-csv').onclick = downloadCSV;
}

/* -------------------------------------------------------------------------
   CSV 내보내기
   ------------------------------------------------------------------------- */
function downloadCSV() {
  const header = 'Time(Frame),Temperature,pH,Environment,Gibbs Free Energy\n';
  const rows = history.map(h => `${h.frame},${h.temperature},${h.pH},${h.environment},${h.dG.toFixed(4)}`).join('\n');
  const csv = header + rows;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'protein_simulation_dG.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
