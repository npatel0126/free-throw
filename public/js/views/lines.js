// Multi-book odds screen, plus arbitrage, middle and +EV scans over game lines.

import { api, empty, esc, fmtTime, num, pct, price, signedPct } from '../ui.js';
import { toDecimal } from '/shared/math.js';

const state = { tab: 'screen', market: 'ml' };

// Books posting at least one price on an upcoming game; a book can drop out for a while.
const activeBooks = (data) =>
  data.books.filter((b) => data.games.some((g) => g.status === 'scheduled' && g.books.some((r) => r.book === b)));

const fmtSpread = (v) => (v == null ? '' : v > 0 ? `+${v}` : `${v}`);

function bestMark(values) {
  const known = values.filter((v) => v != null);
  return known.length ? Math.max(...known.map(toDecimal)) : null;
}

function oddsCell(label, value, best) {
  if (value == null) return '<td class="num faint">—</td>';
  const isBest = best != null && Math.abs(toDecimal(value) - best) < 1e-9;
  return `<td class="num ${isBest ? 'best-price' : ''}">${label ? `<small>${esc(label)}</small> ` : ''}${price(value)}${isBest ? '<span class="sr-only"> best price</span>' : ''}</td>`;
}

function screen(data) {
  const games = data.games.filter((g) => g.status === 'scheduled');
  if (!games.length) return empty('No upcoming games to compare', 'Lines appear here once books post the next slate.');
  const books = activeBooks(data);
  const head = books.map((b) => `<th scope="col" class="num">${esc(b)}</th>`).join('');
  const rows = games
    .map((g) => {
      const byBook = (name) => g.books.find((r) => r.book === name);
      const line = (kind) => {
        const pick = (r) => {
          if (!r) return { label: '', value: null };
          if (state.market === 'ml') return { label: '', value: kind === 'a' ? r.mlAway : r.mlHome };
          if (state.market === 'spread') {
            const n = kind === 'a' ? r.spreadAway : r.spreadAway == null ? null : -r.spreadAway;
            return { label: fmtSpread(n), value: kind === 'a' ? r.spreadAwayPrice : r.spreadHomePrice };
          }
          return { label: r.total == null ? '' : `${r.total}`, value: kind === 'a' ? r.over : r.under };
        };
        const cells = books.map((b) => pick(byBook(b)));
        // Comparing prices only means something at the same number, so spreads and
        // totals highlight the best price among books posting the most common number.
        let pool = cells;
        if (state.market !== 'ml') {
          const counts = {};
          cells.forEach((c) => {
            if (c.value != null) counts[c.label] = (counts[c.label] || 0) + 1;
          });
          const common = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
          pool = cells.filter((c) => c.label === common);
        }
        const best = bestMark(pool.map((c) => c.value));
        return cells.map((c) => oddsCell(c.label, c.value, pool.includes(c) ? best : null)).join('');
      };
      const rowLabel = (t, i) => (state.market === 'total' ? (i ? 'Under' : 'Over') : t.abbr);
      return `<tr class="group-start"><th scope="row" rowspan="2" class="game-label">${esc(g.away.abbr)} @ ${esc(g.home.abbr)}<small>${fmtTime(g.start)}</small></th>
          <td class="side-label">${esc(rowLabel(g.away, 0))}</td>${line('a')}</tr>
        <tr><td class="side-label">${esc(rowLabel(g.home, 1))}</td>${line('b')}</tr>`;
    })
    .join('');
  const seg = [['ml', 'Moneyline'], ['spread', 'Spread'], ['total', 'Total']]
    .map(([k, l]) => `<button type="button" class="chip ${state.market === k ? 'on' : ''}" data-market="${k}" aria-pressed="${state.market === k}">${l}</button>`)
    .join('');
  return `<div class="chips" role="group" aria-label="Market">${seg}</div>
    <p class="note">The outlined price is the best available at the most common number. Prices come from each book's New Jersey market and can differ in your state.</p>
    <div class="table-wrap"><table class="data odds-table"><thead><tr><th scope="col">Game</th><th scope="col"></th>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

const legBox = (leg) => `<div class="leg"><span>${esc(leg.name)}</span><b class="mono">${price(leg.price)}</b><small>${esc(leg.book)}</small></div>`;

function arbs(data) {
  if (!data.arbs.length) {
    return empty('No arbitrage open right now', "That's normal. Real arbs between major books are rare and close within minutes. This scan refreshes every two minutes.");
  }
  return `<p class="note">Bet both sides at these books and the total return is the same either way. Confirm both prices first, since a stale line here looks exactly like an arb.</p>
    <div class="opp-grid">${data.arbs
      .map((a) => `<article class="card opp"><header><strong>${esc(a.game)}</strong><span class="muted">${esc(a.market)}</span></header>
        ${legBox(a.a)}${legBox(a.b)}
        <footer><span><b class="mono">${pct(a.profit, 2)}</b> guaranteed</span><span class="muted">On $100: $${(a.stakeA * 100).toFixed(2)} / $${((1 - a.stakeA) * 100).toFixed(2)}</span></footer></article>`)
      .join('')}</div>`;
}

function middles(data) {
  if (!data.middles.length) return empty('No middles open right now', 'A middle needs two books at different numbers, which is more common close to tip-off.');
  return `<p class="note">If the final lands between the two numbers, both tickets win. Otherwise one wins and one loses, and you pay the cost shown. Results rarely land inside a one-point gap, so size these carefully.</p>
    <div class="table-wrap"><table class="data"><thead><tr><th scope="col">Game</th><th scope="col">Leg 1</th><th scope="col">Leg 2</th><th scope="col" class="num">Width</th><th scope="col" class="num" data-tip="Combined margin paid when only one leg wins">Cost</th></tr></thead><tbody>
    ${data.middles
      .map((m) => `<tr><th scope="row">${esc(m.game)}</th><td>${esc(m.a.name)} <b class="mono">${price(m.a.price)}</b> <small class="muted">${esc(m.a.book)}</small></td><td>${esc(m.b.name)} <b class="mono">${price(m.b.price)}</b> <small class="muted">${esc(m.b.book)}</small></td><td class="num">${num(m.width)}</td><td class="num">${pct(m.cost, 1)}</td></tr>`)
      .join('')}
    </tbody></table></div>`;
}

function evTab(data) {
  if (!data.ev.length) return empty('No +EV prices right now', 'No book is beating the average no-vig price of the others on a matching number.');
  return `<p class="note">Fair value here is the average no-vig price across every book at the same number, with at least three books required. This compares books with each other, so it doesn't rely on our player model.</p>
    <div class="table-wrap"><table class="data"><thead><tr><th scope="col">Game</th><th scope="col">Bet</th><th scope="col">Book</th><th scope="col" class="num">Price</th><th scope="col" class="num">Fair</th><th scope="col" class="num">EV</th><th scope="col" class="num">Books</th></tr></thead><tbody>
    ${data.ev
      .map((e) => `<tr><th scope="row">${esc(e.game)}</th><td>${esc(e.pick)}</td><td>${esc(e.book)}</td><td class="num">${price(e.price)}</td><td class="num">${pct(e.fair, 1)}</td><td class="num ev-pos">${signedPct(e.ev)}</td><td class="num">${e.books}</td></tr>`)
      .join('')}
    </tbody></table></div>`;
}

export async function linesView(view, { isCurrent }) {
  let data = await api('/api/lines');
  if (!isCurrent()) return;

  function render() {
    const tabs = [
      ['screen', 'Odds screen'],
      ['arbs', `Arbitrage (${data.arbs.length})`],
      ['middles', `Middles (${data.middles.length})`],
      ['ev', `+EV (${data.ev.length})`],
    ];
    const body = { screen, arbs, middles, ev: evTab }[state.tab](data);
    view.innerHTML = `
      <div class="page-head"><div><h1>Lines</h1>
        <p class="sub">Spreads, totals and moneylines across ${activeBooks(data).length} books. Player props come from DraftKings alone, because no free feed we found carries them across books.</p></div></div>
      <div class="tabs" role="tablist">${tabs.map(([k, l]) => `<button type="button" role="tab" aria-selected="${state.tab === k}" class="tab ${state.tab === k ? 'on' : ''}" data-tab="${k}">${esc(l)}</button>`).join('')}</div>
      <div class="tab-body">${body}</div>`;
  }
  render();

  const onClick = (e) => {
    const tab = e.target.closest('[data-tab]');
    if (tab) {
      state.tab = tab.dataset.tab;
      render();
    }
    const market = e.target.closest('[data-market]');
    if (market) {
      state.market = market.dataset.market;
      render();
    }
  };
  view.addEventListener('click', onClick);
  const timer = setInterval(async () => {
    try {
      data = await api('/api/lines');
      render();
    } catch {
      /* keep the last good data on screen */
    }
  }, 120_000);
  return () => {
    clearInterval(timer);
    view.removeEventListener('click', onClick);
  };
}
