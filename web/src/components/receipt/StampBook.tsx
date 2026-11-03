import { Stamp, stampLabel } from "@/components/receipt/Stamp";
import type { Receipt } from "@/lib/receipt";

type Props = { receipts: Receipt[]; onOpen: (r: Receipt) => void };

// Deterministic jitter so the page looks hand-stamped but never reshuffles.
function jitter(id: string, salt: number, span: number) {
  const h = [...id].reduce((a, c) => (a * 33 + c.charCodeAt(0) + salt) % 9973, 17);
  return ((h % 1000) / 1000 - 0.5) * 2 * span;
}

export function StampBook({ receipts, onOpen }: Props) {
  const shown = receipts.slice(0, 9);
  return (
    <section className="card flex flex-col gap-3" aria-label="Your stamps">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[15px] font-semibold">Your stamps</h2>
        <span className="text-xs text-stone-500 tabular-nums dark:text-stone-400">
          {receipts.length === 0 ? "None yet" : `${receipts.length} receipt${receipts.length === 1 ? "" : "s"}`}
        </span>
      </div>
      {shown.length === 0 ? (
        <div className="grid place-items-center rounded-xl border border-dashed border-stone-300 px-4 py-8 text-center dark:border-white/15">
          <div aria-hidden className="mb-3 grid size-16 place-items-center rounded-full border-2 border-dashed border-stone-300 text-[10px] font-semibold tracking-widest text-stone-400 dark:border-white/15">
            TENOR
          </div>
          <p className="max-w-[26ch] text-sm text-stone-500 dark:text-stone-400">Every trade, claim and redemption leaves a stamp here.</p>
        </div>
      ) : (
        <ul className="grid grid-cols-3 gap-1 sm:gap-2">
          {shown.map((r) => (
            <li key={r.id} className="grid place-items-center">
              <button
                type="button"
                onClick={() => onOpen(r)}
                aria-label={`Open receipt. ${stampLabel(r)}`}
                className="rounded-xl p-1 transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-500"
                style={{ translate: `${jitter(r.id, 1, 6)}px ${jitter(r.id, 2, 6)}px` }}
              >
                <Stamp receipt={r} size={84} rotate={jitter(r.id, 3, 14)} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {receipts.length > shown.length && (
        <p className="text-xs text-stone-500 dark:text-stone-400">Showing the latest 9 of {receipts.length}.</p>
      )}
    </section>
  );
}
