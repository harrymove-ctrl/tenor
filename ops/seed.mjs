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

async function main() {
  const d = readDeployments();
  if (!d.factory) throw new Error("Run npm run deploy first.");

  const pending = MATURITIES.filter((m) => !d.markets[m.label].seeded);
  const needed = pending.reduce((s, m) => s + BigInt(m.seed) * E18 * 23n / 10n, 0n) + PROOF_BUDGET;
  const swap = await buyMusd(needed);
  if (swap) record(d, "swap BTC for MUSD on Tigris", swap.transactionHash);

  for (const m of pending) {
    const entry = d.markets[m.label];
    const depth = BigInt(m.seed) * E18;
    const [r0, r1] = await pub.readContract({ address: entry.pool, abi: poolAbi, functionName: "getReserves" });
    if (r0 === 0n && r1 === 0n) {
      const mintAmount = depth + depth / 4n; // the extra quarter is PT to sell
      await ensureApproval(MEZO.musd, entry.market, mintAmount);
      const rm = await write(`mint ${m.label} PT+YT`, entry.market, marketAbi, "mint", [mintAmount, account.address]);
      record(d, `mint PT+YT ${m.label}`, rm.transactionHash, { amount: Number(mintAmount / E18) });
      const t1 = await write(`send PT to pool`, entry.pt, erc20, "transfer", [entry.pool, depth]);
      const t2 = await write(`send MUSD to pool`, MEZO.musd, erc20, "transfer", [entry.pool, depth]);
      const rl = await write(`add liquidity ${m.label}`, entry.pool, poolAbi, "mint", [account.address]);
      record(d, `seed pool ${m.label} (${m.seed} PT + ${m.seed} MUSD)`, rl.transactionHash, { transfers: [t1.transactionHash, t2.transactionHash] });
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
