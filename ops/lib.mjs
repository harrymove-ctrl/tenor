// Shared helpers for Tenor's testnet operations. Run through `npm run <script>`
// so NODE_USE_ENV_PROXY=1 lets fetch use the sandbox proxy.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createPublicClient, createWalletClient, defineChain, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const ROOT = path.resolve(import.meta.dirname, "..");

// TENOR_NETWORK=local rehearses everything on anvil (contracts/script/LocalMezo.s.sol)
// with anvil's public dev key; the default is Mezo testnet with contracts/.env.
export const LOCAL = process.env.TENOR_NETWORK === "local";
const LOCAL_RPC = "http://127.0.0.1:8547";
const ANVIL_KEY_0 = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"; // anvil's well-known dev key
const DEPLOYMENTS = path.join(ROOT, "deployments", LOCAL ? "31611-local.json" : "31611.json");

/** Canonical Mezo testnet addresses, checked on chain 2026-11-03 (see reports/mezo-address-book.md in mezo-buildathon). */
const TESTNET = {
  musd: "0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503",
  smusd: "0x6f461c68B2c5492C0F5CCEc5a264d692aA7A8e16",
  btc: "0x7b7C000000000000000000000000000000000000",
  poolFactory: "0x4947243CC818b627A5D06d14C4eCe7398A23Ce1A",
  router: "0x9a1ff7FE3a0F69959A3fBa1F1e5ee18e1A9CD7E9",
  btcMusdPool: "0xd16A5Df82120ED8D626a1a15232bFcE2366d6AA9",
};
export const MEZO = LOCAL ? JSON.parse(readFileSync(path.join(ROOT, "deployments", "local-mezo.json"), "utf8")) : TESTNET;

export const MATURITIES = [
  { label: "12NOV26", maturity: Date.UTC(2026, 10, 12, 12) / 1000, seed: 150 },
  { label: "31DEC26", maturity: Date.UTC(2026, 11, 31, 12) / 1000, seed: 300 },
];

function loadEnv() {
  const file = path.join(ROOT, "contracts", ".env");
  if (!existsSync(file)) throw new Error("contracts/.env is missing. See contracts/.env.example.");
  const env = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

const env = LOCAL ? { DEPLOYER_PRIVATE_KEY: ANVIL_KEY_0, MEZO_TESTNET_RPC: LOCAL_RPC } : loadEnv();
export const chain = defineChain({
  id: 31611,
  name: LOCAL ? "Local Mezo (anvil)" : "Mezo Testnet",
  nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 },
  rpcUrls: { default: { http: [env.MEZO_TESTNET_RPC || "https://rpc.test.mezo.org"] } },
  blockExplorers: { default: { name: "Mezo Explorer", url: LOCAL ? "local" : "https://explorer.test.mezo.org" } },
});
export const account = privateKeyToAccount(env.DEPLOYER_PRIVATE_KEY);
export const pub = createPublicClient({ chain, transport: http(undefined, { timeout: 60_000, retryCount: 4 }) });
export const wallet = createWalletClient({ chain, account, transport: http(undefined, { timeout: 60_000, retryCount: 4 }) });

/** Chain time; local mode can move it with `warpTo`. */
export async function chainNow() {
  return Number((await pub.getBlock()).timestamp);
}
export async function warpTo(timestamp) {
  if (!LOCAL) throw new Error("warpTo is local only");
  await pub.request({ method: "evm_setNextBlockTimestamp", params: [timestamp] });
  await pub.request({ method: "evm_mine", params: [] });
}
export const explorer = (kind, value) => `${chain.blockExplorers.default.url}/${kind}/${value}`;

export function artifact(name) {
  const j = JSON.parse(readFileSync(path.join(ROOT, "contracts", "out", `${name}.sol`, `${name}.json`), "utf8"));
  return { abi: j.abi, bytecode: j.bytecode.object };
}

export const erc20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function allowance(address,address) view returns (uint256)",
  "function transfer(address,uint256) returns (bool)",
  "function totalSupply() view returns (uint256)",
]);
export const poolAbi = parseAbi([
  "function token0() view returns (address)",
  "function getReserves() view returns (uint256,uint256,uint256)",
  "function getAmountOut(uint256,address) view returns (uint256)",
  "function mint(address) returns (uint256)",
]);
export const poolFactoryAbi = parseAbi([
  "function createPool(address,address,bool) returns (address)",
  "function getPool(address,address,bool) view returns (address)",
]);
export const routerAbi = parseAbi([
  "struct Route { address from; address to; bool stable; address factory; }",
  "function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, Route[] routes, address to, uint256 deadline) returns (uint256[])",
  "function getAmountsOut(uint256 amountIn, Route[] routes) view returns (uint256[])",
]);
export const smusdAbi = parseAbi([
  "function receiveProtocolYield(uint256)",
  "function totalSupply() view returns (uint256)",
  "function yieldIndex() view returns (uint256)",
]);

export function readDeployments() {
  return existsSync(DEPLOYMENTS) ? JSON.parse(readFileSync(DEPLOYMENTS, "utf8")) : { chainId: 31611, network: LOCAL ? "local" : "testnet", mezo: MEZO, txs: [] };
}
export function writeDeployments(d) {
  writeFileSync(DEPLOYMENTS, `${JSON.stringify(d, null, 2)}\n`);
}

/** Records a transaction in deployments/31611.json under `txs`. */
export function record(d, step, hash, extra = {}) {
  d.txs.push({ step, hash, url: explorer("tx", hash), at: new Date().toISOString(), ...extra });
  writeDeployments(d);
}

// Mezo gas estimates can come back far too low (other Wave 1 teams saw ~21k on
// contract calls), so pad by half with a floor, capped under the 10M block limit.
async function gasFor(request) {
  const est = await pub.estimateGas({ account, ...request });
  const padded = (est * 3n) / 2n;
  const floor = 150_000n;
  const cap = 9_500_000n;
  return padded < floor ? floor : padded > cap ? cap : padded;
}

export async function send(label, request) {
  const gas = await gasFor(request);
  const hash = await wallet.sendTransaction({ ...request, gas });
  const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (receipt.status !== "success") throw new Error(`${label} reverted: ${explorer("tx", hash)}`);
  console.log(`  ok  ${label}  ${explorer("tx", hash)}`);
  return receipt;
}

export async function write(label, address, abi, functionName, args, value) {
  const { request } = await pub.simulateContract({ account, address, abi, functionName, args, value });
  const data = (await import("viem")).encodeFunctionData({ abi, functionName, args });
  return send(label, { to: address, data, value: request.value });
}

export async function deploy(label, name, args = []) {
  const { abi, bytecode } = artifact(name);
  const data = (await import("viem")).encodeDeployData({ abi, bytecode, args });
  const receipt = await send(`deploy ${label}`, { data });
  return receipt;
}

export async function ensureApproval(token, spender, amount) {
  const current = await pub.readContract({ address: token, abi: erc20, functionName: "allowance", args: [account.address, spender] });
  if (current >= amount) return null;
  return write(`approve ${spender.slice(0, 8)}`, token, erc20, "approve", [spender, 2n ** 255n]);
}

export async function requireFunds(minBtc) {
  const bal = await pub.getBalance({ address: account.address });
  if (bal < minBtc) {
    console.error(
      `Deployer ${account.address} holds ${Number(bal) / 1e18} BTC; needs at least ${Number(minBtc) / 1e18}.\n` +
        "Fund it from the Mezo testnet faucet (https://faucet.test.mezo.org) and run again.",
    );
    process.exit(2);
  }
  return bal;
}
