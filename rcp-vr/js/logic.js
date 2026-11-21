// logic.js — logique pure (sans navigateur, testable sous Node)
// Référence : recommandations ERC 2021 pour l'adulte (compressions 5–6 cm, 100–120/min, 30:2).

export const CPR = {
  RATE_MIN: 100, RATE_MAX: 120,        // compressions / minute
  DEPTH_MIN: 5, DEPTH_MAX: 6,          // cm (cible ERC)
  DEPTH_OK_MIN: 4.5, DEPTH_OK_MAX: 6.8,// tolérance (précision des manettes VR)
  CYCLE: 30, BREATHS: 2,
  VENT_MAX_S: 10,                      // pause max pour 2 insufflations
  GRACE_S: 2.0,                        // pause tolérée entre 2 compressions
  BPM: 110,
};

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const fmtTime = (s) => {
  s = Math.max(0, Math.floor(s));
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
};

/**
 * Détecte les compressions à partir de la hauteur Y (m) des mains.
 * Algorithme crête/creux avec hystérésis. push(y, t) renvoie null ou
 * { t, depthCm, recoilPrevOk } à chaque fond de compression valide.
 */
export class CompressionDetector {
  constructor({ delta = 0.012, minAmp = 0.025, minInterval = 0.25 } = {}) {
    this.delta = delta; this.minAmp = minAmp; this.minInterval = minInterval;
    this.reset();
  }
  reset() {
    this.mode = 'init'; this.hi = 0; this.lo = 0; this.tLo = 0;
    this.lastT = -1; this.valleyY = null; this.lastDepth = null; this.recoilOk = null;
  }
  push(y, t) {
    if (this.mode === 'init') { this.hi = this.lo = y; this.tLo = t; this.mode = 'seekMin'; return null; }
    if (this.mode === 'seekMin') {
      if (y > this.hi) { this.hi = y; this.lo = y; this.tLo = t; }
      else if (y < this.lo) { this.lo = y; this.tLo = t; }
      else if (y - this.lo > this.delta) {
        const amp = this.hi - this.lo;
        this.valleyY = this.lo;
        this.mode = 'seekMax';
        this.hi = y;
        if (amp >= this.minAmp && this.tLo - this.lastT >= this.minInterval) {
          this.lastT = this.tLo; this.lastDepth = amp;
          const ev = { t: this.tLo, depthCm: amp * 100, recoilPrevOk: this.recoilOk };
          this.recoilOk = null;
          return ev;
        }
      }
      return null;
    }
    // seekMax : on remonte vers le sommet
    if (y > this.hi) this.hi = y;
    else if (y < this.hi - this.delta) {
      if (this.lastDepth != null) this.recoilOk = (this.hi - this.valleyY) >= 0.75 * this.lastDepth;
      this.mode = 'seekMin'; this.lo = y; this.tLo = t;
    }
    return null;
  }
}

/** Fréquence instantanée (compressions/min) sur les dernières compressions. */
export class RateTracker {
  constructor(n = 6) { this.n = n; this.times = []; }
  reset() { this.times = []; }
  push(t) {
    if (this.times.length && t - this.times[this.times.length - 1] > 3) this.times = [];
    this.times.push(t);
    if (this.times.length > this.n) this.times.shift();
    return this.rate();
  }
  rate() {
    if (this.times.length < 3) return null;
    const span = this.times[this.times.length - 1] - this.times[0];
    return span > 0 ? 60 * (this.times.length - 1) / span : null;
  }
}

export const rateOk = (r) => r != null && r >= CPR.RATE_MIN - 2 && r <= CPR.RATE_MAX + 2;
export const depthOk = (d) => d >= CPR.DEPTH_OK_MIN && d <= CPR.DEPTH_OK_MAX;

const pct = (n, d) => (d > 0 ? n / d : 0);
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

/**
 * Calcule le score (/100) et le retour pédagogique.
 * R : voir app.js (objet de suivi de l'exercice). exam : bool (pénalité d'indices).
 */
export function computeScore(R, exam = false, ventEnabled = true) {
  const parts = [];
  const fb = [];
  const add = (name, pts, max, note) => parts.push({ name, pts: Math.round(pts * 10) / 10, max, note });

  // 1. Chaîne de survie (15)
  let chain = 0;
  if (R.conscious) chain += 4; else fb.push('Vérifier la conscience (secouer les épaules, parler fort) n\'a pas été fait.');
  if (R.airway) chain += 4; else fb.push('Libérer les voies aériennes (bascule de la tête) a été oublié.');
  const be = R.breathErrors || 0;
  if (R.breathOk) chain += Math.max(0, 4 - 2 * be);
  if (be) fb.push('Un gasp (respiration agonique) n\'est PAS une respiration normale : en cas de doute, on commence la RCP.');
  if (R.called) chain += 3; else fb.push('L\'alerte des secours et la demande de DAE n\'ont pas été faites.');
  add('Chaîne de survie', chain, 15);

  // 2. Délai de démarrage de la RCP (10)
  let start = 0;
  if (R.tFirstComp != null) {
    const d = R.tFirstComp; // secondes depuis l'effondrement
    start = d <= 60 ? 10 : d <= 90 ? 6 : d <= 120 ? 3 : 0;
    fb.push(`Première compression à ${Math.round(d)} s après l'effondrement (objectif : moins d'une minute).`);
  } else fb.push('Aucune compression thoracique détectée.');
  add('Délai de démarrage', start, 10);

  // 3-4. Qualité des compressions (fréquence 18, profondeur 14, relâchement 4)
  const c = R.comps || [];
  const withRate = c.filter((x) => x.rate != null);
  const rateGood = withRate.filter((x) => rateOk(x.rate)).length;
  add('Fréquence 100–120/min', 18 * pct(rateGood, withRate.length), 18);
  if (withRate.length) {
    const ar = avg(withRate.map((x) => x.rate));
    fb.push(`Fréquence moyenne : ${Math.round(ar)}/min (cible 100–120).`);
  }
  const depthGood = c.filter((x) => depthOk(x.depth)).length;
  add('Profondeur 5–6 cm', 14 * pct(depthGood, c.length), 14);
  if (c.length) {
    const ad = avg(c.map((x) => x.depth));
    fb.push(`Profondeur moyenne : ${ad.toFixed(1)} cm (cible 5–6 cm).`);
  }
  const rec = c.filter((x) => x.recoilOk != null);
  add('Relâchement complet', 4 * pct(rec.filter((x) => x.recoilOk).length, rec.length || 1), 4);

  // 5. Interruptions (12)
  const frac = pct(R.handsOff || 0, R.cprWindow || 0);
  const noflow = frac <= 0.10 ? 12 : frac >= 0.30 ? 0 : 12 * (0.30 - frac) / 0.20;
  add('Interruptions minimales', R.cprWindow ? noflow : 0, 12);
  if (R.cprWindow) fb.push(`Temps sans compressions : ${Math.round(frac * 100)} % (objectif : moins de 10 %).`);

  // 6. Ventilations (7)
  let vent = 7;
  if (ventEnabled) {
    const att = R.ventAttempts || 0;
    vent = att ? 7 * pct(R.ventValid || 0, att) : 0;
    vent -= 2 * (R.ventTimeouts || 0);
    if ((R.ventValid || 0) === 0) fb.push('Aucune insufflation valide (maintenir ~1 s sur la bouche, 2 fois).');
  }
  add('Ventilations 30:2', Math.max(0, vent), 7);

  // 7. DAE (20)
  let aed = 0;
  if (R.exposed) aed += 3; else fb.push('Le thorax n\'a pas été dénudé avant la pose des électrodes.');
  if ((R.padsPlaced || 0) >= 2) aed += 4; else fb.push('Les deux électrodes du DAE n\'ont pas été posées.');
  if (R.clearAnnounced) aed += 4; else fb.push('« Écartez-vous ! » doit être annoncé avant le choc.');
  if (R.shocked && !R.shockEarly) aed += 4;
  else if (R.shocked) fb.push('Choc déclenché avant d\'avoir sécurisé tout le monde.');
  if (R.tResume != null) {
    if (R.tResume <= 10) aed += 5;
    else if (R.tResume <= 20) aed += 2;
    fb.push(`Reprise des compressions ${Math.round(R.tResume)} s après le choc (objectif : immédiate, < 10 s).`);
  }
  add('Utilisation du DAE', aed, 20);

  let total = parts.reduce((s, p) => s + p.pts, 0);
  if (exam && R.hints) { total -= 3 * R.hints; fb.push(`${R.hints} indice(s) utilisé(s) : −${3 * R.hints} points.`); }
  total = Math.round(clamp(total, 0, 100));
  return { total, parts, feedback: fb };
}
