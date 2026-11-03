import { useEffect, useState } from "react";
import { TooltipGroup } from "@/components/interior/tooltip-group";
import { TradeCard, type Mode } from "@/components/TradeCard";
import { PositionCard } from "@/components/PositionCard";
import { RateStrip } from "@/components/RateStrip";
import { DemoControls } from "@/components/DemoControls";
import { HowItWorks } from "@/components/HowItWorks";
import { LivePanel } from "@/components/LivePanel";
import { advance, buyBet, claim, initialMarket, lockFixed, redeem, setRates, type Market } from "@/lib/sim";
import { fetchRates, SNAPSHOT, type Rates } from "@/lib/rates";

// ?layout=split shows the two trade cards side by side (variant B).
const layout = new URLSearchParams(window.location.search).get("layout") === "split" ? "split" : "single";

export default function App() {
  const [rates, setRatesState] = useState<Rates | null>(null);
  const [market, setMarket] = useState<Market>(() => initialMarket(SNAPSHOT.windows[1].apr));
  const [mode, setMode] = useState<Mode>("fixed");

  useEffect(() => {
    const ctrl = new AbortController();
    fetchRates(ctrl.signal).then(setRatesState);
    return () => ctrl.abort();
  }, []);

  const execute = (m: Mode, amount: number) => setMarket((s) => (m === "fixed" ? lockFixed(s, amount) : buyBet(s, amount)));
  const reset = () => setMarket(initialMarket(rates?.windows.find((w) => w.days === 30)?.apr ?? SNAPSHOT.windows[1].apr));

  return (
    <TooltipGroup>
      <div className="mx-auto flex max-w-5xl flex-col gap-5 px-4 py-5 md:py-8">
        <header className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-lg bg-stone-900 text-sm font-bold text-amber-400 dark:bg-stone-100 dark:text-amber-600">
              T
            </span>
            <div className="min-w-0">
              <p className="text-[15px] font-semibold leading-tight">Tenor</p>
              <p className="truncate text-xs text-stone-500 dark:text-stone-400">Fixed-rate MUSD on Mezo</p>
            </div>
          </div>
          <span className="shrink-0 rounded-full border border-amber-300/70 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-300">
            Demo<span className="hidden sm:inline"> · simulated market</span>
          </span>
        </header>

        <div className="max-w-3xl">
          <h1 className="text-balance text-2xl font-semibold tracking-tight md:text-3xl">Know what your MUSD earns.</h1>
          <p className="mt-1.5 text-pretty text-sm text-stone-600 md:text-[15px] dark:text-stone-300">
            sMUSD has paid anywhere from 0% to 3% this quarter. Lock a fixed rate, or trade the variable one.
          </p>
        </div>

        <RateStrip market={market} rates={rates} />

        <main className="grid grid-cols-1 gap-6 md:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-6">
            {layout === "split" ? (
              <div className="grid gap-6 lg:grid-cols-2">
                <TradeCard market={market} mode="fixed" showToggle={false} onExecute={execute} />
                <TradeCard market={market} mode="bet" showToggle={false} onExecute={execute} />
              </div>
            ) : (
              <TradeCard market={market} mode={mode} onModeChange={setMode} onExecute={execute} />
            )}
            <HowItWorks />
          </div>
          <div className="flex min-w-0 flex-col gap-6">
            <PositionCard market={market} onClaim={() => setMarket(claim)} onRedeem={() => setMarket(redeem)} />
            <LivePanel />
            <DemoControls
              market={market}
              onAdvance={(s) => setMarket((m) => advance(m, s))}
              onRate={(apr) => setMarket((m) => setRates(m, apr))}
              onReset={reset}
            />
          </div>
        </main>

        <footer className="flex flex-col gap-1 border-t border-stone-200 pt-4 text-xs text-stone-500 dark:border-white/10 dark:text-stone-400">
          <p>Built on Mezo: sMUSD savings and Tigris pools. The market here is simulated with Tenor's contract math.</p>
          <p>
            sMUSD rates are {rates?.source === "live" ? "read live from Mezo mainnet" : `a mainnet snapshot from ${SNAPSHOT.asOf}`}.
            {" "}
            <a className="underline" href={`${import.meta.env.BASE_URL}tenor-deck.pdf`}>Deck (PDF)</a> · Layout: <a className="underline" href="?">single</a> · <a className="underline" href="?layout=split">split</a>
          </p>
        </footer>
      </div>
    </TooltipGroup>
  );
}
