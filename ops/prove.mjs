// Live lifecycle proof on Mezo testnet. Every step reads state before and after
// and prints PASS or FAIL; transaction links go to deployments/31611.json and
// docs/proof.md.
//
// npm run prove                 buy PT, buy YT, push sMUSD yield, claim, combine
// npm run prove -- --redeem     after 2026-11-12 12:00 UTC: redeem the matured market
import { writeFileSync } from "node:fs";
import path from "node:path";
import { MEZO, ROOT, account, artifact, ensureApproval, erc20, explorer, pub, readDeployments, record, smusdAbi, write } from "./lib.mjs";

const E18 = 10n ** 18n;
const { abi: marketAbi } = artifact("TenorMarket");
const { abi: routerAbi } = artifact("TenorRouter");
const results = [];
const bal = (token, who = account.address) => pub.readContract({ address: token, abi: erc20, functionName: "balanceOf", args: [who] });
const read = (address, functionName, args = []) => pub.readContract({ address, abi: marketAbi, functionName, args });
const deadline = () => BigInt(Math.floor(Date.now() / 1000) + 600);
const fmt = (x, digits = 4) => (Number(x) / 1e18).toFixed(digits);

function check(name, ok, detail, hash) {
  results.push({ name, ok, detail, hash });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail}`);
}

async function lifecycle(d, label) {
  const e = d.markets[label];
  await ensureApproval(MEZO.musd, d.router, 2n ** 128n);
  await ensureApproval(MEZO.musd, e.market, 2n ** 128n);

  // 1. Lock a fixed rate.
  const musdIn = 20n * E18;
  const quote = await pub.readContract({ address: d.router, abi: routerAbi, functionName: "quoteBuyPrincipal", args: [e.market, e.pool, musdIn] });
  const pt0 = await bal(e.pt);
  const r1 = await write("buyPrincipal 20 MUSD", d.router, routerAbi, "buyPrincipal", [e.market, e.pool, musdIn, (quote * 995n) / 1000n, account.address, deadline()]);
  const got = (await bal(e.pt)) - pt0;
  record(d, `prove: buy PT ${label}`, r1.transactionHash, { musdIn: 20, ptOut: Number(got) / 1e18 });
  check("buy PT below par", got > musdIn, `${fmt(musdIn, 2)} MUSD -> ${fmt(got)} PT`, r1.transactionHash);

  // 2. Bet on the rate: 3 MUSD of YT through the flash swap.
  const ytOut = await pub.readContract({ address: d.router, abi: routerAbi, functionName: "quoteYieldForMusd", args: [e.market, e.pool, 3n * E18] });
  const yt0 = await bal(e.yt);
  const musd0 = await bal(MEZO.musd);
  const r2 = await write("buyYield 3 MUSD", d.router, routerAbi, "buyYield", [e.market, e.pool, ytOut, 3n * E18, account.address, deadline()]);
  const ytGot = (await bal(e.yt)) - yt0;
  const spent = musd0 - (await bal(MEZO.musd));
  record(d, `prove: buy YT ${label}`, r2.transactionHash, { musdIn: Number(spent) / 1e18, ytOut: Number(ytGot) / 1e18 });
  check("flash-swap YT buy", ytGot === ytOut && spent <= 3n * E18, `${fmt(spent)} MUSD -> ${fmt(ytGot, 2)} YT (${(Number(ytGot) / Number(spent)).toFixed(0)}x)`, r2.transactionHash);

  // 3. Push protocol yield into sMUSD (permissionless on Mezo), then claim through Tenor.
  const push = 40n * E18;
  await ensureApproval(MEZO.musd, MEZO.smusd, push);
  const pending0 = await read(e.market, "pendingYield");
  const r3 = await write("sMUSD.receiveProtocolYield 40 MUSD", MEZO.smusd, smusdAbi, "receiveProtocolYield", [push]);
  record(d, "prove: push 40 MUSD of protocol yield into sMUSD", r3.transactionHash);
  const pending1 = await read(e.market, "pendingYield");
  check("market accrues its sMUSD share", pending1 > pending0, `pending ${fmt(pending0, 6)} -> ${fmt(pending1, 6)} MUSD`, r3.transactionHash);

  const claimable = await read(e.market, "claimable", [account.address]);
  const before = await bal(MEZO.musd);
  const r4 = await write("claim yield", e.market, marketAbi, "claim", [account.address]);
  const paid = (await bal(MEZO.musd)) - before;
  record(d, `prove: claim ${label}`, r4.transactionHash, { paid: Number(paid) / 1e18 });
  check("claim pays what claimable() showed", paid === claimable && paid > 0n, `${fmt(paid, 6)} MUSD`, r4.transactionHash);

  // 4. Combine 1 PT + 1 YT back into MUSD before maturity.
  const before2 = await bal(MEZO.musd);
  const r5 = await write("combine 1 PT + 1 YT", e.market, marketAbi, "combine", [E18, account.address]);
  const back = (await bal(MEZO.musd)) - before2;
  record(d, `prove: combine ${label}`, r5.transactionHash, { musdOut: Number(back) / 1e18 });
  check("combine returns 1 MUSD per pair", back >= E18, `${fmt(back, 6)} MUSD`, r5.transactionHash);

  // 5. Backing invariant on chain.
  const [smusdHeld, ptSupply] = await Promise.all([bal(MEZO.smusd, e.market), pub.readContract({ address: e.pt, abi: erc20, functionName: "totalSupply" })]);
  check("T1 on chain: sMUSD held == PT supply", smusdHeld === ptSupply, `${fmt(smusdHeld, 2)} == ${fmt(ptSupply, 2)}`);
}

async function redeemMatured(d, label) {
  const e = d.markets[label];
  if (Date.now() / 1000 < e.maturity) {
    console.log(`${label} matures ${new Date(e.maturity * 1000).toISOString()}; run --redeem after that.`);
    return;
  }
  const amount = await bal(e.pt);
  const before = await bal(MEZO.musd);
  const r = await write(`redeem ${fmt(amount, 2)} PT`, e.market, marketAbi, "redeem", [amount, account.address]);
  const paid = (await bal(MEZO.musd)) - before;
  record(d, `prove: redeem matured ${label}`, r.transactionHash, { pt: Number(amount) / 1e18, paid: Number(paid) / 1e18 });
  check("PT redeems at least 1:1 after maturity", paid >= amount, `${fmt(amount, 4)} PT -> ${fmt(paid, 4)} MUSD`, r.transactionHash);
  check("market settled", await read(e.market, "settled"), "settled() == true");
}

function writeProof(d) {
  const rows = d.txs.map((t) => `| ${t.at.slice(0, 16).replace("T", " ")} | ${t.step} | [${t.hash.slice(0, 10)}...](${t.url}) |`).join("\n");
  const markets = Object.entries(d.markets)
    .map(([k, m]) => `| ${k} | [${m.market}](${explorer("address", m.market)}) | [PT](${explorer("address", m.pt)}) | [YT](${explorer("address", m.yt)}) | [pool](${explorer("address", m.pool)}) |`)
    .join("\n");
  const last = results.length ? `\n## Latest proof run (${new Date().toISOString().slice(0, 16)} UTC)\n\n| Check | Result | Detail |\n|---|---|---|\n${results.map((r) => `| ${r.name} | ${r.ok ? "PASS" : "FAIL"} | ${r.detail} |`).join("\n")}\n` : "";
  const md = `# Tenor on Mezo testnet: proof\n\nGenerated by \`ops/prove.mjs\` from \`deployments/31611.json\`. Chain 31611.\n\n| Contract | Address |\n|---|---|\n| TenorFactory | [${d.factory}](${explorer("address", d.factory)}) |\n| TenorRouter | [${d.router}](${explorer("address", d.router)}) |\n\n| Market | Contract | PT | YT | Tigris pool |\n|---|---|---|---|---|\n${markets}\n${last}\n## Every transaction\n\n| When (UTC) | Step | Tx |\n|---|---|---|\n${rows}\n`;
  writeFileSync(path.join(ROOT, "docs", "proof.md"), md);
}

async function main() {
  const d = readDeployments();
  if (!d.markets?.["31DEC26"]?.seeded) throw new Error("Run npm run seed first.");
  if (process.argv.includes("--redeem")) await redeemMatured(d, "12NOV26");
  else await lifecycle(d, "31DEC26");
  writeProof(d);
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed. docs/proof.md updated.`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e.shortMessage ?? e.message);
  process.exit(1);
});
