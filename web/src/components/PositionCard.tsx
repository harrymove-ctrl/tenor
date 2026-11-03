import { HoldToConfirm } from "@/components/interior/hold-to-confirm";
import { LoadingButton } from "@/components/interior/loading-button";
import { ValueFlash } from "@/components/interior/value-flash";
import { fmt, matured, type Market } from "@/lib/sim";

type Props = { market: Market; onClaim: () => void; onRedeem: () => void };

export function PositionCard({ market, onClaim, onRedeem }: Props) {
  const { user } = market;
  const done = matured(market);
  const empty = user.pt === 0 && user.yt === 0 && user.claimed === 0;

  return (
    <section className="card flex flex-col gap-4" aria-label="Your position">
      <h2 className="text-[15px] font-semibold">Your position</h2>
      {empty ? (
        <p className="text-sm text-stone-500 dark:text-stone-400">
          Nothing yet. Lock a fixed rate or buy YT, then come back here to claim and redeem.
        </p>
      ) : (
        <dl className="grid grid-cols-2 gap-3">
          <Stat label="PT" value={fmt(user.pt, 2)} sub={done ? "Redeemable now" : "1 MUSD each at maturity"} />
          <Stat label="YT" value={fmt(user.yt, 0)} sub={user.yt === 0 ? "None held" : done ? "Matured" : "Earning sMUSD yield"} />
          <div className="col-span-2 flex items-end justify-between gap-3 rounded-xl bg-stone-100 px-4 py-3 dark:bg-white/5">
            <div className="min-w-0">
              <dt className="text-xs text-stone-500 dark:text-stone-400">Yield to claim</dt>
              <dd className="text-xl font-semibold tabular-nums">
                <ValueFlash value={user.claimable} format={(v) => `${fmt(v, 4)} MUSD`} label="Yield to claim" />
              </dd>
            </div>
            <LoadingButton
              className="shrink-0"
              disabled={user.claimable <= 0}
              onAction={() => new Promise<void>((r) => setTimeout(() => (onClaim(), r()), 500))}
              pendingLabel="Claiming"
              successLabel="Claimed"
            >
              Claim
            </LoadingButton>
          </div>
        </dl>
      )}
      {done && user.pt > 0 && (
        <HoldToConfirm onConfirm={onRedeem} confirmLabel="Redeemed" className="w-full">
          {`Hold to redeem ${fmt(user.pt, 2)} MUSD`}
        </HoldToConfirm>
      )}
      <p className="text-xs text-stone-500 tabular-nums dark:text-stone-400">
        Wallet {fmt(user.musd, 2)} MUSD{user.claimed > 0 ? ` · claimed ${fmt(user.claimed, 4)} MUSD so far` : ""}
      </p>
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-stone-200 px-4 py-3 dark:border-white/10">
      <dt className="text-xs text-stone-500 dark:text-stone-400">{label}</dt>
      <dd className="truncate text-xl font-semibold tabular-nums">{value}</dd>
      <p className="truncate text-xs text-stone-500 dark:text-stone-400">{sub}</p>
    </div>
  );
}
