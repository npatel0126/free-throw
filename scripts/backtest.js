// npm run backtest: tests the model on this season's finished games.
// The model weight is chosen on the first half of the season and judged on the second.

import { collectSamples, score, chronologicalSplit, atOpen, blind, report, WEIGHTS } from '../server/backtest.js';
import { MARKETS } from '../public/shared/math.js';
import { CONFIG } from '../server/model.js';

const pct = (x, d = 1) => `${(x * 100).toFixed(d)}%`;
const { samples, gamesTested, gamesTotal } = await collectSamples(undefined, (m) => console.log(m));
console.log(`\n${samples.length} props from ${gamesTested}/${gamesTotal} games`);

const [early, late] = chronologicalSplit(samples);
function sweep(title, train, test) {
  console.log(`\n${title}  train=${train.length} test=${test.length}`);
  console.log('weight  train-mkt  train-blend  test-mkt  test-blend  test-ROI(EV>=3%)  bets');
  let best = 0;
  let bestLoss = Infinity;
  for (const w of WEIGHTS) {
    const a = score(train, w);
    const b = score(test, w);
    if (a.modelLogLoss < bestLoss) {
      bestLoss = a.modelLogLoss;
      best = w;
    }
    console.log(`${w.toFixed(2).padEnd(7)} ${a.marketLogLoss.toFixed(4).padEnd(10)} ${a.modelLogLoss.toFixed(4).padEnd(12)} ${b.marketLogLoss.toFixed(4).padEnd(9)} ${b.modelLogLoss.toFixed(4).padEnd(11)} ${pct(b.bets.roi).padStart(7)}         ${b.bets.n}`);
  }
  console.log(`best weight on train: ${best}`);
  return best;
}
const closeBest = sweep('CLOSING lines', early, late);
const openBest = sweep('OPENING lines', atOpen(early), atOpen(late));
console.log(`\nConfigured weight: ${CONFIG.modelWeight}`);

console.log('\nBlind betting, closing lines:', JSON.stringify(blind(samples)));
console.log('Blind betting, opening lines:', JSON.stringify(blind(atOpen(samples))));

for (const [name, set] of [['closing', late], ['opening', atOpen(late)]]) {
  const w = CONFIG.modelWeight;
  console.log(`\nHeld-out at configured weight ${w}, ${name}: ROI by EV threshold`);
  for (const t of [0.005, 0.01, 0.02, 0.03, 0.05, 0.08]) {
    const r = score(set, w, t);
    console.log(`  EV>=${pct(t).padStart(5)}: ${String(r.bets.n).padStart(5)} bets, ${pct(r.bets.winPct)} won, ROI ${pct(r.bets.roi)}`);
  }
  console.log('  calibration (predicted over -> actual):');
  for (const c of score(set, w).calibration) console.log(`    ${pct(c.predicted).padStart(6)} -> ${pct(c.actual).padStart(6)}  n=${c.n}`);
}

console.log('\nBy market at configured weight, closing lines:');
for (const m of Object.keys(MARKETS)) {
  const sub = samples.filter((s) => s.market === m);
  if (!sub.length) continue;
  const r = score(sub, CONFIG.modelWeight);
  console.log(`  ${m.padEnd(5)} n=${String(r.n).padEnd(5)} market ${r.marketLogLoss.toFixed(4)} blend ${r.modelLogLoss.toFixed(4)} MAE mkt ${r.mae.market.toFixed(2)} model ${r.mae.model.toFixed(2)}`);
}

const summary = report({ samples, gamesTested, gamesTotal });
console.log('\nHeadline (EV>=2%):');
console.log('  halves', JSON.stringify(summary.halves));
console.log('  sides ', JSON.stringify(summary.sides));
for (const r of summary.closing) console.log(`  close EV>=${pct(r.threshold)} n=${r.n} win=${pct(r.winPct ?? 0)} ROI=${pct(r.roi ?? 0)} 90%CI=[${pct(r.ci?.low ?? 0)}, ${pct(r.ci?.high ?? 0)}]`);
for (const r of summary.opening) console.log(`  open  EV>=${pct(r.threshold)} n=${r.n} win=${pct(r.winPct ?? 0)} ROI=${pct(r.roi ?? 0)} 90%CI=[${pct(r.ci?.low ?? 0)}, ${pct(r.ci?.high ?? 0)}]`);
