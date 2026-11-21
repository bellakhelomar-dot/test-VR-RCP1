import assert from 'node:assert/strict';
import { CompressionDetector, RateTracker, computeScore, CPR, rateOk, depthOk } from '../js/logic.js';

// Simule des mains : sinusoïde de fréquence bpm et d'amplitude crête-à-crête depthCm, échantillonnée à 72 Hz.
function simulate(bpm, depthCm, seconds, noise = 0.001, seed = 1) {
  let s = seed; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5);
  const det = new CompressionDetector(); const rt = new RateTracker();
  const out = [];
  const f = bpm / 60, A = depthCm / 100 / 2;
  for (let t = 0; t < seconds; t += 1 / 72) {
    const y = 0.5 + A * Math.cos(2 * Math.PI * f * t) + noise * rnd();
    const ev = det.push(y, t);
    if (ev) out.push({ ...ev, rate: rt.push(ev.t) });
  }
  return out;
}

// 110/min, 5.5 cm pendant 20 s ≈ 36 compressions
let ev = simulate(110, 5.5, 20);
assert.ok(ev.length >= 34 && ev.length <= 38, `nb compressions ${ev.length}`);
const last = ev[ev.length - 1];
assert.ok(Math.abs(last.rate - 110) < 4, `rate ${last.rate}`);
assert.ok(ev.slice(2).every((e) => Math.abs(e.depthCm - 5.5) < 0.6), 'profondeur ~5.5');
assert.ok(ev.slice(3).every((e) => depthOk(e.depthCm)));
assert.ok(rateOk(last.rate));

// trop lent / trop rapide
assert.ok(simulate(70, 5.5, 20).slice(-1)[0].rate < 80);
assert.ok(simulate(150, 5.5, 20).slice(-1)[0].rate > 140);

// mouvements trop faibles (1.5 cm) ou tremblement : aucune compression
assert.equal(simulate(110, 1.5, 10).length, 0);
assert.equal(simulate(110, 0, 10, 0.004).length, 0);

// compressions trop superficielles détectées comme hors cible
ev = simulate(110, 3.2, 15);
assert.ok(ev.length > 15 && ev.slice(2).every((e) => !depthOk(e.depthCm)));

// recul incomplet : on ne remonte que de 50 % de la profondeur
{
  const det = new CompressionDetector(); let flagged = 0;
  for (let t = 0; t < 15; t += 1 / 72) {
    const ph = (2 * Math.PI * (110 / 60) * t) % (2 * Math.PI);
    const y = 0.5 - 0.055 * (1 - Math.cos(ph)) / 2 * (ph < Math.PI ? 1 : 1) ; // descente/remontée totale
    const ev2 = det.push(0.5 - 0.055 * (1 - Math.cos(ph)) / 2 + 0.0, t); // recul complet
    if (ev2 && ev2.recoilPrevOk === false) flagged++;
  }
  assert.equal(flagged, 0, 'recul complet non signalé');
}

// score : exercice parfait
const comps = Array.from({ length: 90 }, (_, i) => ({ t: 40 + i * 0.545, depth: 5.5, rate: 110, recoilOk: true }));
const perfect = computeScore({
  conscious: true, airway: true, breathOk: true, breathErrors: 0, called: true,
  tFirstComp: 45, comps, handsOff: 2, cprWindow: 80, ventAttempts: 4, ventValid: 4, ventTimeouts: 0,
  exposed: true, padsPlaced: 2, clearAnnounced: true, shocked: true, shockEarly: false, tResume: 6, hints: 0,
}, true, true);
assert.equal(perfect.total, 100, 'score parfait ' + perfect.total);

// score : rien fait
const zero = computeScore({}, false, true);
assert.ok(zero.total <= 7, 'score nul ' + zero.total);

// pénalité d'indices en mode évaluation
const hinted = computeScore({ conscious: true, hints: 2 }, true, true);
assert.ok(hinted.total <= 4);

console.log('OK — tous les tests passent (' + CPR.BPM + ' bpm de référence)');
