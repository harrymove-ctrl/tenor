// Read-only view of the deployed Tenor markets on Mezo testnet. Addresses come
// from deployments/31611.json (written by ops/deploy.mjs); when the file does
// not exist yet the app simply shows the simulated demo.

import { createPublicClient, http, parseAbi } from "viem";

type MarketEntry = { maturity: number; market: string; pt: string; yt: string; pool: string; seeded?: { impliedApr: number } };
export type Deployment = { factory: string; router: string; markets: Record<string, MarketEntry> };

const files = import.meta.glob<{ default: Deployment }>("../../../deployments/31611.json", { eager: true });
export const DEPLOYMENT: Deployment | null = Object.values(files)[0]?.default ?? null;
export const EXPLORER = "https://explorer.test.mezo.org";

const abi = parseAbi([
  "function getAmountOut(uint256,address) view returns (uint256)",
  "function getReserves() view returns (uint256,uint256,uint256)",
  "function token0() view returns (address)",
  "function totalSupply() view returns (uint256)",
]);

export type LiveMarket = { label: string; maturity: number; impliedApr: number; ptPrice: number; ptReserve: number; musdReserve: number; ptSupply: number; entry: MarketEntry };

export async function readTestnet(signal?: AbortSignal): Promise<LiveMarket[]> {
  if (!DEPLOYMENT) return [];
  const client = createPublicClient({ transport: http("https://rpc.test.mezo.org", { timeout: 10_000, fetchOptions: { signal } }) });
  const probe = 10n ** 16n;
  return Promise.all(
    Object.entries(DEPLOYMENT.markets).map(async ([label, entry]) => {
      const pool = entry.pool as `0x${string}`;
      const pt = entry.pt as `0x${string}`;
      const [out, reserves, token0, supply] = await Promise.all([
        client.readContract({ address: pool, abi, functionName: "getAmountOut", args: [probe, pt] }),
        client.readContract({ address: pool, abi, functionName: "getReserves" }),
        client.readContract({ address: pool, abi, functionName: "token0" }),
        client.readContract({ address: pt, abi, functionName: "totalSupply" }),
      ]);
      const ptPrice = Number(out) / Number(probe);
      const secondsLeft = entry.maturity - Date.now() / 1000;
      const ptFirst = token0.toLowerCase() === pt.toLowerCase();
      return {
        label,
        maturity: entry.maturity,
        ptPrice,
        impliedApr: secondsLeft > 0 ? (1 / ptPrice - 1) * ((365 * 86400) / secondsLeft) : 0,
        ptReserve: Number(ptFirst ? reserves[0] : reserves[1]) / 1e18,
        musdReserve: Number(ptFirst ? reserves[1] : reserves[0]) / 1e18,
        ptSupply: Number(supply) / 1e18,
        entry,
      };
    }),
  );
}
