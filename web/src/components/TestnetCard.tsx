import { useEffect, useState } from "react";
import { CopyButton } from "@/components/interior/copy-button";
import { SkeletonSwap } from "@/components/interior/skeleton-swap";
import { DEPLOYMENT, EXPLORER, readTestnet, type LiveMarket } from "@/lib/testnet";
import { fmt } from "@/lib/sim";
import { ExternalLink } from "lucide-react";

/** Live, read-only state of the deployed testnet markets. Hidden until deployments/31611.json exists. */
export function TestnetCard() {
  const [markets, setMarkets] = useState<LiveMarket[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!DEPLOYMENT) return;
    const ctrl = new AbortController();
    const load = () =>
      readTestnet(ctrl.signal)
        .then((m) => (setMarkets(m), setFailed(false)))
        .catch(() => !ctrl.signal.aborted && setFailed(true));
    load();
    const t = setInterval(load, 30_000);
    return () => (ctrl.abort(), clearInterval(t));
  }, []);

  if (!DEPLOYMENT) return null;

  return (
    <section className="card flex flex-col gap-4" aria-label="Live on Mezo testnet">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold">Live on Mezo testnet</h2>
        <span className="flex shrink-0 items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400">
          <span aria-hidden className="size-1.5 rounded-full bg-current" />
          {failed ? "RPC unreachable" : "Reading chain"}
        </span>
      </div>
      <SkeletonSwap ready={markets !== null || failed} lines={3} reserve={markets && markets.length > 1 ? 168 : 96} label="Reading testnet markets">
        <ul className="flex flex-col gap-2">
          {(markets ?? []).map((m) => (
            <li key={m.label} className="flex items-center justify-between gap-3 rounded-xl border border-stone-200 px-3 py-2.5 dark:border-white/10">
              <div className="min-w-0">
                <p className="text-sm font-medium">Matures {m.label}</p>
                <p className="truncate text-xs text-stone-500 tabular-nums dark:text-stone-400">
                  Pool {fmt(m.ptReserve, 0)} PT / {fmt(m.musdReserve, 0)} MUSD · {fmt(m.ptSupply, 0)} PT minted
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm font-semibold tabular-nums">{m.impliedApr > 0 ? `${fmt(m.impliedApr * 100, 2)}%` : "Matured"}</p>
                <a className="inline-flex items-center gap-1 text-xs text-stone-500 underline dark:text-stone-400" href={`${EXPLORER}/address/${m.entry.market}`} target="_blank" rel="noreferrer">
                  market <ExternalLink size={11} />
                </a>
              </div>
            </li>
          ))}
        </ul>
      </SkeletonSwap>
      <div className="flex items-center justify-between gap-3 text-xs">
        <code className="min-w-0 truncate text-stone-500 dark:text-stone-400">Router {DEPLOYMENT.router}</code>
        <CopyButton value={DEPLOYMENT.router} label="Copy" className="shrink-0" />
      </div>
    </section>
  );
}
