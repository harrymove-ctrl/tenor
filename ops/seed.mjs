// Seeds each Tenor pool: swaps testnet BTC for MUSD on Tigris if needed,
// mints PT+YT, adds equal PT and MUSD (Tigris stable pools require a 1:1 first
// deposit), then sells PT in small steps until the implied fixed rate reaches
// TARGET_APR. Idempotent: a pool that already has reserves is left alone.
import { MEZO, MATURITIES, account, artifact, chainNow, ensureApproval, erc20, poolAbi, pub, readDeployments, record, requireFunds, routerAbi, write } from "./lib.mjs";

const E18 = 10n ** 18n;
const TARGET_APR = 0.03;
const PROOF_BUDGET = 80n * E18; // MUSD kept back for prove.mjs

const { abi: marketAbi } = artifact("TenorMarket");
const { abi: tenorRouterAbi } = artifact("TenorRouter");

const musdBalance = () => pub.readContract({ address: MEZO.musd, abi: erc20, functionName: "balanceOf", args: [account.address] });

async function impliedApr(entry) {
  const probe = 10n ** 16n; // 0.01 PT
  const out = await pub.readContract({ address: entry.pool, abi: poolAbi, functionName: "getAmountOut", args: [probe, entry.pt] });
  const price = Number(out) / Number(probe);
  const secondsLeft = entry.maturity - (await chainNow());
  return { price, apr: (1 / price - 1) * ((365 * 86400) / secondsLeft) };
}

async function buyMusd(needed) {
  const have = await musdBalance();
  if (have >= needed) return;
  const short = needed - have;
  const route = [{ from: MEZO.btc, to: MEZO.musd, stable: false, factory: MEZO.poolFactory }];
  const oneBtcOut = (await pub.readContract({ address: MEZO.router, abi: routerAbi, functionName: "getAmountsOut", args: [E18 / 100n, route] }))[1] * 100n;
  const btcIn = (short * E18 * 103n) / (oneBtcOut * 100n); // 3% headroom for slippage and fees
  await requireFunds(btcIn + 10n ** 15n);
  await ensureApproval(MEZO.btc, MEZO.router, btcIn);
  const minOut = (short * 99n) / 100n;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
  const r = await write(`swap ${Number(btcIn) / 1e18} BTC for MUSD`, MEZO.router, routerAbi, "swapExactTokensForTokens", [btcIn, minOut, route, account.address, deadline]);
  return r;
}

const GAS_RESERVE = 2n * 10n ** 15n; // 0.002 BTC kept for gas

async function planDepths(pending) {
  const fixed = Object.fromEntries(pending.map((m) => [m.label, BigInt(m.seed) * E18]));
  if (process.env.SEED === "fixed" || !MEZO.router) return fixed;
  const btc = await pub.getBalance({ address: account.address });
  if (btc <= GAS_RESERVE) return fixed;
  const route = [{ from: MEZO.btc, to: MEZO.musd, stable: false, factory: MEZO.poolFactory }];
  const perBtc = (await pub.readContract({ address: MEZO.router, abi: routerAbi, functionName: "getAmountsOut", args: [E18 / 100n, route] }))[1] * 100n;
  const budget = (((btc - GAS_RESERVE) * perBtc) / E18) * 95n / 100n + (await musdBalance()) - PROOF_BUDGET;
  // Each market needs about 2.3x its depth (mint PT, match MUSD, inventory to sell). Split 1:2 by maturity.
  const weights = pending.map((_, i) => BigInt(i + 1));
  const total = weights.reduce((a, b) => a + b, 0n);
  const out = {};
  pending.forEach((m, i) => {
    const depth = (budget * weights[i] * 10n) / (total * 23n);
    out[m.label] = depth > fixed[m.label] ? (depth / E18) * E18 : fixed[m.label];
  });
  console.log("seed depths (MUSD per side):", Object.fromEntries(Object.entries(out).map(([k, v]) => [k, Number(v / E18)])));
  return out;
}

async function main() {
  const d = readDeployments();
  if (!d.factory) throw new Error("Run npm run deploy first.");

  const pending = MATURITIES.filter((m) => !d.markets[m.label].seeded);
  // Pool depth decides how much YT the market can sell, so put all spare
  // capital into depth: SEED=auto (default) sizes pools from the BTC balance,
  // SEED=fixed uses the per-market amounts in MATURITIES.
  const depths = await planDepths(pending);
  const needed = pending.reduce((s, m) => s + (depths[m.label] * 23n) / 10n, 0n) + PROOF_BUDGET;
  const swap = await buyMusd(needed);
  if (swap) record(d, "swap BTC for MUSD on Tigris", swap.transactionHash);

  for (const m of pending) {
    const entry = d.markets[m.label];
    const depth = depths[m.label];
    const [r0, r1] = await pub.readContract({ address: entry.pool, abi: poolAbi, functionName: "getReserves" });
    if (r0 === 0n && r1 === 0n) {
      const mintAmount = depth + depth / 4n; // the extra quarter is PT to sell
      await ensureApproval(MEZO.musd, entry.market, mintAmount);
      const rm = await write(`mint ${m.label} PT+YT`, entry.market, marketAbi, "mint", [mintAmount, account.address]);
      record(d, `mint PT+YT ${m.label}`, rm.transactionHash, { amount: Number(mintAmount / E18) });
      const t1 = await write(`send PT to pool`, entry.pt, erc20, "transfer", [entry.pool, depth]);
      const t2 = await write(`send MUSD to pool`, MEZO.musd, erc20, "transfer", [entry.pool, depth]);
      const rl = await write(`add liquidity ${m.label}`, entry.pool, poolAbi, "mint", [account.address]);
      record(d, `seed pool ${m.label} (${depth / E18} PT + ${depth / E18} MUSD)`, rl.transactionHash, { transfers: [t1.transactionHash, t2.transactionHash] });
    }

    await ensureApproval(entry.pt, d.router, 2n ** 128n);
    const step = depth / 50n;
    for (let i = 0; i < 12; i++) {
      const { apr } = await impliedApr(entry);
      if (apr >= TARGET_APR) break;
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
      const rs = await write(`sell ${Number(step) / 1e18} PT (implied ${(apr * 100).toFixed(2)}%)`, d.router, tenorRouterAbi, "sellPrincipal", [entry.market, entry.pool, step, 0n, account.address, deadline]);
      record(d, `open discount ${m.label}`, rs.transactionHash);
    }
    const { price, apr } = await impliedApr(entry);
    entry.seeded = { at: new Date().toISOString(), ptPrice: price, impliedApr: apr };
    record(d, `seeded ${m.label}`, d.txs.at(-1).hash, { impliedApr: apr });
    console.log(`${m.label}: PT ${price.toFixed(5)} MUSD, implied ${(apr * 100).toFixed(2)}%`);
  }
}

main().catch((e) => {
  console.error(e.shortMessage ?? e.message);
  process.exit(1);
});
