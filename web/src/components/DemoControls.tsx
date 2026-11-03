import { SegmentedControl } from "@/components/interior/segmented-control";
import { DAY, fmt, matured, type Market } from "@/lib/sim";

type Props = {
  market: Market;
  onAdvance: (seconds: number) => void;
  onRate: (apr: number) => void;
  onReset: () => void;
};

const RATES = ["0", "0.02", "0.05", "0.08"];

export function DemoControls({ market, onAdvance, onRate, onReset }: Props) {
  const current = RATES.reduce((best, r) => (Math.abs(Number(r) - market.smusdApr) < Math.abs(Number(best) - market.smusdApr) ? r : best));
  return (
    <section className="card flex flex-col gap-4" aria-label="Demo controls">
      <div>
        <h2 className="text-[15px] font-semibold">Try the market</h2>
        <p className="text-sm text-stone-500 dark:text-stone-400">
          Move time and change what sMUSD pays. On testnet the same happens with real transactions.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-xs text-stone-500 dark:text-stone-400">sMUSD pays</span>
        <SegmentedControl
          label="sMUSD rate"
          value={current}
          onValueChange={(v) => onRate(Number(v))}
          options={RATES.map((r) => ({ value: r, label: `${fmt(Number(r) * 100)}%` }))}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="chip" disabled={matured(market)} onClick={() => onAdvance(7 * DAY)}>
          +1 week
        </button>
        <button type="button" className="chip" disabled={matured(market)} onClick={() => onAdvance(market.maturity - market.now)}>
          Jump to maturity
        </button>
        <button type="button" className="chip" onClick={onReset}>
          Reset
        </button>
      </div>
      {market.log.length > 0 && (
        <ol className="flex flex-col gap-1.5 border-t border-stone-200 pt-3 text-xs text-stone-500 dark:border-white/10 dark:text-stone-400">
          {market.log.slice(0, 4).map((a) => (
            <li key={a.id} className="truncate">
              {new Date(a.at * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" })} · {a.text}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
