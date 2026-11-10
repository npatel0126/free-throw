// A player's research page: hit chart, projection breakdown, alt lines and game log.

import { api, empty, esc, fmtDay, fmtTime, injuryBadge, logo, num, pct, price, signedPct, teamFill, teamRail } from '../ui.js';
import { MARKETS, statOf, hitRate, lineProbs, expectedValue, impliedProb, streak } from '/shared/math.js';
import { hitChart } from '../charts.js';
import { inSlip, toggleLeg } from '../slip.js';

const HISTORY_FILTERS = [
  ['l5', 'L5'],
  ['l10', 'L10'],
  ['l20', 'L20'],
  ['season', 'This season'],
  ['last', 'Last season'],
  ['all', 'All'],
  ['h2h', 'H2H'],
  ['home', 'Home'],
  ['away', 'Away'],
];

// The model's tails run fatter than a book's, so its EV on long shots looks far
// better than it is. We show the price and chance there, but no EV figure.
const LONG_SHOT_PRICE = 300;

export async function playerView(view, { id, params, isCurrent }) {
  const data = await api(`/api/player/${encodeURIComponent(id)}`);
  if (!isCurrent()) return;
  const { profile, team, game, logs, markets, teammates, season, oppId, injury } = data;

  const firstWithLine = Object.keys(MARKETS).find((m) => markets[m].line);
  const state = {
    market: params.get('m') && MARKETS[params.get('m')] ? params.get('m') : firstWithLine ?? 'pts',
    filter: 'l10',
    without: null,
    line: null,
    price: -110,
  };

  const opp = game ? (game.home.id === oppId ? game.home : game.away) : null;
  const home = game ? game.home.id === profile.teamId : false;

  function resetLine() {
    const m = markets[state.market];
    if (m.line) {
      state.line = m.line.line;
    } else {
      const base = m.proj?.mean ?? (logs.length ? hitRate(logs.slice(0, 10), state.market, 0).avg : 0.5);
      state.line = Math.max(0.5, Math.floor(base) + 0.5);
    }
  }
  resetLine();

  // Games on this team, since the teammate joined it, that the teammate missed.
  const gamesWithout = (t) => {
    const played = new Set(t.played);
    const since = new Date(t.since);
    return logs.filter((g) => g.teamId === profile.teamId && new Date(g.date) >= since && !played.has(g.eventId));
  };

  const filteredGames = () => {
    let list = logs;
    if (state.without) {
      const t = teammates.find((x) => x.id === state.without);
      if (t) list = gamesWithout(t);
    }
    switch (state.filter) {
      case 'l5': return list.slice(0, 5);
      case 'l10': return list.slice(0, 10);
      case 'l20': return list.slice(0, 20);
      case 'season': return list.filter((g) => g.season === season);
      case 'last': return list.filter((g) => g.season === season - 1);
      case 'h2h': return list.filter((g) => g.oppId === oppId);
      case 'home': return list.filter((g) => g.home);
      case 'away': return list.filter((g) => !g.home);
      default: return list;
    }
  };

  // Odds for the side being looked at: the posted price at the book's number,
  // otherwise whatever price the user types in for their own book or app.
  const quote = () => {
    const m = markets[state.market];
    const atBookLine = m.line && m.line.line === state.line;
    const mean = m.est?.mean ?? m.proj?.mean ?? null;
    const vmr = m.proj?.vmr ?? null;
    const probs = mean != null ? lineProbs(mean, vmr, state.line) : null;
    const overPrice = atBookLine ? m.line.over : state.price;
    const underPrice = atBookLine ? m.line.under : state.price;
    return {
      atBookLine,
      overPrice,
      underPrice,
      probs,
      evOver: probs ? expectedValue(probs.over, overPrice) : null,
      evUnder: probs ? expectedValue(probs.under, underPrice) : null,
    };
  };

  function legFor(side) {
    const q = quote();
    return {
      athleteId: profile.id,
      name: profile.name,
      market: state.market,
      side,
      line: state.line,
      price: side === 'over' ? q.overPrice : q.underPrice,
      prob: q.probs ? (side === 'over' ? q.probs.over : q.probs.under) : null,
      gameId: game?.id ?? '',
      matchup: game ? `${team?.abbr ?? ''} ${home ? 'vs' : '@'} ${opp.abbr}` : '',
    };
  }

  const heroHtml = () => `
    <section class="player-hero" style="--team:${teamFill(team?.color, team?.alt)};--rail:${teamRail(team?.color, team?.alt)}">
      ${profile.jersey ? `<span class="ghost-number" aria-hidden="true">${esc(profile.jersey)}</span>` : ''}
      <img class="headshot" src="${esc(profile.headshot || logo(team?.abbr))}" alt="" width="330" height="240">
      <div class="player-title">
        <span class="caps eyebrow">${esc(team?.name ?? 'Free agent')}  ·  ${esc({ G: 'Guard', F: 'Forward', C: 'Center' }[profile.pos] ?? profile.pos)}${profile.jersey ? `  ·  #${esc(profile.jersey)}` : ''}</span>
        <h1>${esc(profile.name)} ${injuryBadge(injury)}</h1>
        ${game
          ? `<p class="next-game"><img src="${logo(opp.abbr)}" alt="" width="26" height="26"> <span>${home ? 'vs' : '@'} <strong>${esc(opp.name)}</strong>  ·  ${fmtDay(game.start)}, ${fmtTime(game.start)}${game.total ? `  ·  Total ${esc(game.total)}` : ''}</span></p>`
          : '<p class="next-game"><span>No game in the next week</span></p>'}
        ${injury?.note ? `<p class="injury-note">${esc(injury.note)}</p>` : ''}
      </div>
      <div class="line-panel" id="line-panel"></div>
    </section>
    <div class="stat-tabs" role="tablist" aria-label="Stat">
      ${Object.entries(MARKETS)
        .map(([k, m]) => {
          const posted = markets[k].line;
          return `<button type="button" role="tab" aria-selected="${k === state.market}" class="stat-tab ${k === state.market ? 'on' : ''}" data-market="${k}"><span class="caps">${m.short}</span><b class="${posted ? '' : 'none'}">${posted ? esc(posted.line) : '—'}</b></button>`;
        })
        .join('')}
    </div>
    <div id="panel"></div>`;

  function sideCard(side, q) {
    const over = side === 'over';
    const on = inSlip(legFor(side));
    const ev = over ? q.evOver : q.evUnder;
    const prob = q.probs ? (over ? q.probs.over : q.probs.under) : null;
    const px = over ? q.overPrice : q.underPrice;
    const st = streak(logs, state.market, state.line, side);
    const hr = hitRate(logs.slice(0, 10), state.market, state.line);
    return `
      <div class="side-card side-card-${side}">
        <div class="side-card-head"><strong>${over ? 'Over' : 'Under'}</strong> <b>${price(px)}</b></div>
        <dl>
          <div><dt>Est. chance</dt><dd class="mono">${pct(prob, 1)}</dd></div>
          <div><dt>Break-even</dt><dd class="mono">${pct(impliedProb(px), 1)}</dd></div>
          <div><dt>Est. EV</dt><dd class="mono ${ev > 0 ? 'ev-pos' : ''}">${signedPct(ev)}</dd></div>
          <div><dt>Last 10</dt><dd class="mono">${pct(over ? hr.overPct : hr.underPct)}</dd></div>
          <div><dt>Streak</dt><dd class="mono">${st}</dd></div>
        </dl>
        <button type="button" class="btn btn-block ${on ? 'btn-on' : ''}" data-leg="${side}" aria-pressed="${on}">${on ? 'On slip ✓' : 'Add to slip'}</button>
      </div>`;
  }

  function linePanelHtml() {
    const m = markets[state.market];
    const q = quote();
    const openMove = m.line && m.line.openLine != null && m.line.openLine !== m.line.line
      ? `opened ${esc(m.line.openLine)}`
      : m.line ? `opened ${price(m.line.openOver)} / ${price(m.line.openUnder)}` : '';
    return `
      <div class="line-control">
        <div class="line-meta">
          <span class="caps">${esc(MARKETS[state.market].label)} line</span>
          ${m.line
            ? `<small>${q.atBookLine ? `DraftKings · ${openMove}` : `Your own number · <button type="button" class="link-btn" data-reset>back to ${esc(m.line.line)}</button>`}</small>`
            : '<small>DraftKings has no line for this stat yet</small>'}
        </div>
        ${q.atBookLine ? '' : `<label class="price-input">Your price <input id="price-input" type="number" step="5" value="${state.price}"></label>`}
        <div class="stepper">
          <button type="button" class="icon-btn" data-step="-1" aria-label="Lower the line">−</button>
          <input id="line-input" type="number" step="0.5" min="0" value="${state.line}" aria-label="Line">
          <button type="button" class="icon-btn" data-step="1" aria-label="Raise the line">+</button>
        </div>
      </div>
      <div class="side-cards">${sideCard('over', q)}${sideCard('under', q)}</div>`;
  }

  function breakdownHtml(m) {
    if (!m.proj) {
      return `<section class="card"><h2>Projection</h2>${empty(game ? 'Not enough games to project' : 'No upcoming game', game ? 'We need at least 5 games of history.' : '')}</section>`;
    }
    const f = m.proj.factors;
    const factor = (name, value, tip) => {
      const delta = value - 1;
      const text = Math.abs(delta) < 0.001 ? 'none' : signedPct(delta);
      return `<div data-tip="${esc(tip)}"><span>${name}</span><b>${text}</b></div>`;
    };
    const dvpText = m.dvp?.rank ? ` (ranked ${m.dvp.rank} of 30, where 30 is softest)` : '';
    return `<section class="card">
      <h2>How the number is built</h2>
      <div class="breakdown">
        <div><span>Production per minute</span><b>${num(f.rate, 3)}</b></div>
        <div><span>Expected minutes</span><b>${num(f.minutes)}</b></div>
        ${factor(`Matchup vs ${esc(opp.abbr)}`, f.matchup, `How ${opp.abbr} defends ${profile.pos}s${dvpText}, regressed toward average`)}
        ${factor('Game environment', f.environment, "The team's implied score tonight vs its usual scoring")}
        ${factor(home ? 'Home' : 'Away', f.venue, 'A small venue adjustment')}
        <div class="total"><span>Model projection</span><b>${num(m.proj.mean)}</b></div>
        ${m.est
          ? `<div><span>DraftKings' implied</span><b>${num(m.est.marketMean)}</b></div>
             <div class="total blend"><span>Blended estimate</span><b>${num(m.est.mean)}</b></div>`
          : ''}
      </div>
      <p class="note">${m.est
        ? "15% model, 85% market, the mix that scored best in the backtest. The model alone is less accurate than the book's line."
        : "DraftKings has no line here, so the estimates above come from the model alone, which is less accurate than a book's line."} <a href="#/record">See the evidence</a>.</p>
    </section>`;
  }

  function ladderHtml(m) {
    if (!m.alts.length) {
      return `<section class="card"><h2>Alternate lines</h2>${empty('No alternate lines posted', 'Use the line control above to test any number.')}</section>`;
    }
    const recent = logs.slice(0, 20);
    const rows = m.alts
      .map((a) => {
        const hit = recent.length ? recent.filter((g) => statOf(g, state.market) >= a.threshold).length / recent.length : null;
        const showEv = a.price < LONG_SHOT_PRICE;
        return `<tr>
          <th scope="row" class="num" style="text-align:left!important">${esc(a.threshold)}+</th>
          <td class="num">${price(a.price)}</td>
          <td class="num">${pct(a.prob, 1)}</td>
          <td class="num">${pct(impliedProb(a.price), 1)}</td>
          <td class="num">${pct(hit)}</td>
          <td class="num ${showEv && a.ev > 0 ? 'ev-pos' : 'faint'}">${showEv ? signedPct(a.ev) : '—'}</td>
        </tr>`;
      })
      .join('');
    return `<section class="card">
      <h2>Alternate lines</h2>
      <div class="table-wrap ladder"><table class="data compact">
        <thead><tr><th scope="col">Number</th><th scope="col" class="num">Price</th><th scope="col" class="num">Est.</th><th scope="col" class="num">Implied</th><th scope="col" class="num">L20</th><th scope="col" class="num">Est. EV</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <p class="note">Estimates are least reliable on long shots, so no EV is shown at +${LONG_SHOT_PRICE} or longer.</p>
    </section>`;
  }

  function logTable(games) {
    if (!games.length) return empty('No games match this filter');
    const rows = games
      .map((g) => {
        const value = statOf(g, state.market);
        const verdict = value > state.line ? 'over' : value < state.line ? 'under' : 'push';
        return `<tr>
          <td>${fmtDay(g.date)}</td>
          <td>${g.home ? 'vs' : '@'} ${esc(g.oppAbbr)}</td>
          <td class="faint">${esc(g.result ?? '')} ${esc(g.score ?? '')}</td>
          <td class="num"><span class="verdict verdict-${verdict}">${verdict === 'push' ? 'P' : verdict === 'over' ? 'O' : 'U'}</span> ${value}</td>
          <td class="num">${g.min}</td><td class="num">${g.pts}</td><td class="num">${g.reb}</td><td class="num">${g.ast}</td>
          <td class="num">${g.fg3m}-${g.fg3a}</td><td class="num">${g.stl}</td><td class="num">${g.blk}</td><td class="num">${g.to}</td>
        </tr>`;
      })
      .join('');
    return `<div class="table-wrap"><table class="data compact log-table">
      <thead><tr><th scope="col">Date</th><th scope="col">Opp</th><th scope="col">Result</th><th scope="col" class="num">${MARKETS[state.market].short}</th><th scope="col" class="num">MIN</th><th scope="col" class="num">PTS</th><th scope="col" class="num">REB</th><th scope="col" class="num">AST</th><th scope="col" class="num">3PT</th><th scope="col" class="num">STL</th><th scope="col" class="num">BLK</th><th scope="col" class="num">TO</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`;
  }

  function panelHtml() {
    const m = markets[state.market];
    const games = filteredGames();
    const hr = hitRate(games, state.market, state.line);
    const median = games.length
      ? [...games.map((g) => statOf(g, state.market))].sort((a, b) => a - b)[Math.floor(games.length / 2)]
      : null;

    const withoutChips = teammates
      .map((t) => {
        const count = gamesWithout(t).length;
        if (!count) return '';
        return `<button type="button" class="chip ${state.without === t.id ? 'on' : ''}" data-without="${esc(t.id)}" aria-pressed="${state.without === t.id}">Without ${esc(t.name.split(' ').slice(-1)[0])} <small>${count}</small></button>`;
      })
      .join('');

    return `
      <div class="player-cols">
        <section class="card">
          <div class="card-head">
            <h2>Game by game</h2>
            <div class="hit-summary">
              <span><b>${hr.n ? `${hr.over}/${hr.n}` : '—'}</b>over</span>
              <span><b>${pct(hr.overPct)}</b>hit rate</span>
              <span><b>${num(hr.avg)}</b>average</span>
              <span><b>${median ?? '—'}</b>median</span>
            </div>
          </div>
          <div class="chips" role="group" aria-label="Games shown">
            ${HISTORY_FILTERS.map(([k, name]) => `<button type="button" class="chip ${state.filter === k ? 'on' : ''}" data-filter="${k}" aria-pressed="${state.filter === k}">${name}</button>`).join('')}
            ${withoutChips}
          </div>
          <div id="chart" class="chart-host"></div>
        </section>
        ${breakdownHtml(m)}
      </div>
      ${ladderHtml(m)}
      <section class="card">
        <div class="card-head"><h2>Game log</h2><small class="muted">${games.length} games · hit shown against ${esc(state.line)}</small></div>
        ${logTable(games)}
      </section>`;
  }

  function drawChart() {
    const host = document.getElementById('chart');
    if (host) host.innerHTML = hitChart(filteredGames(), state.market, state.line, host.clientWidth || 700);
  }

  function renderPanel() {
    document.getElementById('line-panel').innerHTML = linePanelHtml();
    document.getElementById('panel').innerHTML = panelHtml();
    drawChart();
  }
  function renderAll() {
    view.innerHTML = heroHtml();
    renderPanel();
  }

  if (!logs.length) {
    view.innerHTML = heroHtml();
    document.getElementById('line-panel').hidden = true;
    document.getElementById('panel').innerHTML = empty('No NBA games on record', 'Check back once this player has appeared in a game.');
    return;
  }
  renderAll();

  const setLine = (value) => {
    state.line = Math.max(0, Math.round(value * 2) / 2);
    renderPanel();
  };

  const onClick = (e) => {
    const t = e.target;
    const market = t.closest('[data-market]');
    if (market) {
      state.market = market.dataset.market;
      resetLine();
      renderAll();
      return;
    }
    const filter = t.closest('[data-filter]');
    if (filter) {
      state.filter = filter.dataset.filter;
      renderPanel();
      return;
    }
    const without = t.closest('[data-without]');
    if (without) {
      state.without = state.without === without.dataset.without ? null : without.dataset.without;
      if (state.without && ['l5', 'l10', 'l20'].includes(state.filter)) state.filter = 'all';
      renderPanel();
      return;
    }
    const step = t.closest('[data-step]');
    if (step) {
      setLine(state.line + Number(step.dataset.step));
      return;
    }
    if (t.closest('[data-reset]')) {
      resetLine();
      renderPanel();
      return;
    }
    const leg = t.closest('[data-leg]');
    if (leg) toggleLeg(legFor(leg.dataset.leg));
  };
  const onChange = (e) => {
    if (e.target.id === 'line-input') setLine(Number(e.target.value) || 0);
    if (e.target.id === 'price-input') {
      const v = Number(e.target.value);
      if (v >= 100 || v <= -100) state.price = v;
      renderPanel();
    }
  };
  const onSlip = () => renderPanel();
  view.addEventListener('click', onClick);
  view.addEventListener('change', onChange);
  document.addEventListener('slipchange', onSlip);
  const observer = new ResizeObserver(() => drawChart());
  observer.observe(view);

  return () => {
    observer.disconnect();
    view.removeEventListener('click', onClick);
    view.removeEventListener('change', onChange);
    document.removeEventListener('slipchange', onSlip);
  };
}
