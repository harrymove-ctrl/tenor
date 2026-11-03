// Real trading against a deployed Tenor: Mezo testnet with a browser wallet,
// or the local anvil rehearsal (?network=local) with anvil's dev account 1.

import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  formatUnits,
  http,
  parseAbi,
  parseUnits,
  type Address,
  type Hash,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

export type MarketEntry = { maturity: number; market: Address; pt: Address; yt: Address; pool: Address };
type DeploymentFile = { factory: Address; router: Address; mezo: Record<string, Address>; markets: Record<string, MarketEntry> };

const files = import.meta.glob<{ default: DeploymentFile }>("../../../deployments/31611*.json", { eager: true });
const params = new URLSearchParams(window.location.search);
export const NETWORK: "local" | "testnet" = params.get("network") === "local" ? "local" : "testnet";
export const DEPLOYMENT: DeploymentFile | null =
  Object.entries(files).find(([k]) => (NETWORK === "local" ? k.endsWith("31611-local.json") : k.endsWith("31611.json")))?.[1].default ?? null;

const RPC = NETWORK === "local" ? "http://127.0.0.1:8547" : "https://rpc.test.mezo.org";
export const EXPLORER = NETWORK === "local" ? null : "https://explorer.test.mezo.org";
export const chain = defineChain({
  id: 31611,
  name: NETWORK === "local" ? "Local Mezo" : "Mezo Testnet",
  nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
  blockExplorers: { default: { name: "Mezo Explorer", url: "https://explorer.test.mezo.org" } },
});
export const pub = createPublicClient({ chain, transport: http(RPC, { timeout: 20_000 }) });

const erc20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function mint(address,uint256)",
]);
const marketAbi = parseAbi([
  "function claimable(address) view returns (uint256)",
  "function claim(address) returns (uint256)",
  "function redeem(uint256,address) returns (uint256)",
  "function settled() view returns (bool)",
]);
const routerAbi = parseAbi([
  "function quoteBuyPrincipal(address,address,uint256) view returns (uint256)",
  "function quoteYieldForMusd(address,address,uint256) view returns (uint256)",
  "function quoteBuyYield(address,address,uint256) view returns (uint256)",
  "function buyPrincipal(address,address,uint256,uint256,address,uint256) returns (uint256)",
  "function buyYield(address,address,uint256,uint256,address,uint256) returns (uint256)",
]);
const poolAbi = parseAbi(["function getAmountOut(uint256,address) view returns (uint256)"]);
const tigrisRouterAbi = parseAbi([
  "struct Route { address from; address to; bool stable; address factory; }",
  "function swapExactTokensForTokens(uint256,uint256,Route[],address,uint256) returns (uint256[])",
  "function getAmountsOut(uint256,Route[]) view returns (uint256[])",
]);

// Wallet

export type Session = { address: Address; wallet: WalletClient; kind: "injected" | "local" };
type Eip1193 = { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };
const injected = () => (window as unknown as { ethereum?: Eip1193 }).ethereum;
export const hasInjectedWallet = () => NETWORK === "local" || !!injected();

const ANVIL_KEY_1 = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"; // anvil's well-known dev account 1

export async function connect(): Promise<Session> {
  if (NETWORK === "local") {
    const account = privateKeyToAccount(ANVIL_KEY_1);
    return { address: account.address, wallet: createWalletClient({ account, chain, transport: http(RPC) }), kind: "local" };
  }
  const eth = injected();
  if (!eth) throw new Error("No browser wallet found. Install MetaMask or another EVM wallet.");
  const [address] = (await eth.request({ method: "eth_requestAccounts" })) as Address[];
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x7b7b" }] });
  } catch {
    await eth.request({
      method: "wallet_addEthereumChain",
      params: [{ chainId: "0x7b7b", chainName: "Mezo Testnet", nativeCurrency: chain.nativeCurrency, rpcUrls: [RPC], blockExplorerUrls: [EXPLORER] }],
    });
  }
  return { address, wallet: createWalletClient({ account: address, chain, transport: custom(eth) }), kind: "injected" };
}

// Reads

export type Position = { btc: number; musd: number; pt: number; yt: number; claimable: number; settled: boolean; impliedApr: number; ptPrice: number };

export async function readPosition(m: MarketEntry, who: Address): Promise<Position> {
  const musd = DEPLOYMENT!.mezo.musd;
  const probe = 10n ** 16n;
  const [btc, mb, pt, yt, claimable, settled, out] = await Promise.all([
    pub.getBalance({ address: who }),
    pub.readContract({ address: musd, abi: erc20, functionName: "balanceOf", args: [who] }),
    pub.readContract({ address: m.pt, abi: erc20, functionName: "balanceOf", args: [who] }),
    pub.readContract({ address: m.yt, abi: erc20, functionName: "balanceOf", args: [who] }),
    pub.readContract({ address: m.market, abi: marketAbi, functionName: "claimable", args: [who] }),
    pub.readContract({ address: m.market, abi: marketAbi, functionName: "settled" }),
    pub.readContract({ address: m.pool, abi: poolAbi, functionName: "getAmountOut", args: [probe, m.pt] }),
  ]);
  const now = Number((await pub.getBlock()).timestamp);
  const ptPrice = Number(out) / Number(probe);
  const left = m.maturity - now;
  const n = (x: bigint) => Number(formatUnits(x, 18));
  return { btc: n(btc), musd: n(mb), pt: n(pt), yt: n(yt), claimable: n(claimable), settled, ptPrice, impliedApr: left > 0 ? (1 / ptPrice - 1) * ((365 * 86400) / left) : 0 };
}

export async function quoteFixed(m: MarketEntry, musdIn: string) {
  const amount = parseUnits(musdIn || "0", 18);
  if (amount === 0n) return null;
  const ptOut = await pub.readContract({ address: DEPLOYMENT!.router, abi: routerAbi, functionName: "quoteBuyPrincipal", args: [m.market, m.pool, amount] });
  return { amount, ptOut };
}

export async function quoteBet(m: MarketEntry, musdIn: string) {
  const amount = parseUnits(musdIn || "0", 18);
  if (amount === 0n) return null;
  const ytOut = await pub.readContract({ address: DEPLOYMENT!.router, abi: routerAbi, functionName: "quoteYieldForMusd", args: [m.market, m.pool, amount] });
  if (ytOut === 0n) return null;
  const cost = await pub.readContract({ address: DEPLOYMENT!.router, abi: routerAbi, functionName: "quoteBuyYield", args: [m.market, m.pool, ytOut] });
  return { amount, ytOut, cost };
}

// Writes. Each step reports its hash so the UI can show progress and links.

type Step = (label: string, hash: Hash) => void;

async function sendAndWait(s: Session, req: Parameters<WalletClient["writeContract"]>[0], onStep: Step, label: string) {
  const { request } = await pub.simulateContract({ ...req, account: s.address } as never);
  const gasEst = await pub.estimateContractGas({ ...req, account: s.address } as never);
  const gas = (gasEst * 3n) / 2n < 150_000n ? 150_000n : (gasEst * 3n) / 2n; // Mezo estimates can run low
  const hash = await s.wallet.writeContract({ ...(request as object), gas, chain, account: s.wallet.account ?? s.address } as never);
  onStep(label, hash);
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${label} reverted`);
  return hash;
}

async function approveIfNeeded(s: Session, token: Address, spender: Address, amount: bigint, onStep: Step) {
  const allowance = await pub.readContract({ address: token, abi: erc20, functionName: "allowance", args: [s.address, spender] });
  if (allowance >= amount) return;
  await sendAndWait(s, { address: token, abi: erc20, functionName: "approve", args: [spender, amount] } as never, onStep, "Approve");
}

const deadline = async () => BigInt(Number((await pub.getBlock()).timestamp) + 1200);

export async function lockFixed(s: Session, m: MarketEntry, amount: bigint, minPtOut: bigint, onStep: Step) {
  const d = DEPLOYMENT!;
  await approveIfNeeded(s, d.mezo.musd, d.router, amount, onStep);
  return sendAndWait(s, { address: d.router, abi: routerAbi, functionName: "buyPrincipal", args: [m.market, m.pool, amount, minPtOut, s.address, await deadline()] } as never, onStep, "Buy PT");
}

export async function buyYield(s: Session, m: MarketEntry, ytOut: bigint, maxMusdIn: bigint, onStep: Step) {
  const d = DEPLOYMENT!;
  await approveIfNeeded(s, d.mezo.musd, d.router, maxMusdIn, onStep);
  return sendAndWait(s, { address: d.router, abi: routerAbi, functionName: "buyYield", args: [m.market, m.pool, ytOut, maxMusdIn, s.address, await deadline()] } as never, onStep, "Buy YT");
}

export const claim = (s: Session, m: MarketEntry, onStep: Step) =>
  sendAndWait(s, { address: m.market, abi: marketAbi, functionName: "claim", args: [s.address] } as never, onStep, "Claim");

/** Redeems the caller's whole PT balance, read exactly from chain. */
export async function redeemAll(s: Session, m: MarketEntry, onStep: Step) {
  const amount = await pub.readContract({ address: m.pt, abi: erc20, functionName: "balanceOf", args: [s.address] });
  return sendAndWait(s, { address: m.market, abi: marketAbi, functionName: "redeem", args: [amount, s.address] } as never, onStep, "Redeem");
}

/** Starter MUSD: on testnet swap 0.002 BTC on Tigris; locally mint from the mock. */
export async function getTestMusd(s: Session, onStep: Step) {
  const d = DEPLOYMENT!;
  if (NETWORK === "local") {
    return sendAndWait(s, { address: d.mezo.musd, abi: erc20, functionName: "mint", args: [s.address, 1_000n * 10n ** 18n] } as never, onStep, "Mint test MUSD");
  }
  const btcIn = parseUnits("0.002", 18);
  const route = [{ from: d.mezo.btc, to: d.mezo.musd, stable: false, factory: d.mezo.poolFactory }];
  const [, out] = await pub.readContract({ address: d.mezo.router, abi: tigrisRouterAbi, functionName: "getAmountsOut", args: [btcIn, route] });
  await approveIfNeeded(s, d.mezo.btc, d.mezo.router, btcIn, onStep);
  return sendAndWait(
    s,
    { address: d.mezo.router, abi: tigrisRouterAbi, functionName: "swapExactTokensForTokens", args: [btcIn, (out * 98n) / 100n, route, s.address, await deadline()] } as never,
    onStep,
    "Swap BTC for MUSD",
  );
}

export function explainError(e: unknown): string {
  const err = e as { shortMessage?: string; message?: string; name?: string };
  if (err?.name === "UserRejectedRequestError" || /rejected|denied/i.test(err?.message ?? "")) return "You rejected the request in your wallet. Nothing was sent.";
  return err?.shortMessage ?? err?.message ?? "Something went wrong.";
}
