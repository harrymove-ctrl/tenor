// Deploys Tenor to Mezo testnet: factory, router, one market per maturity in
// MATURITIES, and a Tigris stable PT/MUSD pool for each. Idempotent: steps
// already in deployments/31611.json are skipped.
//
// npm run deploy             deploy for real
// npm run deploy -- --dry    simulate every step with eth_call, send nothing
import { encodeDeployData, decodeEventLog, getAddress } from "viem";
import { LOCAL, MEZO, MATURITIES, account, artifact, deploy, pub, readDeployments, record, requireFunds, write, writeDeployments, poolFactoryAbi } from "./lib.mjs";

const dry = process.argv.includes("--dry");
const FEE_BPS = 500n;

async function dryRun() {
  console.log(`Dry run from ${account.address} against chain ${await pub.getChainId()}`);
  for (const name of ["TenorFactory", "TenorRouter"]) {
    const { abi, bytecode } = artifact(name);
    const args = name === "TenorFactory" ? [MEZO.smusd, account.address, FEE_BPS] : [];
    const data = encodeDeployData({ abi, bytecode, args });
    const code = await pub.call({ account: account.address, data });
    const gas = await pub.estimateGas({ account: account.address, data });
    console.log(`  ok  ${name} creation simulates (${(code.data.length - 2) / 2} bytes runtime, ~${gas} gas)`);
  }
  console.log("  note: createMarket and createPool need the factory on chain; they run in the real deploy.");
}

async function main() {
  if (dry) return dryRun();
  await requireFunds(10n ** 14n); // 0.0001 BTC covers deployment gas many times over
  const d = readDeployments();
  d.deployer = account.address;

  if (!d.factory) {
    const r = await deploy("TenorFactory", "TenorFactory", [MEZO.smusd, account.address, FEE_BPS]);
    d.factory = r.contractAddress;
    d.deployBlock = Number(r.blockNumber);
    record(d, "deploy TenorFactory", r.transactionHash, { address: d.factory });
  }
  if (!d.router) {
    const r = await deploy("TenorRouter", "TenorRouter");
    d.router = r.contractAddress;
    record(d, "deploy TenorRouter", r.transactionHash, { address: d.router });
  }

  const { abi: factoryAbi } = artifact("TenorFactory");
  const { abi: marketAbi } = artifact("TenorMarket");
  d.markets ??= {};
  for (const m of MATURITIES) {
    let entry = d.markets[m.label];
    if (!entry?.market) {
      const r = await write(`createMarket ${m.label}`, d.factory, factoryAbi, "createMarket", [BigInt(m.maturity), m.label]);
      const log = r.logs
        .map((l) => {
          try {
            return decodeEventLog({ abi: factoryAbi, data: l.data, topics: l.topics });
          } catch {
            return null;
          }
        })
        .find((e) => e?.eventName === "MarketCreated");
      entry = { maturity: m.maturity, market: log.args.market, pt: log.args.pt, yt: log.args.yt };
      d.markets[m.label] = entry;
      record(d, `createMarket ${m.label}`, r.transactionHash, { market: entry.market });
    }
    if (!entry.pool) {
      let pool = await pub.readContract({ address: MEZO.poolFactory, abi: poolFactoryAbi, functionName: "getPool", args: [entry.pt, MEZO.musd, true] });
      if (pool === "0x0000000000000000000000000000000000000000") {
        const r = await write(`createPool PT-${m.label}/MUSD`, MEZO.poolFactory, poolFactoryAbi, "createPool", [entry.pt, MEZO.musd, true]);
        pool = await pub.readContract({ address: MEZO.poolFactory, abi: poolFactoryAbi, functionName: "getPool", args: [entry.pt, MEZO.musd, true] });
        record(d, `createPool PT-${m.label}/MUSD`, r.transactionHash, { pool });
      }
      entry.pool = getAddress(pool);
      writeDeployments(d);
    }
    // Sanity: the market points at canonical sMUSD and MUSD.
    const [smusd, musd] = await Promise.all([
      pub.readContract({ address: entry.market, abi: marketAbi, functionName: "smusd" }),
      pub.readContract({ address: entry.market, abi: marketAbi, functionName: "musd" }),
    ]);
    if (getAddress(smusd) !== getAddress(MEZO.smusd) || getAddress(musd) !== getAddress(MEZO.musd)) throw new Error("market wiring mismatch");
  }

  writeDeployments(d);
  console.log(`\nDeployed (${LOCAL ? "local rehearsal" : "Mezo testnet"}).`);
  console.log(JSON.stringify({ factory: d.factory, router: d.router, markets: d.markets }, null, 2));
}

main().catch((e) => {
  console.error(e.shortMessage ?? e.message);
  process.exit(1);
});
