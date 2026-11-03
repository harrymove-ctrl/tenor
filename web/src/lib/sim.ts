// A local, deterministic Tenor market for the demo. It follows the same rules
// as contracts/src/TenorMarket.sol and TenorRouter.sol: PT and YT are minted
// 1:1, sMUSD yield (less a 5% fee) streams to YT until maturity, PT redeems
// for 1 MUSD after it, and trades go through a Tigris stable pool.

import { getAmountOut, priceForApr, spotPrice, impliedApr, type Reserves } from "./stableswap";

export const YEAR = 365 * 86400;
export const DAY = 86400;
export const FEE = 0.05;
export const MAX_IMPACT = 0.05;

export type Position = { musd: number; pt: number; yt: number; claimable: number; claimed: number; costBasis: number };

export type Market = {
  now: number; // unix seconds
  start: number;
  maturity: number;
  reserves: Reserves;
  ytSupply: number;
  smusdApr: number; // the variable rate sMUSD is paying in the simulation
  marketApr: number; // the rate the market expects; an arbitrageur keeps the pool near it
  user: Position;
  log: Activity[];
};

export type Activity = { id: number; at: number; kind: "fixed" | "bet" | "claim" | "redeem" | "yield" | "time"; text: string };

const START = Date.UTC(2026, 10, 3, 12) / 1000; // 2026-11-03 12:00 UTC
const MATURITY = Date.UTC(2026, 11, 31, 12) / 1000; // 2026-12-31 12:00 UTC

export function initialMarket(liveApr = 0.0206): Market {
  const market: Market = {
    now: START,
    start: START,
    maturity: MATURITY,
    reserves: { pt: 250_000, musd: 250_000 },
    ytSupply: 300_000, // the seeding LP minted 300k and kept the YT
    smusdApr: liveApr,
    marketApr: Math.max(0.01, liveApr),
    user: { musd: 10_000, pt: 0, yt: 0, claimable: 0, claimed: 0, costBasis: 0 },
    log: [],
  };
  return arbToTarget(market);
}

export const secondsLeft = (m: Market) => Math.max(0, m.maturity - m.now);
export const matured = (m: Market) => m.now >= m.maturity;
export const ptPrice = (m: Market) => (matured(m) ? 1 : spotPrice(m.reserves));
export const marketImpliedApr = (m: Market) => impliedApr(ptPrice(m), secondsLeft(m));

// Quotes

export type FixedQuote = { musdIn: number; ptOut: number; payoutAtMaturity: number; gain: number; apr: number; priceImpact: number };

export function quoteFixed(m: Market, musdIn: number): FixedQuote | null {
  if (musdIn <= 0 || matured(m)) return null;
  const ptOut = getAmountOut(m.reserves, musdIn, "musd");
  if (ptOut <= 0) return null;
  const left = secondsLeft(m);
  const apr = (ptOut / musdIn - 1) * (YEAR / left);
  const priceImpact = Math.max(0, musdIn / ptOut / spotPrice(m.reserves) - 1);
  // Refuse trades that would buy PT above par or move the pool more than 5%.
  if (ptOut <= musdIn || priceImpact > MAX_IMPACT) return null;
  return { musdIn, ptOut, payoutAtMaturity: ptOut, gain: ptOut - musdIn, apr, priceImpact };
}

export type BetQuote = { musdIn: number; ytOut: number; leverage: number; breakEvenApr: number; payoutAt: (apr: number) => number };

/** Exact-in YT quote: largest YT whose flash-swap cost fits `musdIn` (bisection, like TenorRouter.quoteYieldForMusd). */
export function quoteBet(m: Market, musdIn: number): BetQuote | null {
  if (musdIn <= 0 || matured(m)) return null;
  const cost = (n: number) => n - getAmountOut(m.reserves, n, "pt");
  let lo = 0;
  let hi = m.reserves.pt * 0.5;
  if (cost(hi) <= musdIn) lo = hi;
  else
    for (let i = 0; i < 80; i++) {
      const mid = (lo + hi) / 2;
      if (cost(mid) <= musdIn) lo = mid;
      else hi = mid;
    }
  const ytOut = lo;
  if (ytOut <= 0 || cost(ytOut) > musdIn * 1.0001 || ytOut > m.reserves.pt * 0.25) return null;
  const years = secondsLeft(m) / YEAR;
  const payoutAt = (apr: number) => ytOut * apr * years * (1 - FEE);
  const breakEvenApr = musdIn / (ytOut * years * (1 - FEE));
  return { musdIn, ytOut, leverage: ytOut / musdIn, breakEvenApr, payoutAt };
}

// Actions (pure: return a new market)

let nextId = 1;
const log = (m: Market, kind: Activity["kind"], text: string): Activity[] => [{ id: nextId++, at: m.now, kind, text }, ...m.log].slice(0, 30);

export function lockFixed(m: Market, musdIn: number): Market {
  const q = quoteFixed(m, musdIn);
  if (!q || musdIn > m.user.musd) return m;
  return {
    ...m,
    reserves: { pt: m.reserves.pt - q.ptOut, musd: m.reserves.musd + musdIn },
    user: { ...m.user, musd: m.user.musd - musdIn, pt: m.user.pt + q.ptOut, costBasis: m.user.costBasis + musdIn },
    log: log(m, "fixed", `Locked ${fmt(q.apr * 100, 2)}% on ${fmt(musdIn)} MUSD`),
  };
}

export function buyBet(m: Market, musdIn: number): Market {
  const q = quoteBet(m, musdIn);
  if (!q || musdIn > m.user.musd) return m;
  const borrowed = getAmountOut(m.reserves, q.ytOut, "pt");
  return {
    ...m,
    reserves: { pt: m.reserves.pt + q.ytOut, musd: m.reserves.musd - borrowed },
    ytSupply: m.ytSupply + q.ytOut,
    user: { ...m.user, musd: m.user.musd - (q.ytOut - borrowed), yt: m.user.yt + q.ytOut },
    log: log(m, "bet", `Bought ${fmt(q.ytOut)} YT for ${fmt(q.ytOut - borrowed, 2)} MUSD`),
  };
}

export function claim(m: Market): Market {
  if (m.user.claimable <= 0) return m;
  const amount = m.user.claimable;
  return {
    ...m,
    user: { ...m.user, musd: m.user.musd + amount, claimable: 0, claimed: m.user.claimed + amount },
    log: log(m, "claim", `Claimed ${fmt(amount, 2)} MUSD of yield`),
  };
}

export function redeem(m: Market): Market {
  if (!matured(m) || m.user.pt <= 0) return m;
  const amount = m.user.pt + m.user.claimable;
  return {
    ...m,
    user: { ...m.user, musd: m.user.musd + amount, pt: 0, claimable: 0, claimed: m.user.claimed + m.user.claimable },
    log: log(m, "redeem", `Redeemed ${fmt(m.user.pt)} PT for ${fmt(m.user.pt)} MUSD`),
  };
}

/** Let time pass: sMUSD pays `smusdApr` to YT holders, and an arbitrageur moves the pool to `marketApr`. */
export function advance(m: Market, seconds: number): Market {
  const until = Math.min(m.now + seconds, m.maturity);
  const dt = until - m.now;
  if (dt <= 0) return { ...m, now: m.now + seconds };
  const ytShare = m.ytSupply > 0 ? m.user.yt / m.ytSupply : 0;
  const yieldToYt = m.ytSupply * m.smusdApr * (dt / YEAR) * (1 - FEE);
  const now = m.now + seconds;
  const next: Market = {
    ...m,
    now,
    user: { ...m.user, claimable: m.user.claimable + yieldToYt * ytShare },
    log: log({ ...m, now }, "time", `${Math.round(seconds / DAY)} days at ${fmt(m.smusdApr * 100, 2)}% sMUSD`),
  };
  return matured(next) ? next : arbToTarget(next);
}

/** A protocol revenue event: sMUSD's rate jumps, and the market reprices. */
export function setRates(m: Market, smusdApr: number, marketApr = smusdApr): Market {
  return arbToTarget({
    ...m,
    smusdApr,
    marketApr,
    log: log(m, "yield", `sMUSD rate now ${fmt(smusdApr * 100, 2)}%`),
  });
}

function arbToTarget(m: Market): Market {
  const target = priceForApr(m.marketApr, secondsLeft(m));
  // Swap along the curve until the spot price matches the target (bisection on PT reserve).
  const k = m.reserves.pt ** 3 * m.reserves.musd + m.reserves.pt * m.reserves.musd ** 3;
  const musdFor = (pt: number) => {
    let lo = 0;
    let hi = k; // solve x^3 y + x y^3 = k for y
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2;
      if (pt ** 3 * mid + pt * mid ** 3 < k) lo = mid;
      else hi = mid;
    }
    return lo;
  };
  let lo = m.reserves.pt * 0.5;
  let hi = m.reserves.pt * 2;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    const p = spotPrice({ pt: mid, musd: musdFor(mid) });
    if (p > target) lo = mid; // more PT lowers its price
    else hi = mid;
  }
  const pt = (lo + hi) / 2;
  return { ...m, reserves: { pt, musd: musdFor(pt) } };
}

export function fmt(n: number, digits = 0): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
