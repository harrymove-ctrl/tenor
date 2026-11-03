import { useCallback, useEffect, useMemo, useState } from "react";
import { formatUnits, type Hash } from "viem";
import { SegmentedControl } from "@/components/interior/segmented-control";
import { LoadingButton } from "@/components/interior/loading-button";
import { HoldToConfirm } from "@/components/interior/hold-to-confirm";
import { TaskSteps } from "@/components/interior/task-steps";
import { CopyButton } from "@/components/interior/copy-button";
import { cleanAmount } from "@/components/TradeCard";
import { fmt } from "@/lib/sim";
import {
  DEPLOYMENT,
  EXPLORER,
  NETWORK,
  buyYield,
  claim,
  connect,
  explainError,
  getTestMusd,
  hasInjectedWallet,
  lockFixed,
  quoteBet,
  quoteFixed,
  readPosition,
  redeemAll,
  type Position,
  type Session,
} from "@/lib/live";

type Mode = "fixed" | "bet";
type Run = { action: string; steps: { label: string; hash?: Hash }[]; status: "running" | "done" | "error"; message?: string };

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const txUrl = (h: Hash) => (EXPLORER ? `${EXPLORER}/tx/${h}` : null);

export function LivePanel() {
  if (!DEPLOYMENT) {
    return (
      <section className="card flex flex-col gap-2" aria-label="Live testnet">
        <h2 className="text-[15px] font-semibold">Live testnet</h2>
        <p className="text-sm text-stone-500 dark:text-stone-400">
          Tenor's contracts are not deployed on Mezo testnet yet. The demo market above uses the same math.
        </p>
      </section>
    );
  }
  return <Connected />;
}

function Connected() {
  const keys = Object.keys(DEPLOYMENT!.markets);
  const [marketKey, setMarketKey] = useState(keys[keys.length - 1]);
  const market = DEPLOYMENT!.markets[marketKey];
  const [session, setSession] = useState<Session | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [pos, setPos] = useState<Position | null>(null);
  const [mode, setMode] = useState<Mode>("fixed");
  const [raw, setRaw] = useState("");
  const [quote, setQuote] = useState<{ text: string; ok: boolean } | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const busy = run?.status === "running";

  const refresh = useCallback(async () => {
    if (!session) return;
    try {
      setPos(await readPosition(market, session.address));
    } catch (e) {
      setConnectError(explainError(e));
    }
  }, [session, market]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 15_000);
    return () => clearInterval(t);
  }, [refresh]);

  const matured = useMemo(() => market.maturity * 1000 <= Date.now() || !!pos?.settled, [market, pos]);

  // Live quote, debounced.
  useEffect(() => {
    setQuote(null);
    if (!raw || Number(raw) <= 0 || matured) return;
    const t = setTimeout(async () => {
      try {
        if (mode === "fixed") {
          const q = await quoteFixed(market, raw);
          if (!q) return;
          const pt = Number(formatUnits(q.ptOut, 18));
          const days = (market.maturity * 1000 - Date.now()) / 86_400_000;
          const apr = (pt / Number(raw) - 1) * (365 / days);
          setQuote({ ok: pt > Number(raw), text: `${fmt(pt, 4)} MUSD at maturity · ${fmt(apr * 100, 2)}% fixed` });
        } else {
          const q = await quoteBet(market, raw);
          if (!q) return setQuote({ ok: false, text: "Too small for the pool right now." });
          setQuote({ ok: true, text: `${fmt(Number(formatUnits(q.ytOut, 18)), 2)} YT for ${fmt(Number(formatUnits(q.cost, 18)), 4)} MUSD` });
        }
      } catch (e) {
        setQuote({ ok: false, text: explainError(e) });
      }
    }, 300);
    return () => clearTimeout(t);
  }, [raw, mode, market, matured]);

  async function perform(action: string, fn: (onStep: (label: string, hash: Hash) => void) => Promise<unknown>) {
    setRun({ action, steps: [], status: "running" });
    try {
      await fn((label, hash) => setRun((r) => (r ? { ...r, steps: [...r.steps, { label, hash }] } : r)));
      setRun((r) => (r ? { ...r, status: "done" } : r));
      setRaw("");
      await refresh();
    } catch (e) {
      setRun((r) => (r ? { ...r, status: "error", message: explainError(e) } : r));
      throw e;
    }
  }

  async function trade() {
    if (mode === "fixed") {
      const q = await quoteFixed(market, raw);
      if (!q) throw new Error("No quote");
      await perform("Lock fixed rate", (s) => lockFixed(session!, market, q.amount, (q.ptOut * 995n) / 1000n, s));
    } else {
      const q = await quoteBet(market, raw);
      if (!q) throw new Error("No quote");
      await perform("Buy YT", (s) => buyYield(session!, market, q.ytOut, q.amount, s));
    }
  }

  const amount = Number(raw) || 0;
  const reason = !pos ? null : amount > pos.musd ? `You have ${fmt(pos.musd, 2)} MUSD.` : pos.btc < 0.00001 ? "You need a little testnet BTC for gas." : null;
  const canTrade = !!session && !busy && amount > 0 && !reason && !!quote?.ok && !matured;

  return (
    <section className="card flex flex-col gap-4" aria-label="Live testnet">
      <header className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold">{NETWORK === "local" ? "Live (local rehearsal chain)" : "Live on Mezo testnet"}</h2>
          <p className="truncate text-xs text-stone-500 dark:text-stone-400">Real transactions against Tenor's deployed contracts.</p>
        </div>
        {session ? (
          <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-stone-200 px-2.5 py-1 text-xs tabular-nums dark:border-white/10">
            <span aria-hidden className="size-1.5 rounded-full bg-emerald-500" />
            {short(session.address)}
          </span>
        ) : (
          <LoadingButton
            variant="primary"
            className="shrink-0"
            disabled={!hasInjectedWallet()}
            onAction={async () => {
              setConnectError(null);
              try {
                setSession(await connect());
              } catch (e) {
                setConnectError(explainError(e));
                throw e;
              }
            }}
            pendingLabel="Connecting"
            successLabel="Connected"
            errorLabel="Not connected"
          >
            {NETWORK === "local" ? "Use test wallet" : "Connect wallet"}
          </LoadingButton>
        )}
      </header>

      {!hasInjectedWallet() && (
        <p role="status" className="text-sm text-stone-500 dark:text-stone-400">
          No browser wallet found. Install MetaMask (or any EVM wallet) to trade on Mezo testnet.
        </p>
      )}
      {connectError && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {connectError}
        </p>
      )}

      <SegmentedControl
        label="Maturity"
        value={marketKey}
        onValueChange={(k) => (setMarketKey(k), setRun(null))}
        options={keys.map((k) => ({ value: k, label: k }))}
      />

      {session && pos && (
        <>
          <dl className="grid grid-cols-3 gap-2 text-center">
            {[
              ["Fixed rate", matured ? "Matured" : `${fmt(pos.impliedApr * 100, 2)}%`],
              ["MUSD", fmt(pos.musd, 2)],
              ["BTC", fmt(pos.btc, 5)],
              ["PT", fmt(pos.pt, 2)],
              ["YT", fmt(pos.yt, 2)],
              ["Yield", fmt(pos.claimable, 6)],
            ].map(([k, v]) => (
              <div key={k} className="min-w-0 rounded-lg bg-stone-100 px-2 py-2 dark:bg-white/5">
                <dt className="text-[11px] text-stone-500 dark:text-stone-400">{k}</dt>
                <dd className="truncate text-sm font-semibold tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>

          {pos.musd < 1 && (
            <div className="summary flex items-center justify-between gap-3">
              <p className="text-sm text-stone-600 dark:text-stone-300">
                {NETWORK === "local" ? "Mint test MUSD to start." : "Swap 0.002 testnet BTC for MUSD to start."}
              </p>
              <LoadingButton className="shrink-0" disabled={busy} onAction={() => perform("Get test MUSD", (s) => getTestMusd(session, s))} pendingLabel="Working" successLabel="Done">
                Get test MUSD
              </LoadingButton>
            </div>
          )}

          {!matured ? (
            <div className="flex flex-col gap-3">
              <SegmentedControl
                label="Live trade type"
                value={mode}
                onValueChange={(v) => setMode(v as Mode)}
                options={[
                  { value: "fixed", label: "Fixed rate" },
                  { value: "bet", label: "Rate bet" },
                ]}
              />
              <div className="field" data-invalid={reason ? true : undefined}>
                <input
                  aria-label="Live amount in MUSD"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0"
                  value={raw}
                  disabled={busy}
                  onChange={(e) => setRaw(cleanAmount(e.target.value))}
                  className="min-w-0 flex-1 bg-transparent text-xl font-semibold tabular-nums outline-none placeholder:text-stone-300 dark:placeholder:text-stone-600"
                />
                <span className="shrink-0 text-sm font-medium text-stone-500 dark:text-stone-400">MUSD</span>
              </div>
              <p role={reason || (quote && !quote.ok) ? "alert" : "status"} className={`min-h-5 text-sm ${reason || (quote && !quote.ok) ? "text-red-700 dark:text-red-400" : "text-stone-600 dark:text-stone-300"}`}>
                {reason ?? quote?.text ?? (amount > 0 ? "Quoting from chain…" : "")}
              </p>
              <LoadingButton variant="primary" className="w-full justify-center" disabled={!canTrade} onAction={trade} pendingLabel="Confirm in wallet" successLabel="Done" errorLabel="Not sent">
                {mode === "fixed" ? "Lock fixed rate" : "Buy YT"}
              </LoadingButton>
            </div>
          ) : (
            pos.pt > 0 && (
              <HoldToConfirm onConfirm={() => perform("Redeem", (s) => redeemAll(session, market, s)).catch(() => {})} confirmLabel="Sent" className="w-full">
                {`Hold to redeem ${fmt(pos.pt, 2)} PT`}
              </HoldToConfirm>
            )
          )}

          {pos.claimable > 0 && (
            <LoadingButton className="w-full justify-center" disabled={busy} onAction={() => perform("Claim", (s) => claim(session, market, s))} pendingLabel="Claiming" successLabel="Claimed">
              {`Claim ${fmt(pos.claimable, 6)} MUSD`}
            </LoadingButton>
          )}
        </>
      )}

      {run && (
        <div className="flex flex-col gap-2 border-t border-stone-200 pt-3 dark:border-white/10">
          <TaskSteps
            label={`${run.action} progress`}
            steps={[...run.steps.map((s, i) => ({ id: `${i}`, label: s.label, meta: short(s.hash ?? "") })), { id: "end", label: run.status === "error" ? "Failed" : "Confirmed" }]}
            current={run.status === "running" ? Math.max(0, run.steps.length - 1) : run.steps.length + (run.status === "done" ? 1 : 0)}
            failed={run.status === "error"}
          />
          {run.message && (
            <p role="alert" className="text-sm text-red-700 dark:text-red-400">
              {run.message}
            </p>
          )}
          <ul className="flex flex-col gap-1 text-xs">
            {run.steps.map((s) =>
              s.hash ? (
                <li key={s.hash} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-stone-500 dark:text-stone-400">
                    {s.label}: {txUrl(s.hash) ? <a className="underline" href={txUrl(s.hash)!} target="_blank" rel="noreferrer">{short(s.hash)}</a> : short(s.hash)}
                  </span>
                  <CopyButton value={s.hash} label="Copy" className="shrink-0" />
                </li>
              ) : null,
            )}
          </ul>
        </div>
      )}
    </section>
  );
}
