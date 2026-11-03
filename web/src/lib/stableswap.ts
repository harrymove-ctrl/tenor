// Float port of the Tigris (Solidly) stable pool math in
// mezo-org/tigris solidity/contracts/Pool.sol: k = x^3*y + x*y^3, fee taken
// from the input, output found by Newton's method. Good to well under a
// basis point for display; the contracts remain the source of truth.

export const STABLE_FEE = 0.0005; // PoolFactory default stableFee = 5 (0.05%)

const f = (x0: number, y: number) => x0 * y * y * y + x0 * x0 * x0 * y;
const d = (x0: number, y: number) => 3 * x0 * y * y + x0 * x0 * x0;

function getY(x0: number, xy: number, y: number): number {
  for (let i = 0; i < 255; i++) {
    const k = f(x0, y);
    const step = Math.abs(xy - k) / d(x0, y);
    if (k < xy) y += step;
    else y -= step;
    if (step <= y * 1e-14) break;
  }
  return y;
}

export type Reserves = { pt: number; musd: number };

/** Amount of the other token received for `amountIn` of `tokenIn`. */
export function getAmountOut(reserves: Reserves, amountIn: number, tokenIn: "pt" | "musd"): number {
  if (amountIn <= 0) return 0;
  const net = amountIn * (1 - STABLE_FEE);
  const rIn = tokenIn === "pt" ? reserves.pt : reserves.musd;
  const rOut = tokenIn === "pt" ? reserves.musd : reserves.pt;
  const xy = f(reserves.pt, reserves.musd) + 0; // symmetric invariant
  const out = rOut - getY(net + rIn, xy, rOut);
  return Math.max(0, out);
}

/** Marginal MUSD price of one PT, before fees. */
export function spotPrice(reserves: Reserves): number {
  const { pt: x, musd: y } = reserves;
  // dk/dx / dk/dy for k = x^3 y + x y^3
  return (3 * x * x * y + y * y * y) / (x * x * x + 3 * x * y * y);
}

/** Fixed APR implied by a PT price with `secondsLeft` to maturity. */
export function impliedApr(ptPrice: number, secondsLeft: number): number {
  if (secondsLeft <= 0 || ptPrice <= 0) return 0;
  return (1 / ptPrice - 1) * ((365 * 86400) / secondsLeft);
}

/** PT price that makes the implied APR equal `apr`. */
export function priceForApr(apr: number, secondsLeft: number): number {
  return 1 / (1 + apr * (secondsLeft / (365 * 86400)));
}
