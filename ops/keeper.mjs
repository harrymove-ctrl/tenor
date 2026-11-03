// Market keeper for the testnet pools. Each pass, for every live market:
// harvest sMUSD yield into the indexes, then trade PT against MUSD in small
// steps until the implied fixed rate is back inside TARGET_APR +/- BAND.
// Thin pools get skewed by single YT buys (a YT buy sells PT into the pool),
// so this plays the arbitrageur a deeper market would have.
//
// npm run keeper              one pass
// npm run keeper -- --loop    pass every 5 minutes
import { MEZO, account, artifact, chainNow, ensureApproval, erc20, poolAbi, pub, readDeployments, record, write } from "./lib.mjs";

const TARGET_APR = 0.03;
const BAND = 0.01;
const MAX_STEPS = 25;
const { abi: routerAbi } = artifact("TenorRouter");
const { abi: marketAbi } = artifact("TenorMarket");

async function implied(entry) {
  const probe = 10n ** 16n;
  const out = await pub.readContract({ address: entry.pool, abi: poolAbi, functionName: "getAmountOut", args: [probe, entry.pt] });
  const price = Number(out) / Number(probe);
  const left = entry.maturity - (await chainNow());
  return left > 0 ? (1 / price - 1) * ((365 * 86400) / left) : 0;
}

async function pass(d) {
  for (const [label, entry] of Object.entries(d.markets)) {
    if ((await chainNow()) >= entry.maturity) continue;
    const h = await write(`harvest ${label}`, entry.market, marketAbi, "harvest", []);
    record(d, `keeper: harvest ${label}`, h.transactionHash);
    const [r0, r1] = await pub.readContract({ address: entry.pool, abi: poolAbi, functionName: "getReserves" });
    const base = (r0 + r1) / 200n; // 1% of pool depth
    for (let i = 0; i < MAX_STEPS; i++) {
      const apr = await implied(entry);
      // Bigger trades far from target, 1% of depth near it.
      const scale = BigInt(Math.min(8, Math.max(1, Math.floor(Math.abs(apr - TARGET_APR) / 0.05))));
      const step = base * scale;
      if (Math.abs(apr - TARGET_APR) <= BAND) {
        console.log(`${label}: implied ${(apr * 100).toFixed(2)}%, inside band`);
        break;
      }
      const deadline = BigInt((await chainNow()) + 600);
      if (apr > TARGET_APR) {
        // PT too cheap: buy PT with MUSD.
        await ensureApproval(MEZO.musd, d.router, step);
        const r = await write(`${label} buy PT (implied ${(apr * 100).toFixed(2)}%)`, d.router, routerAbi, "buyPrincipal", [entry.market, entry.pool, step, 0n, account.address, deadline]);
        record(d, `keeper: buy PT ${label}`, r.transactionHash, { impliedBefore: apr });
      } else {
        const ptBal = await pub.readContract({ address: entry.pt, abi: erc20, functionName: "balanceOf", args: [account.address] });
        if (ptBal < step) {
          await ensureApproval(MEZO.musd, entry.market, step);
          const m = await write(`${label} mint PT+YT for inventory`, entry.market, marketAbi, "mint", [step, account.address]);
          record(d, `keeper: mint inventory ${label}`, m.transactionHash);
        }
        await ensureApproval(entry.pt, d.router, step);
        const r = await write(`${label} sell PT (implied ${(apr * 100).toFixed(2)}%)`, d.router, routerAbi, "sellPrincipal", [entry.market, entry.pool, step, 0n, account.address, deadline]);
        record(d, `keeper: sell PT ${label}`, r.transactionHash, { impliedBefore: apr });
      }
    }
  }
}

const d = readDeployments();
if (!d.factory) throw new Error("Run npm run deploy first.");
if (process.argv.includes("--loop")) {
  for (;;) {
    await pass(readDeployments()).catch((e) => console.error(e.shortMessage ?? e.message));
    await new Promise((r) => setTimeout(r, 5 * 60_000));
  }
} else {
  await pass(d);
}
