// The slip: a research scratchpad for straight bets and parlays. Stored in this
// browser only, and nothing is ever placed from here.

import { esc, pct, price, signedPct } from './ui.js';
import { MARKETS, toDecimal, decimalToAmerican } from '/shared/math.js';

const KEY = 'freethrow-slip';
let legs = load();
let stake = 10;

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) ?? [];
  } catch {
    return [];
  }
}
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(legs));
  } catch {
    /* storage can be blocked; the slip still works for this page view */
  }
}

const legId = (leg) => `${leg.athleteId}|${leg.market}|${leg.side}|${leg.line}`;

export const inSlip = (leg) => legs.some((l) => legId(l) === legId(leg));

export function toggleLeg(leg) {
  const id = legId(leg);
  legs = legs.some((l) => legId(l) === id) ? legs.filter((l) => legId(l) !== id) : [...legs, leg];
  save();
  render();
  document.dispatchEvent(new CustomEvent('slipchange'));
}

export function legFromRow(r) {
  return {
    athleteId: r.athleteId,
    name: r.name,
    market: r.market,
    side: r.sideName,
    line: r.line,
    price: r.sidePrice,
    prob: r.sideProb,
    gameId: r.gameId,
    matchup: `${r.team} ${r.home ? 'vs' : '@'} ${r.opp}`,
  };
}

// The parlay figures assume independent legs; the warning below covers when they aren't.
export function parlay(list) {
  const decimal = list.reduce((d, l) => d * toDecimal(l.price), 1);
  const known = list.every((l) => l.prob != null);
  const prob = known ? list.reduce((p, l) => p * l.prob, 1) : null;
  return { decimal, american: decimal > 1 ? decimalToAmerican(decimal) : null, prob, ev: prob != null ? prob * decimal - 1 : null };
}

function render() {
  const el = document.getElementById('slip');
  document.getElementById('slip-count').textContent = legs.length;
  const body = legs
    .map(
      (l, i) => `<li>
        <div><strong>${esc(l.name)}</strong>
        <span>${l.side === 'over' ? 'Over' : 'Under'} ${esc(l.line)} ${esc(MARKETS[l.market]?.label ?? l.market)}</span>
        <small>${esc(l.matchup || '')}${l.prob != null ? ` · est. ${pct(l.prob, 1)}` : ''}</small></div>
        <b class="mono">${price(l.price)}</b>
        <button class="icon-btn" type="button" data-remove="${i}" aria-label="Remove ${esc(l.name)}">×</button>
      </li>`,
    )
    .join('');
  let summary = '';
  if (legs.length) {
    const p = parlay(legs);
    const sameGame = new Set(legs.map((l) => l.gameId)).size < legs.length;
    summary = `
      <div class="slip-summary">
        <label>Stake <input id="slip-stake" type="number" min="0" step="1" value="${stake}" inputmode="decimal"></label>
        <dl>
          <div><dt>${legs.length > 1 ? 'Parlay odds' : 'Odds'}</dt><dd class="mono">${price(p.american)}</dd></div>
          <div><dt>Payout</dt><dd class="mono">$${(stake * p.decimal).toFixed(2)}</dd></div>
          <div><dt>Book's implied chance</dt><dd class="mono">${pct(1 / p.decimal, 1)}</dd></div>
          ${p.prob != null ? `<div><dt>Estimated chance</dt><dd class="mono">${pct(p.prob, 1)}</dd></div>
          <div><dt>Estimated EV</dt><dd class="mono">${signedPct(p.ev)}</dd></div>` : ''}
        </dl>
        ${sameGame ? `<p class="note">Legs from the same game are correlated, and books price same-game parlays differently, so treat these parlay figures as rough.</p>` : ''}
        <div class="slip-actions">
          <button class="btn" type="button" id="slip-copy">Copy slip</button>
          <button class="btn btn-quiet" type="button" id="slip-clear">Clear</button>
        </div>
      </div>`;
  }
  el.innerHTML = `
    <div class="slip-head"><h2>Slip</h2><button class="icon-btn" type="button" id="slip-close" aria-label="Close slip">×</button></div>
    ${legs.length ? `<ul class="slip-legs">${body}</ul>${summary}` : '<p class="slip-empty">Press + on any prop to compare legs and work out parlay odds. Nothing here places a bet.</p>'}`;
}

export function initSlip() {
  const el = document.getElementById('slip');
  const toggle = document.getElementById('slip-toggle');
  const setOpen = (open) => {
    el.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
  };
  const changed = () => {
    save();
    render();
    document.dispatchEvent(new CustomEvent('slipchange'));
  };
  toggle.addEventListener('click', () => setOpen(el.hidden));
  // On a phone the drawer covers the page, so moving to another page should close it.
  window.addEventListener('hashchange', () => {
    if (window.innerWidth < 760) setOpen(false);
  });
  el.addEventListener('click', (e) => {
    const remove = e.target.closest('[data-remove]');
    if (remove) {
      legs = legs.filter((_, i) => i !== Number(remove.dataset.remove));
      changed();
    }
    if (e.target.closest('#slip-close')) setOpen(false);
    if (e.target.closest('#slip-clear')) {
      legs = [];
      changed();
    }
    const copy = e.target.closest('#slip-copy');
    if (copy) {
      const text = legs
        .map((l) => `${l.name} ${l.side === 'over' ? 'Over' : 'Under'} ${l.line} ${MARKETS[l.market]?.label} (${price(l.price)})`)
        .join('\n');
      navigator.clipboard?.writeText(text).then(() => {
        copy.textContent = 'Copied';
        setTimeout(() => {
          copy.textContent = 'Copy slip';
        }, 1200);
      });
    }
  });
  el.addEventListener('change', (e) => {
    if (e.target.id === 'slip-stake') {
      stake = Math.max(0, Number(e.target.value) || 0);
      render();
    }
  });
  render();
}
