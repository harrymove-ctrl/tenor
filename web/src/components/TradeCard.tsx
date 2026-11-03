import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { SegmentedControl } from "@/components/interior/segmented-control";
import { SliderDetents } from "@/components/interior/slider-detents";
import { SkeletonSwap } from "@/components/interior/skeleton-swap";
import { LoadingButton } from "@/components/interior/loading-button";
import { TaskSteps } from "@/components/interior/task-steps";
import { Tooltip } from "@/components/interior/tooltip-group";
import { flow, SIGNING_STEPS } from "@/lib/flow";
import { fmt, matured, quoteBet, quoteFixed, type Market } from "@/lib/sim";
import { Info } from "lucide-react";

export type Mode = "fixed" | "bet";

type Props = {
  market: Market;
  mode: Mode;
  onModeChange?: (mode: Mode) => void;
  showToggle?: boolean;
  onExecute: (mode: Mode, amount: number) => void;
};

const STEP_MS = 650;

/** Digits and one decimal point, at most 18 decimals, no leading zeros. */
export function cleanAmount(input: string): string {
  const [whole = "", ...rest] = input.replace(/[^0-9.]/g, "").split(".");
  const intPart = whole.replace(/^0+(?=\d)/, "").slice(0, 15);
  return rest.length ? `${intPart || "0"}.${rest.join("").slice(0, 18)}` : intPart;
}
const failAt = new URLSearchParams(window.location.search).get("fail");

export function TradeCard({ market, mode, onModeChange, showToggle = true, onExecute }: Props) {
  const [raw, setRaw] = useState("");
  const [state, send] = useReducer(flow, { status: "idle" });
  const abort = useRef<AbortController | null>(null);
  const balance = market.user.musd;
  const amount = Number(raw) || 0;
  const closed = matured(market);

  const fixedQuote = useMemo(() => (mode === "fixed" ? quoteFixed(market, amount) : null), [market, mode, amount]);
  const betQuote = useMemo(() => (mode === "bet" ? quoteBet(market, amount) : null), [market, mode, amount]);
  const hasQuote = mode === "fixed" ? !!fixedQuote : !!betQuote;

  // Debounced "quoting" so the skeleton reflects a real fetch in live mode.
  const [quoteReady, setQuoteReady] = useState(true);
  useEffect(() => {
    setQuoteReady(false);
    const t = setTimeout(() => setQuoteReady(true), 220);
    return () => clearTimeout(t);
  }, [amount, mode]);

  useEffect(() => {
    if (closed) send({ type: "reset" }); // drop the last receipt once the market closes
  }, [closed]);

  useEffect(() => {
    let reason: string | null = null;
    if (closed) reason = null;
    else if (amount > balance) reason = `You have ${fmt(balance, 2)} MUSD.`;
    else if (amount > 0 && !hasQuote) reason = "Too large for the pool right now (over 5% price impact). Try a smaller amount.";
    send({ type: "input", reason, empty: amount <= 0 || closed });
  }, [amount, balance, hasQuote, closed]);

  async function execute() {
    send({ type: "submit" });
    const ctrl = new AbortController();
    abort.current = ctrl;
    for (let step = 0; step < SIGNING_STEPS.length; step++) {
      await new Promise((r) => setTimeout(r, STEP_MS));
      if (ctrl.signal.aborted) throw new Error("cancelled");
      if (failAt === "swap" && step === 1) {
        send({ type: "fail", message: "Swap reverted: the price moved past your limit. Nothing was spent." });
        throw new Error("reverted");
      }
      if (step < SIGNING_STEPS.length - 1) send({ type: "advance" });
    }
    onExecute(mode, amount);
    send({ type: "succeed", message: mode === "fixed" ? "Fixed rate locked." : "YT bought." });
    setRaw("");
  }

  const signing = state.status === "signing";
  const cta = closed
    ? "Market matured"
    : state.status === "idle"
      ? "Enter an amount"
      : state.status === "invalid"
        ? "Check the amount"
        : mode === "fixed"
          ? "Lock fixed rate"
          : "Buy YT";

  return (
    <section className="card flex flex-col gap-4" aria-label={mode === "fixed" ? "Lock a fixed rate" : "Bet on the rate"}>
      <header className="flex items-center justify-between gap-3">
        {showToggle ? (
          <SegmentedControl
            label="Trade type"
            value={mode}
            onValueChange={(v) => onModeChange?.(v as Mode)}
            options={[
              { value: "fixed", label: "Fixed rate" },
              { value: "bet", label: "Rate bet" },
            ]}
          />
        ) : (
          <h2 className="text-[15px] font-semibold">{mode === "fixed" ? "Lock a fixed rate" : "Bet on the rate"}</h2>
        )}
        <span className="text-xs text-stone-500 tabular-nums dark:text-stone-400">
          Balance {fmt(balance, 2)} MUSD
        </span>
      </header>

      <p className="text-sm text-stone-600 dark:text-stone-300">
        {mode === "fixed"
          ? "Each PT pays exactly 1 MUSD at maturity, whatever sMUSD pays."
          : "Each YT collects the sMUSD yield on 1 MUSD until maturity."}
      </p>

      {closed ? (
        <div className="summary flex flex-col gap-1">
          <p className="text-sm font-medium">This market has matured.</p>
          <p className="text-sm text-stone-500 dark:text-stone-400">PT now redeems 1:1 for MUSD in your position. New maturities open here.</p>
        </div>
      ) : (
      <>
      <div className="flex flex-col gap-3">
        <div className="field" data-invalid={state.status === "invalid" || undefined}>
          <input
            aria-label="Amount in MUSD"
            aria-invalid={state.status === "invalid" || undefined}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0"
            value={raw}
            disabled={signing || closed}
            onChange={(e) => setRaw(cleanAmount(e.target.value))}
            className="min-w-0 flex-1 bg-transparent text-2xl font-semibold tabular-nums outline-none placeholder:text-stone-300 dark:placeholder:text-stone-600"
          />
          <button
            type="button"
            className="chip"
            disabled={signing || closed || balance <= 0}
            onClick={() => setRaw(String(Math.floor(balance * 100) / 100))}
          >
            Max
          </button>
          <span className="shrink-0 text-sm font-medium text-stone-500 dark:text-stone-400">MUSD</span>
        </div>
        <SliderDetents
          label="Share of balance"
          value={balance > 0 ? Math.min(100, Math.round((amount / balance) * 100)) : 0}
          onValueChange={(pct) => setRaw(pct === 0 ? "" : String(Math.floor(balance * pct) / 100))}
          detents={[0, 25, 50, 75, 100]}
          format={(v) => `${v}%`}
          disabled={signing || closed || balance <= 0}
        />
        {state.status === "invalid" && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-400">
            {state.reason}
          </p>
        )}
      </div>

      {amount > 0 && hasQuote ? (
        <SkeletonSwap ready={quoteReady} lines={4} lineHeight={28} reserve={mode === "fixed" ? 176 : 248} label="Fetching quote">
          {mode === "fixed" ? <FixedSummary market={market} q={fixedQuote} /> : <BetSummary q={betQuote} />}
        </SkeletonSwap>
      ) : (
        <p className="summary text-sm text-stone-500 dark:text-stone-400">
          {mode === "fixed" ? "Enter an amount to see what you get back at maturity." : "Enter an amount to see your exposure and break-even rate."}
        </p>
      )}

      </>
      )}

      {signing || state.status === "error" ? (
        <div className="flex flex-col gap-3">
          <TaskSteps
            label="Transaction progress"
            steps={SIGNING_STEPS}
            current={state.status === "signing" ? state.step : 1}
            failed={state.status === "error"}
          />
          {state.status === "error" && (
            <div className="flex items-center justify-between gap-3">
              <p role="alert" className="text-sm text-red-700 dark:text-red-400">
                {state.message}
              </p>
              <button type="button" className="chip" onClick={() => send({ type: "reset" })}>
                Start over
              </button>
            </div>
          )}
        </div>
      ) : null}

      <div className="flex items-center gap-3">
        <LoadingButton
          variant="primary"
          className="w-full justify-center"
          disabled={state.status !== "ready" && !signing}
          onAction={execute}
          pendingLabel="Confirm in wallet"
          successLabel={mode === "fixed" ? "Locked" : "Bought"}
          errorLabel="Not sent"
          resetAfter={1400}
        >
          {cta}
        </LoadingButton>
        {signing && (
          <button
            type="button"
            className="chip shrink-0"
            onClick={() => {
              abort.current?.abort();
              send({ type: "cancel" });
            }}
          >
            Cancel
          </button>
        )}
      </div>
      {state.status === "done" && (
        <p role="status" className="-mt-2 text-sm text-emerald-700 dark:text-emerald-400">
          {state.message} See your position.
        </p>
      )}
    </section>
  );
}

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="flex min-w-0 items-center gap-1.5 text-stone-500 dark:text-stone-400">
        <span className="truncate">{label}</span>
        {hint && (
          <Tooltip label={hint}>
            <button type="button" aria-label={`About ${label}`} className="shrink-0 rounded text-stone-400 hover:text-stone-600">
              <Info size={13} />
            </button>
          </Tooltip>
        )}
      </span>
      <span className="shrink-0 font-medium tabular-nums">{value}</span>
    </div>
  );
}

function FixedSummary({ market, q }: { market: Market; q: ReturnType<typeof quoteFixed> }) {
  const date = new Date(market.maturity * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return (
    <div className="summary">
      <p className="text-sm text-stone-500 dark:text-stone-400">You receive on {date}</p>
      <p className="text-2xl font-semibold tracking-tight tabular-nums">{q ? fmt(q.payoutAtMaturity, 2) : "0.00"} MUSD</p>
      <div className="mt-3 flex flex-col gap-2">
        <Row label="Fixed rate" value={q ? `${fmt(q.apr * 100, 2)}%` : "n/a"} hint="Annualized, after the 0.05% Tigris pool fee and price impact." />
        <Row label="Gain at maturity" value={q ? `+${fmt(q.gain, 2)} MUSD` : "n/a"} />
        <Row label="Price impact" value={q ? `${fmt(q.priceImpact * 100, 3)}%` : "n/a"} />
      </div>
    </div>
  );
}

function BetSummary({ q }: { q: ReturnType<typeof quoteBet> }) {
  return (
    <div className="summary">
      <p className="text-sm text-stone-500 dark:text-stone-400">You receive</p>
      <p className="text-2xl font-semibold tracking-tight tabular-nums">{q ? fmt(q.ytOut, 0) : "0"} YT</p>
      <div className="mt-3 flex flex-col gap-2">
        <Row label="Exposure" value={q ? `${fmt(q.leverage, 0)}x your MUSD` : "n/a"} hint="Yield on this many MUSD of sMUSD, for the MUSD you pay." />
        <Row label="Break-even sMUSD rate" value={q ? `${fmt(q.breakEvenApr * 100, 2)}%` : "n/a"} hint="If sMUSD pays more than this on average until maturity, you profit. Includes the 5% Tenor fee." />
      </div>
      {q && (
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          {[0.01, 0.03, 0.06].map((apr) => {
            const pnl = q.payoutAt(apr) - q.musdIn;
            return (
              <div key={apr} className="rounded-lg bg-stone-100 px-2 py-2 dark:bg-white/5">
                <p className="text-[11px] text-stone-500 dark:text-stone-400">sMUSD at {apr * 100}%</p>
                <p className={`text-sm font-semibold tabular-nums ${pnl >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-stone-700 dark:text-stone-300"}`}>
                  {pnl >= 0 ? "+" : ""}
                  {fmt(pnl, 2)}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
