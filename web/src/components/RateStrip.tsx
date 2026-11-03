import { ValueFlash } from "@/components/interior/value-flash";
import { Tooltip } from "@/components/interior/tooltip-group";
import { DAY, fmt, marketImpliedApr, matured, secondsLeft, type Market } from "@/lib/sim";
import type { Rates } from "@/lib/rates";

type Props = { market: Market; rates: Rates | null };

export function RateStrip({ market, rates }: Props) {
  const days = Math.ceil(secondsLeft(market) / DAY);
  const w = (d: number) => rates?.windows.find((x) => x.days === d)?.apr;
  return (
    <section aria-label="Rates" className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <Tile label="Fixed rate today" hint="What PT pays if held to maturity, from the pool price.">
        {matured(market) ? "Closed" : <ValueFlash value={marketImpliedApr(market) * 100} format={(v) => `${fmt(v, 2)}%`} label="Fixed rate" />}
      </Tile>
      <Tile label="sMUSD paid, 30 days" hint={rateHint(rates)}>
        {w(30) === undefined ? "..." : `${fmt(w(30)! * 100, 2)}%`}
      </Tile>
      <Tile label="sMUSD paid, 7 days" hint={rateHint(rates)}>
        {w(7) === undefined ? "..." : `${fmt(w(7)! * 100, 2)}%`}
      </Tile>
      <Tile label="Matures" hint="PT redeems 1:1 for MUSD from this date.">
        {matured(market) ? "Matured" : `Dec 31 · ${days}d`}
      </Tile>
    </section>
  );
}

function rateHint(rates: Rates | null) {
  if (!rates) return "Reading sMUSD on Mezo mainnet.";
  return rates.source === "live"
    ? "Live from Mezo mainnet: change in sMUSD's yield index, annualized."
    : `Mainnet snapshot from ${rates.asOf}; the live read failed.`;
}

function Tile({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="card-sm min-w-0">
      <Tooltip label={hint}>
        <button type="button" className="truncate text-left text-xs text-stone-500 underline decoration-dotted underline-offset-2 dark:text-stone-400">
          {label}
        </button>
      </Tooltip>
      <div className="mt-1 truncate text-xl font-semibold tabular-nums">{children}</div>
    </div>
  );
}
