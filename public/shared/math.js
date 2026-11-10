// Odds and probability math. Imported by both the server and the browser.

export const impliedProb = (am) => (am < 0 ? -am / (-am + 100) : 100 / (am + 100));
export const toDecimal = (am) => (am < 0 ? 1 + 100 / -am : 1 + am / 100);
export const decimalToAmerican = (dec) =>
  dec >= 2 ? Math.round((dec - 1) * 100) : Math.round(-100 / (dec - 1));
export const probToAmerican = (p) => decimalToAmerican(1 / p);
export const fmtAmerican = (am) =>
  am == null || Number.isNaN(am) ? '—' : am > 0 ? `+${Math.round(am)}` : `${Math.round(am)}`;

// Expected profit per $1 staked.
export const expectedValue = (p, am) => p * toDecimal(am) - 1;

// Removes the bookmaker's margin from a two-way market. Returns [fairA, fairB].
export function devig(amA, amB, method = 'multiplicative') {
  const a = impliedProb(amA);
  const b = impliedProb(amB);
  const total = a + b;
  if (method === 'additive') {
    const cut = (total - 1) / 2;
    return [a - cut, b - cut];
  }
  if (method === 'power') {
    let lo = 1;
    let hi = 10;
    for (let i = 0; i < 60; i++) {
      const k = (lo + hi) / 2;
      if (a ** k + b ** k > 1) lo = k;
      else hi = k;
    }
    const k = (lo + hi) / 2;
    return [a ** k, b ** k];
  }
  if (method === 'shin') {
    // Shin's insider-trading model, solved by bisection on z.
    const fair = (z, x) => (Math.sqrt(z * z + 4 * (1 - z) * (x * x) / total) - z) / (2 * (1 - z));
    let lo = 0;
    let hi = 0.5;
    for (let i = 0; i < 60; i++) {
      const z = (lo + hi) / 2;
      if (fair(z, a) + fair(z, b) > 1) lo = z;
      else hi = z;
    }
    const z = (lo + hi) / 2;
    return [fair(z, a), fair(z, b)];
  }
  return [a / total, b / total];
}

export const hold = (amA, amB) => impliedProb(amA) + impliedProb(amB) - 1;

export function kelly(p, am, fraction = 1) {
  const b = toDecimal(am) - 1;
  return Math.max(0, ((b * p - (1 - p)) / b) * fraction);
}

// --- Stat distribution ---------------------------------------------------
// Counting stats are modelled as negative binomial with mean mu and
// variance = mu * vmr (variance-to-mean ratio); vmr <= 1 falls back to Poisson.

function pmfSeries(mu, vmr, upTo) {
  const out = new Array(upTo + 1);
  if (mu <= 0) {
    out.fill(0);
    out[0] = 1;
    return out;
  }
  if (vmr <= 1.001) {
    let p = Math.exp(-mu);
    out[0] = p;
    for (let k = 1; k <= upTo; k++) {
      p *= mu / k;
      out[k] = p;
    }
    return out;
  }
  const r = mu / (vmr - 1);
  const q = 1 / vmr;
  let p = q ** r;
  out[0] = p;
  for (let k = 1; k <= upTo; k++) {
    p *= ((k - 1 + r) / k) * (1 - q);
    out[k] = p;
  }
  return out;
}

// Returns { over, push, under } for a line such as 22.5 or 23.
export function lineProbs(mu, vmr, line) {
  const floor = Math.floor(line);
  const isWhole = floor === line;
  const pmf = pmfSeries(mu, vmr, Math.max(floor, 0));
  let below = 0;
  const lastUnder = isWhole ? floor - 1 : floor;
  for (let k = 0; k <= lastUnder; k++) below += pmf[k];
  const push = isWhole ? pmf[floor] : 0;
  const under = Math.min(1, below);
  return { over: Math.max(0, 1 - under - push), push, under };
}

// The mean that makes P(over line) equal pOver. Used to read the market's
// implied projection off its line and price.
export function impliedMean(line, pOver, vmr) {
  let lo = 0.01;
  let hi = Math.max(line * 3, 15);
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (lineProbs(mid, vmr, line).over < pOver) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export const MARKETS = {
  pts: { label: 'Points', short: 'PTS', parts: ['pts'] },
  reb: { label: 'Rebounds', short: 'REB', parts: ['reb'] },
  ast: { label: 'Assists', short: 'AST', parts: ['ast'] },
  fg3m: { label: '3-Pointers', short: '3PM', parts: ['fg3m'] },
  stl: { label: 'Steals', short: 'STL', parts: ['stl'] },
  blk: { label: 'Blocks', short: 'BLK', parts: ['blk'] },
  pa: { label: 'Pts + Ast', short: 'P+A', parts: ['pts', 'ast'] },
  pr: { label: 'Pts + Reb', short: 'P+R', parts: ['pts', 'reb'] },
  ra: { label: 'Reb + Ast', short: 'R+A', parts: ['reb', 'ast'] },
  pra: { label: 'Pts + Reb + Ast', short: 'PRA', parts: ['pts', 'reb', 'ast'] },
};

export const statOf = (game, market) =>
  MARKETS[market].parts.reduce((sum, part) => sum + (game[part] || 0), 0);

// Hit counts for a list of games at a line. Pushes count as games but not hits.
export function hitRate(games, market, line) {
  let over = 0;
  let under = 0;
  let total = 0;
  for (const g of games) {
    const v = statOf(g, market);
    total += v;
    if (v > line) over++;
    else if (v < line) under++;
  }
  const n = games.length;
  return {
    n,
    over,
    under,
    overPct: n ? over / n : null,
    underPct: n ? under / n : null,
    avg: n ? total / n : null,
  };
}

// Consecutive most-recent games clearing the line on a given side.
export function streak(games, market, line, side) {
  let count = 0;
  for (const g of games) {
    const v = statOf(g, market);
    if (side === 'over' ? v > line : v < line) count++;
    else break;
  }
  return count;
}
