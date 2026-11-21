// RCP VR — arrêt cardiaque sur un terrain de sport (Meta Quest 2, WebXR + three.js)
// Outil de formation : ne remplace pas une formation certifiée aux gestes de premiers secours.
import * as THREE from 'three';
import { CPR, CompressionDetector, RateTracker, computeScore, fmtTime, clamp, rateOk, depthOk } from './logic.js';

/* ======================= État ======================= */
const S = {
  mode: 'guided', input: 'hands', vent: true, voice: true, metro: true,
  xr: false, running: false, phase: 'menu', phaseStart: 0, phaseT: 0, t: 0,
  hintPhase: null, ret: 'cpr', dirty: true, notice: '', noticeCol: '#fff', noticeUntil: 0,
  feedback: '', feedbackCol: '#34d399', feedbackUntil: 0,
  dip: 0, team: false, teamT: 0, fall: -1, tilt: 0, rise: 0, gasp: 0, jolt: 0, hold: 0,
  hudAt: 0, result: null, aedAnim: -1, noHands: 0,
};
let R = null; // suivi de l'exercice
const newRun = () => ({
  conscious: false, airway: false, breathOk: false, breathErrors: 0, called: false,
  tFirstComp: null, aedEta: null, aedArrived: false, aedStarted: false,
  comps: [], compCount: 0, cycles2: 0, cprStarted: false, active: false, lastCompT: 0,
  handsOff: 0, cprWindow: 0, ventAttempts: 0, ventValid: 0, ventTimeouts: 0, ventBreaths: 0,
  exposed: false, powered: false, padsPlaced: 0, clearAnnounced: false, shockEarly: false,
  shocked: false, tShock: null, tResume: null, hints: 0, held: null,
});

const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const mat = (c) => new THREE.MeshLambertMaterial({ color: c });
const basic = (c, o = 1) => new THREE.MeshBasicMaterial({ color: c, transparent: o < 1, opacity: o });

/* ======================= Rendu ======================= */
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
try { renderer.xr.setReferenceSpaceType('local-floor'); } catch (e) { /* ok */ }
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a1222);
scene.fog = new THREE.Fog(0x0a1222, 30, 150);
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.05, 300);
camera.position.set(0, 0.95, 0.35);
camera.lookAt(0, 0.25, -0.6);
const world = new THREE.Group();
world.position.set(0.4, 0, -0.6);
scene.add(world);
scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x1d3a1d, 0.9));
const sun = new THREE.DirectionalLight(0xffffff, 1.1);
sun.position.set(-8, 20, 12);
scene.add(sun);
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

/* ======================= Utilitaires de modélisation ======================= */
function limb(a, b, r, m) {
  const d = new THREE.Vector3().subVectors(b, a);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), 10), m);
  mesh.position.copy(a).addScaledVector(d, 0.5);
  mesh.quaternion.setFromUnitVectors(V3(0, 1, 0), d.normalize());
  return mesh;
}
function makePerson({ shirt = 0xcc1020, shorts = 0xffffff, skin = 0xd9a07a, socks = 0xcc1020 }) {
  const g = new THREE.Group();
  for (const s of [-1, 1]) {
    g.add(limb(V3(s * 0.1, 0.09, 0), V3(s * 0.1, 0.5, 0), 0.06, mat(socks)));
    g.add(limb(V3(s * 0.1, 0.5, 0), V3(s * 0.1, 0.85, 0), 0.075, mat(skin)));
    g.add(limb(V3(s * 0.1, 0.85, 0), V3(s * 0.1, 1.0, 0), 0.085, mat(shorts)));
    g.add(limb(V3(s * 0.25, 1.4, 0), V3(s * 0.3, 1.12, 0.05), 0.05, mat(shirt)));
    g.add(limb(V3(s * 0.3, 1.12, 0.05), V3(s * 0.28, 0.9, 0.08), 0.045, mat(skin)));
  }
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.55, 0.24), mat(shirt)); torso.position.y = 1.22; g.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 14, 10), mat(skin)); head.position.y = 1.64; g.add(head);
  return g;
}
function makeKneeler() {
  const g = new THREE.Group(); const upper = new THREE.Group(); g.add(upper);
  const vest = mat(0xfacc15), dark = mat(0x1f2937), skin = mat(0xd9a07a);
  for (const s of [-1, 1]) {
    g.add(limb(V3(s * 0.1, 0.07, -0.45), V3(s * 0.1, 0.09, 0), 0.06, dark));
    g.add(limb(V3(s * 0.1, 0.09, 0), V3(s * 0.1, 0.5, -0.15), 0.08, dark));
    upper.add(limb(V3(s * 0.17, 0.92, 0.2), V3(s * 0.05, 0.27, 0.55), 0.045, s < 0 ? vest : skin));
  }
  upper.add(limb(V3(0, 0.5, -0.15), V3(0, 0.92, 0.2), 0.17, vest));
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 14, 10), skin); head.position.set(0, 1.03, 0.3); upper.add(head);
  return { g, upper };
}

/* ======================= Décor : stade ======================= */
function pitchTexture() {
  const c = document.createElement('canvas'); c.width = 2048; c.height = 1326; const g = c.getContext('2d');
  const k = 2048 / 105;
  for (let i = 0; i < 14; i++) { g.fillStyle = i % 2 ? '#2f8f3a' : '#37a044'; g.fillRect(i * 2048 / 14, 0, 2048 / 14 + 1, 1326); }
  g.strokeStyle = '#fff'; g.lineWidth = 6;
  const line = (x, y, w, h) => g.strokeRect(x * k, y * k, w * k, h * k);
  line(1, 1, 103, 66); g.beginPath(); g.moveTo(52.5 * k, 0); g.lineTo(52.5 * k, 1326); g.stroke();
  g.beginPath(); g.arc(52.5 * k, 34 * k, 9.15 * k, 0, 7); g.stroke();
  line(1, 13.85, 16.5, 40.3); line(104 - 16.5, 13.85, 16.5, 40.3); line(1, 24.85, 5.5, 18.3); line(104 - 5.5, 24.85, 5.5, 18.3);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function boardsTexture() {
  const c = document.createElement('canvas'); c.width = 2048; c.height = 64; const g = c.getContext('2d');
  g.fillStyle = '#0b3d91'; g.fillRect(0, 0, 2048, 64); g.fillStyle = '#fff'; g.font = 'bold 34px sans-serif'; g.textBaseline = 'middle';
  for (let i = 0; i < 4; i++) g.fillText('❤  SAUVER UNE VIE : RCP + DAE  ·  APPELEZ LE 112  ·  ', i * 520, 34);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.repeat.set(3, 1); return t;
}
(function buildStadium() {
  const pitch = new THREE.Mesh(new THREE.PlaneGeometry(105, 68), new THREE.MeshLambertMaterial({ map: pitchTexture() }));
  pitch.rotation.x = -Math.PI / 2; pitch.position.set(0, 0, 30.4); world.add(pitch);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), mat(0x16301a));
  ground.rotation.x = -Math.PI / 2; ground.position.set(0, -0.02, 0); world.add(ground);
  const boards = new THREE.Mesh(new THREE.BoxGeometry(100, 0.9, 0.08), new THREE.MeshBasicMaterial({ map: boardsTexture() }));
  boards.position.set(0, 0.45, -4.3); world.add(boards);
  const tierMat = mat(0x39445c); const colors = [0xd0102a, 0xffffff, 0xd0102a, 0x1e40af, 0xf5f5f5];
  const crowd = new THREE.InstancedMesh(new THREE.BoxGeometry(0.42, 0.7, 0.3), mat(0xffffff), 12 * 190);
  const m4 = new THREE.Matrix4(); const col = new THREE.Color(); let n = 0;
  for (let i = 0; i < 12; i++) {
    const h = 0.55 * (i + 1);
    const tier = new THREE.Mesh(new THREE.BoxGeometry(120, h, 0.9), tierMat); tier.position.set(0, h / 2, -6 - i * 0.9); world.add(tier);
    for (let x = -52; x < 52; x += 0.55) {
      if (n >= 12 * 190) break;
      m4.setPosition(x + Math.random() * 0.1, h + 0.35, -6 - i * 0.9 + 0.05); crowd.setMatrixAt(n, m4);
      col.setHex(colors[(Math.random() * colors.length) | 0]); crowd.setColorAt(n, col); n++;
    }
  }
  crowd.count = n; crowd.instanceColor.needsUpdate = true; world.add(crowd);
  for (const x of [-48, 48]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 28, 8), mat(0x888888)); pole.position.set(x, 14, -6); world.add(pole);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(6, 3, 0.5), basic(0xfff6d0)); lamp.position.set(x, 28, -5); world.add(lamp);
  }
})();

/* ======================= Patient ======================= */
const patient = (() => {
  const pivot = new THREE.Group(); pivot.position.set(1.05, 0, 0); world.add(pivot);
  const body = new THREE.Group(); body.position.set(-1.05, 0, 0); pivot.add(body);
  const skin = mat(0xd9a07a), shirt = mat(0xcc1020), shorts = mat(0xf5f5f5);
  const headG = new THREE.Group(); headG.position.set(-0.68, 0.11, 0); body.add(headG);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), skin); head.position.set(-0.15, 0.02, 0); headG.add(head);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.115, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2.2), mat(0x3a2a1a)); hair.position.copy(head.position); hair.rotation.z = 1.2; headG.add(hair);
  body.add(limb(V3(-0.72, 0.11, 0), V3(-0.6, 0.11, 0), 0.05, skin));
  const torsoG = new THREE.Group(); torsoG.position.set(-0.35, 0.12, 0); body.add(torsoG);
  torsoG.add(new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.2, 0.4), skin));
  const jersey = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.22, 0.42), shirt); torsoG.add(jersey);
  const pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.18, 0.34), shorts); pelvis.position.set(0.075, 0.1, 0); body.add(pelvis);
  for (const s of [-1, 1]) {
    body.add(limb(V3(0.15, 0.09, s * 0.09), V3(0.5, 0.08, s * 0.09), 0.08, shorts));
    body.add(limb(V3(0.5, 0.08, s * 0.09), V3(0.85, 0.07, s * 0.09), 0.065, skin));
    body.add(limb(V3(0.85, 0.07, s * 0.09), V3(1.05, 0.07, s * 0.09), 0.065, shirt));
    body.add(limb(V3(-0.55, 0.08, s * 0.27), V3(-0.4, 0.08, s * 0.3), 0.055, shirt));
    body.add(limb(V3(-0.4, 0.08, s * 0.3), V3(-0.05, 0.06, s * 0.3), 0.045, skin));
  }
  const chestAnchor = new THREE.Object3D(); chestAnchor.position.set(-0.4, 0.22, 0); body.add(chestAnchor);
  return { pivot, body, headG, torsoG, jersey, chestAnchor };
})();
patient.pivot.visible = false;

/* ======================= Hotspots interactifs ======================= */
const interactives = [];
function addInteractive(obj, onClick) { obj.userData.onClick = onClick; obj.userData.active = false; interactives.push(obj); return obj; }
function hotspot(parent, pos, r, color, onClick) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, depthWrite: false, depthTest: false }));
  m.position.copy(pos); m.renderOrder = 20; m.userData.hot = true; parent.add(m); return addInteractive(m, onClick);
}
const H = {};
H.shoulderL = hotspot(patient.body, V3(-0.58, 0.26, -0.24), 0.08, 0x38bdf8, () => onHot('shoulder'));
H.shoulderR = hotspot(patient.body, V3(-0.58, 0.26, 0.24), 0.08, 0x38bdf8, () => onHot('shoulder'));
H.forehead = hotspot(patient.headG, V3(-0.21, 0.15, 0), 0.08, 0xa78bfa, () => onHot('forehead'));
H.mouth = hotspot(patient.headG, V3(-0.08, 0.15, 0), 0.07, 0xf472b6, () => { /* maintien géré dans update */ });
H.chest = hotspot(patient.body, V3(-0.4, 0.27, 0), 0.1, 0xfacc15, () => onHot('chest'));

/* ======================= DAE ======================= */
const aedScreen = (() => { const c = document.createElement('canvas'); c.width = 256; c.height = 128; const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return { c, t }; })();
function setAedScreen(lines, color = '#22c55e') {
  const g = aedScreen.c.getContext('2d'); g.fillStyle = '#04120a'; g.fillRect(0, 0, 256, 128);
  g.fillStyle = color; g.font = 'bold 22px sans-serif'; g.textAlign = 'center';
  lines.forEach((l, i) => g.fillText(l, 128, 34 + i * 30)); aedScreen.t.needsUpdate = true;
}
setAedScreen(['DAE', 'éteint'], '#64748b');
const aed = new THREE.Group(); const AED_REST = V3(0.1, 0, -1.0);
aed.position.copy(AED_REST); aed.visible = false; world.add(aed);
aed.add(Object.assign(new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.26), mat(0xf1f5f9)), { position: V3(0, 0.05, 0) }));
const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.17, 0.085), new THREE.MeshBasicMaterial({ map: aedScreen.t }));
scr.rotation.x = -Math.PI / 2; scr.position.set(-0.05, 0.102, -0.03); aed.add(scr);
const btnPower = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 16), mat(0x16a34a)); btnPower.position.set(0.1, 0.108, -0.06); aed.add(btnPower);
const btnShockMat = mat(0x6b7280);
const btnShock = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.02, 16), btnShockMat); btnShock.position.set(0.1, 0.108, 0.05); aed.add(btnShock);
H.aedPower = hotspot(aed, V3(0.1, 0.16, -0.06), 0.06, 0x22c55e, () => onHot('aedPower'));
H.aedShock = hotspot(aed, V3(0.1, 0.16, 0.05), 0.06, 0xf97316, () => onHot('aedShock'));
const pads = [0, 1].map((i) => {
  const g = new THREE.Group(); g.userData = { placed: false, home: V3(-0.08 + i * 0.16, 0.112, 0.07) };
  g.add(new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.008, 0.1), mat(0x3b82f6)));
  g.add(Object.assign(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.01, 0.04), mat(0xffffff)), { position: V3(0, 0.002, 0) }));
  g.position.copy(g.userData.home); aed.add(g);
  const hit = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.3, depthWrite: false, depthTest: false }));
  hit.renderOrder = 20; g.add(hit); hit.userData.pad = g; hit.userData.hot = true; addInteractive(hit, (inp) => onPad(g, inp)); g.userData.hit = hit; return g;
});
const rings = [V3(-0.52, 0.232, 0.1), V3(-0.22, 0.232, -0.17)].map((p) => {
  const m = new THREE.Mesh(new THREE.RingGeometry(0.06, 0.085, 24), new THREE.MeshBasicMaterial({ color: 0x22d3ee, side: THREE.DoubleSide, transparent: true, opacity: 0.9, depthTest: false }));
  m.rotation.x = -Math.PI / 2; m.position.copy(p); m.renderOrder = 20; m.userData.hot = true; patient.body.add(m); m.visible = false;
  addInteractive(m, (inp) => onRing(m)); return m;
});
const wires = [0, 1].map(() => { const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([V3(), V3()]), new THREE.LineBasicMaterial({ color: 0xfacc15 })); l.frustumCulled = false; l.visible = false; scene.add(l); return l; });
const aedMedic = makePerson({ shirt: 0xfacc15, shorts: 0x1f2937, socks: 0x1f2937 }); aedMedic.visible = false; world.add(aedMedic);

/* ======================= Joueurs / soigneurs ======================= */
const npcs = [];
[[-30, 0xcc1020, 1], [0, 0xcc1020, 0], [25, 0x1e40af, 0], [150, 0x1e40af, 0], [180, 0xcc1020, 0], [210, 0xfacc15, 1], [240, 0xfacc15, 1], [270, 0x1e40af, 0]].forEach(([a, c, med], i) => {
  const o = makePerson(med ? { shirt: c, shorts: 0x1f2937, socks: 0x1f2937 } : { shirt: c, shorts: 0xffffff, socks: c });
  o.visible = false; world.add(o);
  npcs.push({ o, ang: a * Math.PI / 180, r: 10, target: 3.0, ph: i * 1.3 });
});
const kneeler = makeKneeler(); kneeler.g.position.set(-0.4, 0, -0.55); kneeler.g.visible = false; world.add(kneeler.g);

/* ======================= Mains virtuelles + manettes ======================= */
const raycaster = new THREE.Raycaster(); raycaster.far = 20;
const inputs = [];
function makeHand() { const g = new THREE.Group(); const m = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.035, 0.11), mat(0xe8b89a)); m.position.z = 0.02; g.add(m); return g; }
for (let i = 0; i < 2; i++) {
  const ctrl = renderer.xr.getController(i); scene.add(ctrl);
  ctrl.add(makeHand());
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([V3(0, 0, 0), V3(0, 0, -1)]), new THREE.LineBasicMaterial({ color: 0x38bdf8 }));
  line.scale.z = 2; ctrl.add(line);
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 8), basic(0xffffff)); ctrl.add(dot);
  const inp = { id: 'xr' + i, ctrl, line, dot, down: false, hit: null, src: null, wasB: false };
  ctrl.addEventListener('connected', (e) => { inp.src = e.data; ctrl.visible = true; });
  ctrl.addEventListener('disconnected', () => { inp.src = null; });
  ctrl.addEventListener('selectstart', () => onDown(inp)); ctrl.addEventListener('selectend', () => onUp(inp));
  inputs.push(inp);
}
const mouse = { id: 'mouse', down: false, hit: null, ndc: new THREE.Vector2(9, 9) };
renderer.domElement.addEventListener('pointermove', (e) => { mouse.ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); });
renderer.domElement.addEventListener('pointerdown', (e) => { mouse.ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); if (!S.xr) { pickFor(mouse); onDown(mouse); } });
renderer.domElement.addEventListener('pointerup', () => { if (!S.xr) onUp(mouse); });
window.addEventListener('keydown', (e) => { if (e.code === 'Space' && !e.repeat && isCprPhase()) { e.preventDefault(); tap(); } });

function pickFor(inp) {
  if (inp === mouse) { if (S.xr) { inp.hit = null; return; } raycaster.setFromCamera(mouse.ndc, camera); }
  else {
    const o = V3(), d = V3(0, 0, -1), q = new THREE.Quaternion();
    inp.ctrl.getWorldPosition(o); inp.ctrl.getWorldQuaternion(q); d.applyQuaternion(q); raycaster.set(o, d);
  }
  const objs = interactives.filter((x) => x.userData.active && x.parent);
  const hits = raycaster.intersectObjects(objs, false);
  inp.hit = hits[0] || null;
}
function onDown(inp) {
  inp.down = true;
  if (!S.xr && inp !== mouse) return;
  const h = inp.hit;
  if (h) { const o = h.object; if (o.userData.panel) { const b = o.userData.panel.hitButton(h.uv); if (b && !b.disabled) b.fn(inp); } else if (o.userData.onClick) o.userData.onClick(inp); return; }
  if (S.phase === 'calib') calibrate(); else if (isCprPhase() && (S.input === 'trigger' || inp === mouse)) tap();
}
function onUp(inp) { inp.down = false; }
function haptic() { for (const i of inputs) { try { i.src?.gamepad?.hapticActuators?.[0]?.pulse(0.6, 30); } catch (e) { /* ok */ } } }

/* ======================= Panneau HUD ======================= */
class Panel {
  constructor(w, h, mw, mh, draw) {
    this.w = w; this.h = h; this.draw = draw; this.buttons = []; this.hover = null;
    this.c = document.createElement('canvas'); this.c.width = w; this.c.height = h; this.ctx = this.c.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.c); this.tex.colorSpace = THREE.SRGBColorSpace; this.tex.anisotropy = 4;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(mw, mh), new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false }));
    this.mesh.userData.panel = this; this.mesh.userData.active = true; interactives.push(this.mesh);
  }
  render() { this.buttons = []; this.draw(this.ctx, this); this.tex.needsUpdate = true; }
  btn(label, x, y, w, h, fn, { color = '#2563eb', disabled = false } = {}) {
    const g = this.ctx; const b = { x, y, w, h, fn, disabled, label };
    this.buttons.push(b);
    g.fillStyle = disabled ? '#334155' : (this.hover === b || (this.hover && this.hover.label === label) ? '#60a5fa' : color);
    rr(g, x, y, w, h, 14); g.fill();
    g.fillStyle = disabled ? '#94a3b8' : '#fff'; g.font = 'bold 26px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    wrapText(g, label, x + w / 2, y + h / 2 - (label.length > 26 ? 14 : 0), w - 24, 30, 'center');
    return b;
  }
  hitButton(uv) {
    if (!uv) return null; const px = uv.x * this.w, py = (1 - uv.y) * this.h;
    return this.buttons.find((b) => px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) || null;
  }
}
function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function wrapText(g, text, x, y, maxW, lh, align = 'left') {
  g.textAlign = align; g.textBaseline = 'middle';
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const w of para.split(' ')) {
      const t = line ? line + ' ' + w : w;
      if (g.measureText(t).width > maxW && line) { g.fillText(line, x, y); line = w; y += lh; } else line = t;
    }
    g.fillText(line, x, y); y += lh;
  }
  return y;
}
const txt = (g, s, x, y, size, col = '#fff', align = 'left', weight = '600') => { g.font = `${weight} ${size}px sans-serif`; g.fillStyle = col; g.textAlign = align; g.textBaseline = 'middle'; g.fillText(s, x, y); };
const showGuide = () => S.mode === 'guided' || S.hintPhase === S.phase;
const isCprPhase = () => S.phase === 'cpr' || S.phase === 'cpr2';

const TITLES = {
  calib: 'Calibrage', intro: 'Première mi-temps — un joueur s\'effondre', consc: 'Vérifier la conscience', airway: 'Libérer les voies aériennes',
  breath: 'Respire-t-il normalement ?', call: 'Alerter les secours', cpr: 'Compressions thoraciques', vent: '2 insufflations',
  aed_expose: 'DAE arrivé : dénuder le thorax', aed_power: 'Allumer le DAE', aed_pads: 'Poser les électrodes', aed_analyse: 'Analyse du rythme',
  aed_shock: 'Choc électrique', cpr2: 'Reprendre immédiatement', end: 'Débriefing',
};
const TEXT = {
  consc: 'Le joueur est au sol, immobile. Secouez doucement ses épaules en lui parlant fort : pointez une sphère bleue (épaule) et appuyez sur la gâchette.',
  airway: 'Aucune réponse. Appelez à l\'aide, puis basculez la tête en arrière et élevez le menton : pointez la sphère violette (front) et appuyez sur la gâchette.',
  breath: 'Regardez le thorax, écoutez, sentez : 10 secondes maximum. Attention : des gasps irréguliers ne sont pas une respiration normale.',
  call: 'Le joueur ne répond pas et ne respire pas normalement : c\'est un arrêt cardiaque. Faites alerter les secours (112 / 15 / équipe médicale du stade) et apporter un DAE.',
  cpr: 'Mains superposées au centre de la poitrine, bras tendus. Appuyez de 5 à 6 cm, 100 à 120 fois par minute, en relâchant complètement. Suivez le métronome. Après 30 compressions : 2 insufflations.',
  vent: 'Pincez le nez, bouche sur bouche : maintenez la gâchette environ 1 seconde sur la sphère rose, relâchez, recommencez. 2 insufflations en moins de 10 secondes.',
  aed_expose: 'Un coéquipier prend le relais des compressions. Dénudez le thorax : pointez la sphère jaune (ciseaux) et appuyez sur la gâchette.',
  aed_power: 'Appuyez sur le bouton vert du DAE : l\'appareil vous guide à la voix.',
  aed_pads: 'Saisissez une électrode (pointez-la, gâchette), puis cliquez sur un cercle bleu sur le thorax. Répétez pour la seconde.',
  aed_analyse: 'Ne touchez plus le patient. Le DAE analyse le rythme cardiaque.',
  aed_shock: 'Choc conseillé. Annoncez « Écartez-vous ! », vérifiez que personne ne touche le patient, puis appuyez sur le bouton orange du DAE.',
  cpr2: 'Reprenez les compressions IMMÉDIATEMENT, sans attendre de signe de réveil. 2 cycles 30:2, jusqu\'à l\'arrivée des secours.',
};
const STEPS = [['consc', 'Conscience'], ['airway', 'Voies aériennes'], ['breath', 'Respiration'], ['call', 'Alerte + DAE'], ['cpr', 'RCP 30:2'], ['aed_expose', 'Thorax nu'], ['aed_pads', 'Électrodes'], ['aed_analyse', 'Analyse + choc'], ['cpr2', 'Reprise RCP']];
const STEP_OF = { consc: 0, airway: 1, breath: 2, call: 3, cpr: 4, vent: 4, aed_expose: 5, aed_power: 5, aed_pads: 6, aed_analyse: 7, aed_shock: 7, cpr2: 8 };

function lastRate() { return S.lastRate ?? null; }
const hud = new Panel(1024, 640, 1.28, 0.8, (g, P) => {
  const W = P.w, Hh = P.h;
  g.clearRect(0, 0, W, Hh); g.fillStyle = 'rgba(8,14,28,0.95)'; rr(g, 0, 0, W, Hh, 28); g.fill();
  g.fillStyle = '#16233f'; g.fillRect(0, 0, W, 78);
  txt(g, TITLES[S.phase] || 'RCP en VR', 28, 40, S.phase === 'intro' ? 30 : 36, '#fff', 'left', '700');
  if (S.running && S.phase !== 'end') txt(g, 'T+ ' + fmtTime(S.t), W - 28, 40, 36, '#7dd3fc', 'right', '700');
  if (S.phase === 'end') return drawEnd(g, P);
  const guided = S.mode === 'guided';
  let x0 = 36;
  if (guided && STEP_OF[S.phase] != null) {
    const cur = STEP_OF[S.phase]; x0 = 320;
    STEPS.forEach(([k, label], i) => {
      const y = 112 + i * 46; const done = i < cur, act = i === cur;
      g.fillStyle = act ? '#2563eb' : done ? '#14532d' : '#1e293b'; rr(g, 20, y - 18, 276, 38, 10); g.fill();
      txt(g, (done ? '✓ ' : act ? '▶ ' : '') + label, 34, y + 1, 22, done ? '#86efac' : '#fff');
    });
  }
  const mw = W - x0 - 36;
  const guide = showGuide();
  g.fillStyle = '#e2e8f0'; g.font = '27px sans-serif';
  const body = guide ? (TEXT[S.phase] || '') : (S.phase === 'intro' ? '' : 'Mode évaluation : agissez selon le protocole. Le bouton « Indice » affiche l\'étape et les repères (−3 points).');
  let y = 120;
  if (S.phase === 'intro') {
    g.fillStyle = '#e2e8f0'; g.font = '28px sans-serif';
    y = wrapText(g, 'Un joueur s\'effondre sans contact au milieu du terrain. Le stade se tait. Vous êtes le premier secouriste à ses côtés.', x0, y + 10, mw, 38);
    g.fillStyle = '#94a3b8'; g.font = '22px sans-serif';
    wrapText(g, 'Scénario inspiré de l\'arrêt cardiaque survenu lors de l\'Euro 2020 (juin 2021) : une RCP immédiate et un défibrillateur ont permis de sauver le joueur.', x0, y + 30, mw, 30);
    P.btn('Passer ▶', W - 220, Hh - 80, 190, 56, () => go('consc'), { color: '#334155' });
  } else if (isCprPhase()) drawCpr(g, P, x0, guide);
  else {
    y = wrapText(g, body, x0, y + 10, mw, 36);
    drawPhaseExtras(g, P, x0, mw, y);
  }
  if (S.mode === 'exam' && !guide && S.phase !== 'calib' && S.phase !== 'intro') P.btn('💡 Indice (−3 pts)', 36, Hh - 80, 260, 56, useHint, { color: '#7c3aed' });
  if (performance.now() < S.noticeUntil) {
    g.fillStyle = 'rgba(15,23,42,0.96)'; rr(g, 310, Hh - 76, W - 340, 58, 14); g.fill(); g.strokeStyle = S.noticeCol; g.lineWidth = 3; g.stroke();
    g.font = '700 22px sans-serif'; g.fillStyle = S.noticeCol; g.textAlign = 'center'; g.textBaseline = 'middle'; wrapText(g, S.notice, 310 + (W - 340) / 2, Hh - 47 - (g.measureText(S.notice).width > W - 380 ? 12 : 0), W - 380, 26, 'center');
  }
});
hud.mesh.visible = false; scene.add(hud.mesh);

function drawPhaseExtras(g, P, x0, mw, y) {
  const W = P.w, Hh = P.h;
  if (S.phase === 'calib') {
    y = wrapText(g, 'Mettez-vous à genoux (ou restez debout / assis), côté patient. Posez vos deux manettes l\'une sur l\'autre à l\'endroit où la poitrine du joueur doit apparaître, puis appuyez sur la gâchette. (B/Y : recentrer ce panneau)', x0, 130, mw, 36);
    P.btn('Calibrer maintenant', x0, Hh - 110, 380, 64, calibrate, { color: '#16a34a' });
  } else if (S.phase === 'breath') {
    const left = Math.max(0, 10 - S.phaseT);
    g.strokeStyle = '#334155'; g.lineWidth = 12; g.beginPath(); g.arc(x0 + 60, 300, 50, 0, 7); g.stroke();
    g.strokeStyle = '#38bdf8'; g.beginPath(); g.arc(x0 + 60, 300, 50, -Math.PI / 2, -Math.PI / 2 + Math.min(1, S.phaseT / 10) * 2 * Math.PI); g.stroke();
    txt(g, String(Math.ceil(left)), x0 + 60, 300, 40, '#fff', 'center', '700');
    if (S.phaseT >= 10) {
      P.btn('Respiration normale', x0, 400, 320, 90, () => decideBreath(true), { color: '#475569' });
      P.btn('Pas de respiration normale (gasps)', x0 + 340, 400, 320, 90, () => decideBreath(false), { color: '#dc2626' });
    } else txt(g, 'Observation en cours…', x0 + 140, 300, 26, '#94a3b8');
  } else if (S.phase === 'call') {
    P.btn('📞 Appeler les secours + demander le DAE', x0, Hh - 210, mw, 80, doCall, { color: '#dc2626' });
  } else if (S.phase === 'vent') {
    const bx = x0, by = 300;
    for (let i = 0; i < 2; i++) { g.fillStyle = i < R.ventBreaths ? '#22c55e' : '#334155'; g.beginPath(); g.arc(bx + 40 + i * 90, by, 32, 0, 7); g.fill(); txt(g, String(i + 1), bx + 40 + i * 90, by, 30, '#fff', 'center', '700'); }
    g.fillStyle = '#334155'; rr(g, x0 + 200, by - 16, 260, 32, 12); g.fill();
    g.fillStyle = S.hold >= 0.6 && S.hold <= 2.2 ? '#22c55e' : '#f59e0b'; rr(g, x0 + 200, by - 16, Math.max(1, Math.min(1, S.hold / 2.2) * 260), 32, 12); g.fill();
    txt(g, 'maintien : ' + S.hold.toFixed(1) + ' s (cible 0,6–2 s)', x0 + 200, by + 40, 20, '#94a3b8');
    txt(g, 'Temps : ' + Math.max(0, CPR.VENT_MAX_S - S.phaseT).toFixed(0) + ' s', x0 + 490, by, 28, '#fbbf24');
  } else if (S.phase === 'aed_shock') {
    P.btn('📢 « Écartez-vous ! »', x0, Hh - 210, 380, 80, doClear, { color: R.clearAnnounced ? '#14532d' : '#f59e0b', disabled: R.clearAnnounced });
    txt(g, R.clearAnnounced ? 'Zone dégagée — appuyez sur le bouton orange du DAE.' : 'Étape 1 : annoncer, regarder autour de vous.', x0 + 400, Hh - 170, 22, '#cbd5e1');
  } else if (S.phase === 'aed_analyse') {
    txt(g, 'Analyse… ' + Math.max(0, 6 - S.phaseT).toFixed(0) + ' s', x0, 300, 40, '#f59e0b', 'left', '700');
  } else if (S.phase === 'aed_pads') {
    txt(g, `Électrodes posées : ${R.padsPlaced} / 2`, x0, 330, 34, '#38bdf8', 'left', '700');
  }
}
function drawCpr(g, P, x0, guide) {
  const W = P.w, Hh = P.h;   const cnt = R.compCount;
  txt(g, `Compressions  ${cnt} / ${CPR.CYCLE}`, x0, 112, 38, '#fff', 'left', '700');
  g.fillStyle = '#1e293b'; rr(g, x0, 142, W - x0 - 36, 18, 9); g.fill(); g.fillStyle = '#38bdf8'; rr(g, x0, 142, Math.max(0, (W - x0 - 36) * cnt / CPR.CYCLE), 18, 9); g.fill();
  txt(g, guide ? 'Bras tendus · 5–6 cm · 100–120/min · relâchez complètement' : '', x0, 190, 22, '#94a3b8');
  if (!guide) { txt(g, 'Continuez : 30 compressions, puis 2 insufflations.', x0, 210, 26, '#94a3b8'); return; }
  // cadran de fréquence
  const cx = x0 + 190, cy = 420, r = 150, a0 = Math.PI, span = Math.PI;
  const ang = (bpm) => a0 + (clamp(bpm, 60, 160) - 60) / 100 * span;
  g.lineWidth = 26; g.strokeStyle = '#334155'; g.beginPath(); g.arc(cx, cy, r, a0, a0 + span); g.stroke();
  g.strokeStyle = '#22c55e'; g.beginPath(); g.arc(cx, cy, r, ang(100), ang(120)); g.stroke();
  const rate = lastRate();
  if (rate != null) { const a = ang(rate); g.strokeStyle = '#fff'; g.lineWidth = 6; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * (r - 20), cy + Math.sin(a) * (r - 20)); g.stroke(); }
  txt(g, rate != null ? Math.round(rate) + ' /min' : '— /min', cx, cy + 40, 36, rate != null && rateOk(rate) ? '#86efac' : '#fbbf24', 'center', '700');
  txt(g, '100–120', cx, cy - 55, 20, '#94a3b8', 'center');
  // jauge de profondeur
  const bx = x0 + 420, top = 225, bot = 455, hgt = bot - top; const ypos = (cm) => bot - clamp(cm, 0, 8) / 8 * hgt;
  g.fillStyle = '#1e293b'; rr(g, bx, top, 50, hgt, 12); g.fill();
  g.fillStyle = 'rgba(34,197,94,0.55)'; g.fillRect(bx, ypos(6), 50, ypos(5) - ypos(6));
  const d = S.lastDepth;
  if (d != null) { g.fillStyle = depthOk(d) ? '#fff' : '#fbbf24'; g.fillRect(bx - 8, ypos(d) - 4, 66, 8); }
  txt(g, d != null ? d.toFixed(1) + ' cm' : '— cm', bx + 25, bot + 26, 26, d != null && depthOk(d) ? '#86efac' : '#fbbf24', 'center', '700');
  txt(g, '5–6 cm', bx + 80, ypos(5.5), 20, '#94a3b8', 'left');
  // métronome
  const ph = Metro.phase(); const pulse = Metro.on ? Math.max(0, 1 - ph * 3.5) : 0;
  g.fillStyle = `rgba(56,189,248,${0.25 + 0.75 * pulse})`; g.beginPath(); g.arc(x0 + 610, 330, 38 + 10 * pulse, 0, 7); g.fill();
  txt(g, S.metro ? '110/min' : 'métr. off', x0 + 610, 330, 18, '#fff', 'center', '700');
  if (performance.now() < S.feedbackUntil) txt(g, S.feedback, x0, 522, 30, S.feedbackCol, 'left', '700');
  else if (S.noHands > 1.2 && S.input === 'hands') txt(g, 'Placez vos mains sur la poitrine du patient', x0, 522, 28, '#fbbf24', 'left', '700');
  else if (!R.cprStarted || R.tFirstComp == null) txt(g, 'Commencez les compressions !', x0, 522, 30, '#38bdf8', 'left', '700');
  if (R.aedArrived && !R.aedStarted && S.phase === 'cpr') txt(g, '🩺 DAE arrivé : terminez le cycle puis déployez-le', x0, 552, 22, '#f97316', 'left', '700');
  else if (R.aedEta != null && !R.aedArrived) txt(g, `DAE en route : ~${Math.max(0, Math.ceil(R.aedEta - S.t))} s`, x0, 552, 22, '#94a3b8');
}
function drawEnd(g, P) {
  const W = P.w, Hh = P.h, res = S.result;
  txt(g, String(res.total), 130, 150, 100, res.total >= 80 ? '#22c55e' : res.total >= 60 ? '#f59e0b' : '#ef4444', 'center', '800'); txt(g, '/ 100', 130, 220, 28, '#94a3b8', 'center');
  txt(g, S.bestText || '', 130, 255, 20, '#94a3b8', 'center');
  res.parts.forEach((p, i) => {
    const y = 108 + i * 52; txt(g, p.name, 250, y, 20, '#e2e8f0');
    g.fillStyle = '#1e293b'; rr(g, 250, y + 14, 230, 14, 7); g.fill(); g.fillStyle = p.pts / p.max > 0.7 ? '#22c55e' : p.pts / p.max > 0.4 ? '#f59e0b' : '#ef4444'; rr(g, 250, y + 14, Math.max(8, 230 * p.pts / p.max), 14, 7); g.fill();
    txt(g, `${p.pts}/${p.max}`, 495, y + 21, 18, '#94a3b8', 'left');
  });
  g.fillStyle = '#cbd5e1'; g.font = '19px sans-serif'; let y = 112;
  for (const f of res.feedback.slice(0, 9)) { y = wrapText(g, '• ' + f, 590, y, 410, 25) + 6; }
  P.btn('↻ Rejouer', 36, Hh - 92, 250, 60, () => { startRun(); }, { color: '#16a34a' });
  P.btn('Quitter', W - 290, Hh - 92, 250, 60, quit, { color: '#475569' });
}
function placeHud() {
  const p = camera.position.clone(); const f = V3(0, 0, -1).applyQuaternion(camera.quaternion); f.y = 0;
  if (f.length() < 0.2) f.set(0, 0, -1); f.normalize();
  hud.mesh.position.set(p.x + f.x * 1.25, p.y - 0.12, p.z + f.z * 1.25);
  hud.mesh.lookAt(p.x, p.y - 0.12, p.z); hud.mesh.visible = true; S.dirty = true;
}

/* ======================= Audio ======================= */
const Au = {
  ctx: null,
  init() {
    if (this.ctx) return; const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    this.ctx = new AC(); this.out = this.ctx.createGain(); this.out.gain.value = 0.7; this.out.connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 2, b = this.ctx.createBuffer(1, len, this.ctx.sampleRate), d = b.getChannelData(0); let l = 0;
    for (let i = 0; i < len; i++) { l = (l + 0.04 * (Math.random() * 2 - 1)) / 1.04; d[i] = l * 7; }
    const src = this.ctx.createBufferSource(); src.buffer = b; src.loop = true;
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700;
    this.cg = this.ctx.createGain(); this.cg.gain.value = 0.12; src.connect(lp); lp.connect(this.cg); this.cg.connect(this.out); src.start();
  },
  crowd(v, ramp = 1) { if (this.ctx) this.cg.gain.setTargetAtTime(v, this.ctx.currentTime, ramp / 3); },
  tone(f, d = 0.1, v = 0.25, type = 'sine', at = 0) {
    if (!this.ctx) return; const t = this.ctx.currentTime + at, o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.value = f; g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d); o.connect(g); g.connect(this.out); o.start(t); o.stop(t + d + 0.02);
  },
  noise(d = 0.4, v = 0.4, fc = 1500) {
    if (!this.ctx) return; const n = this.ctx.sampleRate * d, b = this.ctx.createBuffer(1, n, this.ctx.sampleRate), x = b.getChannelData(0);
    for (let i = 0; i < n; i++) x[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = this.ctx.createBufferSource(); s.buffer = b; const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = fc; const g = this.ctx.createGain(); g.gain.value = v; s.connect(f); f.connect(g); g.connect(this.out); s.start();
  },
  ok() { this.tone(880, 0.12, 0.2); this.tone(1320, 0.15, 0.2, 'sine', 0.1); }, bad() { this.tone(180, 0.35, 0.3, 'square'); },
  aed() { this.tone(1000, 0.15, 0.25, 'square'); this.tone(1000, 0.15, 0.25, 'square', 0.25); },
  shock() { this.noise(0.5, 0.6, 3000); this.tone(60, 0.5, 0.6); }, breath() { this.noise(0.8, 0.25, 900); }, gasp() { this.noise(0.5, 0.15, 500); },
  cheer() { this.crowd(0.5, 1.5); setTimeout(() => this.crowd(0.15, 4), 6000); },
};
const Metro = {
  on: false, t0: 0, next: 0,
  start() { if (!S.metro || S.mode !== 'guided') { this.on = false; return; } if (!Au.ctx) { this.on = true; this.t0 = performance.now() / 1000; this.next = this.t0; return; } this.on = true; this.t0 = Au.ctx.currentTime + 0.05; this.next = this.t0; },
  stop() { this.on = false; },
  now() { return Au.ctx ? Au.ctx.currentTime : performance.now() / 1000; },
  phase() { const p = 60 / CPR.BPM; return ((this.now() - this.t0) % p + p) % p / p; },
  tick() { if (!this.on || !Au.ctx) return; const p = 60 / CPR.BPM; while (this.next < Au.ctx.currentTime + 0.12) { const at = Math.max(0, this.next - Au.ctx.currentTime); Au.tone(1000, 0.05, 0.3, 'square', at); this.next += p; } },
};
function say(text) { if (!S.voice) return; try { const u = new SpeechSynthesisUtterance(text); u.lang = 'fr-FR'; speechSynthesis.cancel(); speechSynthesis.speak(u); } catch (e) { /* ok */ } }
function notify(text, col = '#fbbf24', ms = 4000) { S.notice = text; S.noticeCol = col; S.noticeUntil = performance.now() + ms; S.dirty = true; }

/* ======================= Déroulé de l'exercice ======================= */
const timers = [];
const after = (s, fn) => timers.push({ at: S.t + s, fn, real: performance.now() + s * 1000, useReal: !S.running });
function setHot(list) {
  for (const o of interactives) if (o.userData.hot) o.userData.active = false;
  for (const o of list) o.userData.active = true;
  S.hotList = list;
}
function go(name, opts = {}) {
  S.phase = name; S.phaseStart = S.t; S.phaseT = 0; S.hintPhase = null; S.dirty = true; S.flags = {};
  setHot([]); rings.forEach((r) => { r.visible = false; });
  const f = ENTER[name]; if (f) f(opts);
}
const ENTER = {
  calib() { S.running = false; patient.pivot.visible = false; placeHud(); },
  intro() { patient.pivot.visible = true; S.fall = 0; npcs.forEach((n) => { n.o.visible = true; n.r = 11; }); Au.crowd(0.015, 1.2); say('Un joueur s\'effondre !'); },
  consc() { setHot([H.shoulderL, H.shoulderR]); say('Vérifiez la conscience.'); },
  airway() { setHot([H.forehead]); },
  breath() { S.flags = { g1: false, g2: false }; },
  call() { },
  cpr(o) {
    if (!R.cprStarted) { R.cprStarted = true; notify('Commencez les compressions !', '#38bdf8'); say('Commencez les compressions.'); }
    detector.reset(); rateT.reset(); S.lastRate = null; if (R.tFirstComp != null) R.lastCompT = S.t; Metro.start();
  },
  vent() { Metro.stop(); S.hold = 0; R.ventBreaths = 0; setHot([H.mouth]); say('Deux insufflations.'); },
  aed_expose() { S.team = true; S.teamT = 0; kneeler.g.visible = true; setHot([H.chest]); say('Je prends le massage. Dénudez le thorax !'); Metro.start(); },
  aed_power() { setHot([H.aedPower]); },
  aed_pads() { setHot([...pads.map((p) => p.userData.hit)]); },
  aed_analyse() { S.team = false; Metro.stop(); setAedScreen(['ANALYSE', 'Ne touchez pas', 'le patient'], '#f59e0b'); Au.aed(); say('Analyse en cours. Ne touchez pas le patient.'); },
  aed_shock() { setAedScreen(['CHOC', 'CONSEILLÉ', '⚡'], '#f97316'); btnShockMat.color.setHex(0xf97316); Au.aed(); say('Choc conseillé. Écartez-vous.'); setHot([H.aedShock]); },
  cpr2(o = {}) {
    if (!o.resume) { R.cycles2 = 0; R.compCount = 0; notify('Reprenez les compressions maintenant !', '#f97316'); say('Reprenez immédiatement les compressions.'); }
    R.active = true; R.lastCompT = S.t; S.team = false; kneeler.g.visible = false;
    npcs.forEach((n) => { n.target = 3.0; }); detector.reset(); rateT.reset(); S.lastRate = null; Metro.start();
  },
  end() {
    Metro.stop(); S.team = false; S.result = computeScore(R, S.mode === 'exam', S.vent); S.running = false;
    try { const k = 'rcpvr-best'; const b = Number(localStorage.getItem(k) || 0); if (S.result.total > b) localStorage.setItem(k, String(S.result.total)); S.bestText = 'Meilleur : ' + Math.max(b, S.result.total); } catch (e) { S.bestText = ''; }
    kneeler.g.visible = false; Au.cheer(); Au.ok(); S.rise = 0; npcs.forEach((n) => { n.target = 2.6; }); say('Les secours arrivent. Le joueur respire de nouveau.'); placeHud();
  },
};
const UPDATE = {
  calib() { if (S.phaseT > 0.7 && !S.flags.p) { S.flags.p = true; placeHud(); } },
  intro() {
    const t = S.phaseT;
    if (t < 0.9) S.fall = 0; else S.fall = clamp((t - 0.9) / 1.3, 0, 1);
    if (t > 2.1 && !S.flags.thud) { S.flags.thud = true; Au.noise(0.2, 0.5, 300); S.jolt = 0.6; }
    if (t > 8) go('consc');
  },
  breath() {
    const t = S.phaseT;
    if (t > 3.5 && !S.flags.g1) { S.flags.g1 = true; S.gasp = 1; Au.gasp(); }
    if (t > 8.0 && !S.flags.g2) { S.flags.g2 = true; S.gasp = 1; Au.gasp(); }
    if (t > 10 && !S.flags.shown) { S.flags.shown = true; S.dirty = true; }
  },
  cpr() { cprUpdate(); }, cpr2() { cprUpdate(); },
  vent(dt) {
    const holding = [...inputs, mouse].some((i) => i.down && i.hit && i.hit.object === H.mouth);
    if (holding) S.hold += dt; else if (S.hold > 0) { evalBreath(S.hold); S.hold = 0; }
    if (R.ventBreaths >= 2) { finishVent(); return; }
    if (S.phaseT > CPR.VENT_MAX_S) { R.ventTimeouts++; notify('Trop long ! Reprenez les compressions.', '#ef4444'); Au.bad(); finishVent(); }
  },
  aed_analyse() { if (S.phaseT > 6) go('aed_shock'); },
};
function onHot(kind) {
  if (!R) return;
  if (kind === 'shoulder' && S.phase === 'consc' && !R.conscious) {
    R.conscious = true; Au.ok(); say('Ça va ? Vous m\'entendez ?'); notify('Aucune réponse : le joueur est inconscient.', '#f87171'); setHot([]); after(1.8, () => go('airway'));
  } else if (kind === 'forehead' && S.phase === 'airway' && !R.airway) {
    R.airway = true; S.tiltTarget = 0.45; Au.ok(); say('À l\'aide ! Apportez un défibrillateur !'); notify('Tête basculée, menton élevé.', '#38bdf8'); setHot([]); after(1.5, () => go('breath'));
  } else if (kind === 'chest' && S.phase === 'aed_expose' && !R.exposed) {
    R.exposed = true; patient.jersey.visible = false; Au.noise(0.25, 0.3, 4000); notify('Thorax dénudé.', '#38bdf8'); go('aed_power');
  } else if (kind === 'aedPower' && S.phase === 'aed_power' && !R.powered) {
    R.powered = true; btnPower.material.color.setHex(0x22c55e); setAedScreen(['DAE ACTIF', 'Posez les', 'électrodes'], '#22c55e'); Au.aed(); say('Appliquez les électrodes sur la poitrine nue du patient.'); wires.forEach((w) => { w.visible = true; }); go('aed_pads');
  } else if (kind === 'aedShock' && S.phase === 'aed_shock') {
    if (!R.clearAnnounced) { R.shockEarly = true; Au.bad(); notify('Danger ! Annoncez d\'abord « Écartez-vous ! »', '#ef4444'); return; }
    R.shocked = true; R.tShock = S.t; S.jolt = 1; Au.shock(); S.flash = 1; setAedScreen(['CHOC', 'DÉLIVRÉ'], '#22c55e'); say('Choc délivré. Reprenez immédiatement les compressions.'); go('cpr2');
  }
}
function decideBreath(normal) {
  if (S.phase !== 'breath') return;
  if (normal) { R.breathErrors++; Au.bad(); notify('Non : des gasps ne sont pas une respiration normale. Réévaluez.', '#ef4444', 5000); S.phaseStart = S.t; S.flags = { g1: false, g2: false }; }
  else { R.breathOk = true; Au.ok(); notify('Arrêt cardiaque : on alerte et on commence la RCP.', '#22c55e'); go('call'); }
}
function doCall() { if (S.phase !== 'call') return; R.called = true; R.aedEta = S.t + 50; Au.ok(); say('J\'appelle les secours et j\'apporte le défibrillateur !'); go('cpr'); }
function doClear() { if (S.phase !== 'aed_shock' || R.clearAnnounced) return; R.clearAnnounced = true; npcs.forEach((n) => { n.target = 6; }); Au.ok(); say('Écartez-vous ! Personne ne touche le patient !'); notify('Zone dégagée.', '#22c55e'); S.dirty = true; }
function useHint() { if (S.hintPhase === S.phase) return; S.hintPhase = S.phase; R.hints++; S.dirty = true; Au.tone(660, 0.15, 0.2); }
function onPad(pad, inp) {
  if (S.phase !== 'aed_pads' || pad.userData.placed || R.held) return;
  R.held = pad; pad.userData.hit.visible = false;
  if (inp && inp.ctrl) inp.ctrl.attach(pad);
  setHot([...rings.filter((r) => !r.userData.used)]); Au.tone(600, 0.1, 0.2);
}
function onRing(ring) {
  if (!R.held || ring.userData.used) return;
  const pad = R.held; patient.body.attach(pad); pad.position.copy(ring.position); pad.position.y += 0.006; pad.rotation.set(0, 0, 0);
  pad.userData.placed = true; ring.userData.used = true; ring.visible = false; R.held = null; R.padsPlaced++; Au.ok(); S.dirty = true;
  if (R.padsPlaced >= 2) { setHot([]); after(0.8, () => go('aed_analyse')); }
  else setHot([...pads.filter((p) => !p.userData.placed).map((p) => p.userData.hit)]);
}
function evalBreath(hold) {
  R.ventAttempts++;
  if (hold >= 0.6 && hold <= 2.2) { R.ventValid++; R.ventBreaths++; S.rise = 1; Au.breath(); }
  else { Au.bad(); notify(hold < 0.6 ? 'Insufflation trop courte : ~1 seconde.' : 'Insufflation trop longue.', '#f59e0b'); }
}
function finishVent() {
  Metro.stop();
  if (S.ret === 'cpr' && R.aedArrived && !R.aedStarted) { R.aedStarted = true; go('aed_expose'); } else go(S.ret, { resume: true });
}

/* ======================= Compressions ======================= */
const detector = new CompressionDetector(); const rateT = new RateTracker();
const chestW = V3();
function tap() { if (!isCprPhase()) return; onCompression({ t: S.t, depthCm: 5.4, recoilPrevOk: true }); }
function cprUpdate() {
  if (S.input === 'hands' && S.xr) {
    patient.chestAnchor.getWorldPosition(chestW); const ys = [];
    for (const i of inputs) { if (!i.src) continue; const p = V3(); i.ctrl.getWorldPosition(p); if (Math.hypot(p.x - chestW.x, p.z - chestW.z) < 0.34) ys.push(p.y); }
    if (!ys.length) { S.noHands += S.dtLast; detector.mode = 'init'; }
    else {
      S.noHands = 0; const y = ys.reduce((a, b) => a + b, 0) / ys.length; const ev = detector.push(y, S.t);
      if (ev) { if (Math.abs(y - chestW.y) <= 0.3) onCompression(ev); else { setFeedback('Mains trop hautes ou trop basses : posez-les sur la poitrine', '#fbbf24'); } }
    }
  }
  if (R.active) { R.cprWindow += S.dtLast; if (S.t - R.lastCompT > CPR.GRACE_S) R.handsOff += S.dtLast; }
}
function setFeedback(m, c) { S.feedback = m; S.feedbackCol = c; S.feedbackUntil = performance.now() + 1500; S.dirty = true; }
function onCompression(ev) {
  const rate = rateT.push(S.t); const depth = ev.depthCm; S.lastRate = rate; S.lastDepth = depth;
  R.comps.push({ t: S.t, depth, rate, recoilOk: ev.recoilPrevOk });
  R.lastCompT = S.t; R.compCount++;
  if (R.tFirstComp == null) { R.tFirstComp = S.t; R.active = true; }
  if (S.phase === 'cpr2' && R.tResume == null && R.tShock != null) R.tResume = S.t - R.tShock;
  S.dip = depth / 100; haptic();
  let m = 'Bon rythme, bonne profondeur !', c = '#34d399';
  if (depth < CPR.DEPTH_OK_MIN) { m = 'Appuyez plus fort (5–6 cm)'; c = '#fbbf24'; }
  else if (depth > CPR.DEPTH_OK_MAX) { m = 'Moins profond (maximum 6 cm)'; c = '#fbbf24'; }
  else if (rate != null && rate < CPR.RATE_MIN - 2) { m = 'Plus vite ! (100–120/min)'; c = '#fbbf24'; }
  else if (rate != null && rate > CPR.RATE_MAX + 2) { m = 'Plus lentement (100–120/min)'; c = '#fbbf24'; }
  else if (ev.recoilPrevOk === false) { m = 'Relâchez complètement la poitrine'; c = '#fbbf24'; }
  setFeedback(m, c);
  if (R.compCount >= CPR.CYCLE) endCycle();
}
function endCycle() {
  R.compCount = 0;
  if (S.phase === 'cpr2') {
    R.cycles2++;
    if (R.cycles2 >= 2) { go('end'); return; }
    if (S.vent) { S.ret = 'cpr2'; go('vent'); }
    return;
  }
  if (R.aedArrived && !R.aedStarted) { R.aedStarted = true; go('aed_expose'); return; }
  R.cycles = (R.cycles || 0) + 1;
  if (S.vent) { S.ret = 'cpr'; go('vent'); }
}

/* ======================= Calibrage ======================= */
function calibrate() {
  if (S.phase !== 'calib') return;
  const head = camera.position.clone(); const hands = V3(); let n = 0;
  if (S.xr) for (const i of inputs) if (i.src) { const p = V3(); i.ctrl.getWorldPosition(p); hands.add(p); n++; }
  if (n) hands.divideScalar(n); else hands.set(head.x, head.y - 0.45, head.z - 0.55);
  if (!S.xr) hands.set(0, 0.5, -0.6);
  const f = V3(hands.x - head.x, 0, hands.z - head.z);
  if (f.length() < 0.15) { f.set(0, 0, -1).applyQuaternion(camera.quaternion); f.y = 0; }
  f.normalize();
  patient.pivot.rotation.z = 0;
  world.rotation.y = Math.atan2(-f.x, -f.z); world.position.set(0, 0, 0); world.updateMatrixWorld(true);
  const cw = V3(); patient.chestAnchor.getWorldPosition(cw); world.position.add(hands.sub(cw)); world.updateMatrixWorld(true);
  Au.ok(); S.t = 0; S.running = true; patient.pivot.rotation.z = -Math.PI / 2; patient.pivot.visible = true;
  S.fall = 0; go('intro'); placeHud();
}

/* ======================= Démarrage / fin ======================= */
function startRun() {
  R = newRun(); S.t = 0; S.running = false; S.result = null; S.hintPhase = null;
  patient.jersey.visible = true; patient.headG.rotation.z = 0; S.tilt = 0; S.tiltTarget = 0; S.team = false; S.lastDepth = null; S.lastRate = null;
  aed.visible = false; aed.position.copy(AED_REST); S.aedAnim = -1; wires.forEach((w) => { w.visible = false; });
  pads.forEach((p, i) => { aed.attach(p); p.position.copy(p.userData.home); p.rotation.set(0, 0, 0); p.userData.placed = false; p.userData.hit.visible = true; });
  rings.forEach((r) => { r.userData.used = false; r.visible = false; });
  btnShockMat.color.setHex(0x6b7280); btnPower.material.color.setHex(0x16a34a); setAedScreen(['DAE', 'éteint'], '#64748b');
  kneeler.g.visible = false; aedMedic.visible = false; npcs.forEach((n) => { n.target = 3.0; n.r = 11; n.o.visible = false; });
  world.rotation.y = 0; world.position.set(0.4, 0, -0.6); patient.pivot.rotation.z = 0; patient.pivot.visible = false;
  Au.crowd(0.12, 0.5); Metro.stop(); timers.length = 0;
  go('calib');
}
function quit() { if (S.xr) { try { renderer.xr.getSession().end(); } catch (e) { /* ok */ } } else showMenu(); }
function showMenu() { document.getElementById('menu').style.display = 'flex'; hud.mesh.visible = false; S.running = false; S.phase = 'menu'; S.xr = false; }
function readOptions() {
  const q = (n) => document.querySelector(`input[name=${n}]:checked`)?.value;
  S.mode = q('mode') || 'guided'; S.input = q('input') || 'hands';
  S.vent = document.getElementById('opt-vent').checked; S.voice = document.getElementById('opt-voice').checked; S.metro = document.getElementById('opt-metro').checked;
}
async function enterVR() {
  readOptions(); Au.init();
  try {
    const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] });
    session.addEventListener('end', () => { showMenu(); });
    await renderer.xr.setSession(session); S.xr = true;
    document.getElementById('menu').style.display = 'none'; startRun();
  } catch (e) { alert('Impossible de démarrer la session VR : ' + e.message); }
}
function enterDesktop() { readOptions(); Au.init(); S.xr = false; document.getElementById('menu').style.display = 'none'; startRun(); }
document.getElementById('btn-vr').addEventListener('click', enterVR);
document.getElementById('btn-desktop').addEventListener('click', enterDesktop);
(async () => {
  const b = document.getElementById('btn-vr'); let ok = false;
  try { ok = !!(navigator.xr && await navigator.xr.isSessionSupported('immersive-vr')); } catch (e) { /* ok */ }
  if (!ok) { b.disabled = true; b.textContent = '🥽 WebXR indisponible (ouvrez cette page dans le navigateur du Quest)'; }
})();

/* ======================= Boucle ======================= */
const clock = new THREE.Clock();
const tmpV = V3();
function step(dt) {
  S.dtLast = dt;
  if (S.running) { S.t += dt; S.phaseT = S.t - S.phaseStart; } else S.phaseT += dt;
  for (let i = timers.length - 1; i >= 0; i--) { const tm = timers[i]; if (S.running ? S.t >= tm.at : performance.now() >= tm.real) { timers.splice(i, 1); tm.fn(); } }
  if (S.phase === 'menu') return;
  // entrées
  for (const i of inputs) {
    if (S.xr) pickFor(i);
    if (S.xr) {
      const d = i.hit ? i.hit.distance : 1.5; i.line.scale.z = Math.min(d, 4); i.dot.position.z = -Math.min(d, 4); i.dot.visible = !!i.hit; i.line.visible = true;
      const gp = i.src && i.src.gamepad; const b = gp && gp.buttons && gp.buttons[5] && gp.buttons[5].pressed;
      if (b && !i.wasB) placeHud(); i.wasB = !!b;
    }
  }
  if (!S.xr) pickFor(mouse);
  const hv = [...inputs, mouse].map((i) => i.hit).find((h) => h && h.object.userData.panel);
  const hb = hv ? hv.object.userData.panel.hitButton(hv.uv) : null;
  if ((hb && hb.label) !== (hud.hover && hud.hover.label)) { hud.hover = hb; S.dirty = true; }
  // phases
  if (R && S.aedAnim < 0 && R.aedEta != null && !R.aedArrived && S.t >= R.aedEta) { R.aedArrived = true; S.aedAnim = 0; aed.visible = true; aedMedic.visible = true; Au.aed(); say('Le défibrillateur est arrivé !'); notify('🩺 Le DAE est arrivé !', '#f97316', 5000); }
  const up = UPDATE[S.phase]; if (up) up(dt);
  animate(dt);
  Metro.tick();
  const now = performance.now(); const period = isCprPhase() ? 66 : 120;
  if (hud.mesh.visible && (S.dirty || now - S.hudAt > period)) { hud.render(); S.hudAt = now; S.dirty = false; }
}
function animate(dt) {
  const k = Math.min(1, dt * 8);
  // chute / posture du patient
  if (S.phase === 'intro' || S.fall >= 0) { const u = S.fall; patient.pivot.rotation.z = -Math.PI / 2 * (1 - u * u); if (u >= 1) S.fall = -1; }
  S.tilt += ((S.tiltTarget || 0) - S.tilt) * k; patient.headG.rotation.z = S.tilt;
  S.dip *= Math.exp(-dt * 9); S.gasp *= Math.exp(-dt * 3); S.rise *= Math.exp(-dt * 1.6); S.jolt *= Math.exp(-dt * 4);
  let dip = S.dip;
  if (S.team) { S.teamT += dt; const pump = 0.5 - 0.5 * Math.cos(2 * Math.PI * CPR.BPM / 60 * S.teamT); dip = Math.max(dip, 0.055 * pump); kneeler.upper.position.y = -0.04 * pump; }
  patient.torsoG.position.y = 0.12 - dip + 0.012 * S.gasp + 0.02 * S.rise;
  patient.body.position.y = 0.05 * S.jolt * Math.sin(S.t * 40);
  const tm = performance.now() / 1000;
  // PNJ
  for (const n of npcs) {
    n.r += (n.target - n.r) * Math.min(1, dt * 1.2);
    const cx = -0.2, cz = 0; n.o.position.set(cx + Math.cos(n.ang) * n.r, 0.02 * Math.abs(Math.sin(tm * 3 + n.ph)) * (Math.abs(n.target - n.r) > 0.3 ? 4 : 0.2), cz + Math.sin(n.ang) * n.r);
    n.o.lookAt(world.localToWorld(V3(cx, 0, cz)).setY(n.o.getWorldPosition(tmpV).y));
  }
  // DAE livré par un soigneur
  if (S.aedAnim >= 0) {
    S.aedAnim += dt; const u = clamp(S.aedAnim / 3.5, 0, 1); const from = V3(7, 0, -7), to = V3(0.65, 0, -1.4);
    aedMedic.position.lerpVectors(from, to, u); aedMedic.lookAt(world.localToWorld(V3(-0.2, 0, -0.3)).setY(0));
    if (u < 1) aed.position.set(aedMedic.position.x, 0.95, aedMedic.position.z + 0.2); else aed.position.copy(AED_REST);
  }
  if (aed.visible) wires.forEach((w, i) => {
    if (!w.visible) return; const a = V3(0, 0.1, 0.13), b = V3(); aed.localToWorld(a); pads[i].getWorldPosition(b);
    w.geometry.setFromPoints([a, b]);
  });
  // surbrillance des hotspots (invisibles mais cliquables en mode évaluation sans indice)
  const show = showGuide();
  for (const o of interactives) if (o.userData.hot) {
    const act = o.userData.active; o.visible = act;
    if (act) o.material.opacity = show ? 0.35 + 0.25 * Math.sin(tm * 4) : 0.0;
  }
}
renderer.setAnimationLoop(() => { const dt = Math.min(0.05, clock.getDelta()); step(dt); renderer.render(scene, camera); });
window.__RCP = { mouse, inputs, S, get R() { return R; }, go, calibrate, onHot, onPad, onRing, tap, doCall, doClear, decideBreath, step, H, pads, rings, hud, quit, startRun };
