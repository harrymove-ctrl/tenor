// Realized sMUSD yield, read live from Mezo mainnet: the change in sMUSD's
// global yieldIndex over a window is the MUSD paid per sMUSD in that window.

import { createPublicClient, http, parseAbi } from "viem";

export const SMUSD_MAINNET = "0xb4D498029af77680cD1eF828b967f010d06C51CC" as const;
const RPCS = ["https://mezo.drpc.org", "https://rpc-http.mezo.boar.network"];
const BLOCK_SECONDS = 3.597; // measured 2026-11-03 over 100k blocks
const abi = parseAbi(["function yieldIndex() view returns (uint256)", "function totalSupply() view returns (uint256)"]);

export type RateWindow = { days: number; apr: number };
export type Rates = { source: "live" | "snapshot"; asOf: string; supply: number; windows: RateWindow[] };

/** Read on 2026-11-03 at block 12,951,840 with scripts/rpc.py (see reports/smusd-split-scope.md). */
export const SNAPSHOT: Rates = {
  source: "snapshot",
  asOf: "2026-11-03",
  supply: 6_780_366,
  windows: [
    { days: 7, apr: 0.0003 },
    { days: 30, apr: 0.0206 },
    { days: 90, apr: 0.0242 },
  ],
};

export async function fetchRates(signal?: AbortSignal): Promise<Rates> {
  for (const url of RPCS) {
    try {
      const client = createPublicClient({ transport: http(url, { timeout: 8_000, fetchOptions: { signal } }) });
      const latest = await client.getBlockNumber();
      const read = (blockNumber?: bigint) =>
        client.readContract({ address: SMUSD_MAINNET, abi, functionName: "yieldIndex", blockNumber });
      const now = await read(latest);
      const supply = await client.readContract({ address: SMUSD_MAINNET, abi, functionName: "totalSupply" });
      const windows = await Promise.all(
        [7, 30, 90].map(async (days) => {
          const back = BigInt(Math.round((days * 86400) / BLOCK_SECONDS));
          const then = await read(latest - back);
          const perToken = Number(now - then) / 1e18;
          return { days, apr: (perToken / days) * 365 };
        }),
      );
      return { source: "live", asOf: new Date().toISOString().slice(0, 10), supply: Number(supply / 10n ** 18n), windows };
    } catch {
      if (signal?.aborted) break;
    }
  }
  return SNAPSHOT;
}
