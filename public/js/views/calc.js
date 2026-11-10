// Betting calculators. Each one is a list of inputs and a pure function of them.

import { esc, pct, price, signedPct } from '../ui.js';
import {
  impliedProb, toDecimal, decimalToAmerican, probToAmerican, devig, hold, expectedValue, kelly,
} from '/shared/math.js';

const parseOdds = (text) =>
  String(text)
    .split(/[\s,]+/)
    .map(Number)
    .filter((n) => Math.abs(n) >= 100);

function combinations(items, size) {
  if (size === 0) return [[]];
  if (items.length < size) return [];
  const [first, ...rest] = items;
  return [...combinations(rest, size - 1).map((c) => [first, ...c]), ...combinations(rest, size)];
}

const validOdds = (v) => Math.abs(v) >= 100;
const NEED_ODDS = 'American odds are +100 or higher, or -100 or lower.';

const CALCS = [
  {
    id: 'convert',
    group: 'Odds',
    name: 'Odds converter',
    blurb: 'American odds to decimal, implied chance and payout.',
    inputs: [['odds', 'American odds', -110], ['stake', 'Stake ($)', 100]],
    run: ({ odds, stake }) => {
      if (!validOdds(odds)) return { error: NEED_ODDS };
      const d = toDecimal(odds);
      return [['Decimal', d.toFixed(3)], ['Implied chance', pct(impliedProb(odds), 2)], ['Profit', `$${(stake * (d - 1)).toFixed(2)}`], ['Total payout', `$${(stake * d).toFixed(2)}`]];
    },
  },
  {
    id: 'parlay',
    group: 'Odds',
    name: 'Parlay',
    blurb: 'Combined odds and payout, assuming the legs are independent.',
    inputs: [['legs', 'Legs, separated by commas', '-110, +120, -150', 'text'], ['stake', 'Stake ($)', 10]],
    run: ({ legs, stake }) => {
      const list = parseOdds(legs);
      if (list.length < 2) return { error: 'Enter at least two legs in American odds.' };
      const d = list.reduce((x, o) => x * toDecimal(o), 1);
      return [['Parlay odds', price(decimalToAmerican(d))], ['Decimal', d.toFixed(3)], ['Implied chance', pct(1 / d, 2)], ['Payout', `$${(stake * d).toFixed(2)}`]];
    },
  },
  {
    id: 'roundrobin',
    group: 'Odds',
    name: 'Round robin',
    blurb: 'Every parlay of a given size from your picks, and the payout if all of them hit.',
    inputs: [['legs', 'Picks, separated by commas', '-110, -110, +100, -120', 'text'], ['size', 'Parlay size', 2], ['stake', 'Stake per parlay ($)', 5]],
    run: ({ legs, size, stake }) => {
      const list = parseOdds(legs);
      const k = Math.round(size);
      if (k < 2 || list.length < k) return { error: 'Use a parlay size of at least 2 and no larger than your number of picks.' };
      const combos = combinations(list, k);
      const best = combos.reduce((sum, c) => sum + stake * c.reduce((x, o) => x * toDecimal(o), 1), 0);
      return [['Parlays', String(combos.length)], ['Total staked', `$${(combos.length * stake).toFixed(2)}`], ['Payout if all hit', `$${best.toFixed(2)}`]];
    },
  },
  {
    id: 'hold',
    group: 'Fair value',
    name: 'Hold',
    blurb: "The book's margin on a two-way market.",
    inputs: [['a', 'Side A odds', -110], ['b', 'Side B odds', -110]],
    run: ({ a, b }) => {
      if (!validOdds(a) || !validOdds(b)) return { error: NEED_ODDS };
      return [['Hold', pct(hold(a, b), 2)], ['Side A implied', pct(impliedProb(a), 2)], ['Side B implied', pct(impliedProb(b), 2)]];
    },
  },
  {
    id: 'devig',
    group: 'Fair value',
    name: 'Devig',
    blurb: 'Fair odds with the margin removed, by four common methods.',
    inputs: [['a', 'Side A odds', -135], ['b', 'Side B odds', 115]],
    run: ({ a, b }) => {
      if (!validOdds(a) || !validOdds(b)) return { error: NEED_ODDS };
      return ['multiplicative', 'additive', 'power', 'shin'].map((method) => {
        const [fa, fb] = devig(a, b, method);
        return [method[0].toUpperCase() + method.slice(1), `${pct(fa, 1)} (${price(probToAmerican(fa))}) / ${pct(fb, 1)}`];
      });
    },
  },
  {
    id: 'ev',
    group: 'Fair value',
    name: 'Expected value',
    blurb: 'Your long-run profit per bet if your probability is right.',
    inputs: [['prob', 'Your chance (%)', 55], ['odds', 'Odds', -110], ['stake', 'Stake ($)', 100]],
    run: ({ prob, odds, stake }) => {
      if (!validOdds(odds)) return { error: NEED_ODDS };
      if (prob <= 0 || prob >= 100) return { error: 'Your chance must be between 0 and 100.' };
      const ev = expectedValue(prob / 100, odds);
      return [['EV', signedPct(ev, 2)], ['EV in dollars', `${ev >= 0 ? '' : '−'}$${Math.abs(ev * stake).toFixed(2)}`], ['Break-even chance', pct(impliedProb(odds), 2)], ['Fair odds', price(probToAmerican(prob / 100))]];
    },
  },
  {
    id: 'kelly',
    group: 'Bankroll',
    name: 'Kelly stake',
    blurb: 'Bet size from your edge. Most bettors use a quarter Kelly or less, because estimates are noisy.',
    inputs: [['prob', 'Your chance (%)', 55], ['odds', 'Odds', -110], ['bankroll', 'Bankroll ($)', 1000], ['fraction', 'Kelly fraction', 0.25]],
    run: ({ prob, odds, bankroll, fraction }) => {
      if (!validOdds(odds)) return { error: NEED_ODDS };
      if (prob <= 0 || prob >= 100) return { error: 'Your chance must be between 0 and 100.' };
      const k = kelly(prob / 100, odds, fraction);
      return [['Stake', `$${(k * bankroll).toFixed(2)}`], ['Share of bankroll', pct(k, 2)], ['Verdict', k > 0 ? 'Edge at this price' : 'No edge, no bet']];
    },
  },
  {
    id: 'arb',
    group: 'Hedging',
    name: 'Arbitrage',
    blurb: 'Whether two prices lock in a profit, and how to split the stake.',
    inputs: [['a', 'Side A odds', 105], ['b', 'Side B odds', 102], ['total', 'Total stake ($)', 100]],
    run: ({ a, b, total }) => {
      if (!validOdds(a) || !validOdds(b)) return { error: NEED_ODDS };
      const sum = impliedProb(a) + impliedProb(b);
      const stakeA = (total * impliedProb(a)) / sum;
      return [['Arbitrage?', sum < 1 ? 'Yes' : 'No'], ['Return on stake', signedPct(1 / sum - 1, 2)], ['Stake on A', `$${stakeA.toFixed(2)}`], ['Stake on B', `$${(total - stakeA).toFixed(2)}`], ['Payout either way', `$${(stakeA * toDecimal(a)).toFixed(2)}`]];
    },
  },
  {
    id: 'hedge',
    group: 'Hedging',
    name: 'Hedge',
    blurb: 'What to bet on the other side to lock in the same result either way.',
    inputs: [['stake', 'Original stake ($)', 100], ['odds', 'Original odds', 300], ['hedge', 'Hedge odds', -150]],
    run: ({ stake, odds, hedge: h }) => {
      if (!validOdds(odds) || !validOdds(h)) return { error: NEED_ODDS };
      const payout = stake * toDecimal(odds);
      const bet = payout / toDecimal(h);
      const profit = payout - stake - bet;
      return [['Hedge bet', `$${bet.toFixed(2)}`], ['Locked profit', `${profit >= 0 ? '' : '−'}$${Math.abs(profit).toFixed(2)}`]];
    },
  },
  {
    id: 'middle',
    group: 'Hedging',
    name: 'Middle',
    blurb: 'How often the final must land in the gap for a middle to break even.',
    inputs: [['a', 'Leg A odds', -110], ['b', 'Leg B odds', -110], ['stake', 'Stake per leg ($)', 100]],
    run: ({ a, b, stake }) => {
      if (!validOdds(a) || !validOdds(b)) return { error: NEED_ODDS };
      const winA = stake * (toDecimal(a) - 1);
      const winB = stake * (toDecimal(b) - 1);
      const both = winA + winB;
      const onlyOne = (winA + winB) / 2 - stake;
      const breakeven = onlyOne >= 0 ? 0 : -onlyOne / (both - onlyOne);
      return [['If both win', `$${both.toFixed(2)}`], ['If one wins (average)', `${onlyOne >= 0 ? '' : '−'}$${Math.abs(onlyOne).toFixed(2)}`], ['Break-even middle rate', pct(breakeven, 1)]];
    },
  },
  {
    id: 'freebet',
    group: 'Hedging',
    name: 'Free bet conversion',
    blurb: 'Turn a stake-not-returned free bet into cash by hedging it.',
    inputs: [['free', 'Free bet ($)', 100], ['odds', 'Free bet odds', 300], ['hedge', 'Hedge odds', -350]],
    run: ({ free, odds, hedge: h }) => {
      if (!validOdds(odds) || !validOdds(h)) return { error: NEED_ODDS };
      const win = free * (toDecimal(odds) - 1);
      const bet = win / toDecimal(h);
      const locked = win - bet;
      return [['Hedge bet', `$${bet.toFixed(2)}`], ['Locked profit', `$${locked.toFixed(2)}`], ['Conversion rate', pct(locked / free, 1)]];
    },
  },
  {
    id: 'poisson',
    group: 'Probability',
    name: 'Poisson',
    blurb: 'Chance of clearing a line for a counting stat, given its average.',
    inputs: [['mean', 'Expected value', 2.4], ['line', 'Line', 2.5]],
    run: ({ mean, line }) => {
      if (mean <= 0) return { error: 'Expected value must be above 0.' };
      let term = Math.exp(-mean);
      let under = 0;
      const last = Math.ceil(line) - 1;
      for (let k = 0; k <= last; k++) {
        under += term;
        term *= mean / (k + 1);
      }
      const push = Number.isInteger(line) ? term : 0;
      const over = 1 - under - push;
      return [['Over', `${pct(over, 1)} (${price(probToAmerican(over))})`], ['Under', `${pct(under, 1)} (${price(probToAmerican(under))})`], ...(push ? [['Push', pct(push, 1)]] : [])];
    },
  },
];

function outputHtml(calc, values) {
  const result = calc.run(values);
  if (result.error) return `<p class="calc-error" role="alert">${esc(result.error)}</p>`;
  return `<dl class="calc-out">${result.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd class="mono">${esc(v)}</dd></div>`).join('')}</dl>`;
}

const readValues = (calc, card) =>
  Object.fromEntries(
    calc.inputs.map(([key, , , type]) => {
      const raw = card.querySelector(`[name="${key}"]`).value;
      return [key, type === 'text' ? raw : Number(raw)];
    }),
  );

export function calcView(view) {
  const groups = [...new Set(CALCS.map((c) => c.group))];
  view.innerHTML = `
    <div class="page-head"><div><h1>Calculators</h1><p class="sub">Results update as you type.</p></div></div>
    ${groups
      .map((g) => `<h2 class="group-title">${esc(g)}</h2><div class="calc-grid">${CALCS.filter((c) => c.group === g)
        .map((c) => {
          const defaults = Object.fromEntries(c.inputs.map(([k, , d]) => [k, d]));
          return `<article class="card calc" data-calc="${c.id}">
            <h3>${esc(c.name)}</h3><p class="muted">${esc(c.blurb)}</p>
            <div class="calc-inputs">${c.inputs
              .map(([k, label, d, type]) => `<label>${esc(label)}<input name="${k}" type="${type === 'text' ? 'text' : 'number'}" value="${esc(d)}" ${type === 'text' ? '' : 'step="any"'}></label>`)
              .join('')}</div>
            <div class="calc-result" aria-live="polite">${outputHtml(c, defaults)}</div>
          </article>`;
        })
        .join('')}</div>`)
      .join('')}`;
  const onInput = (e) => {
    const card = e.target.closest('[data-calc]');
    if (!card) return;
    const calc = CALCS.find((c) => c.id === card.dataset.calc);
    card.querySelector('.calc-result').innerHTML = outputHtml(calc, readValues(calc, card));
  };
  view.addEventListener('input', onInput);
  return () => view.removeEventListener('input', onInput);
}
