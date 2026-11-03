import { forwardRef } from "react";
import { ExternalLink } from "lucide-react";
import { Stamp } from "@/components/receipt/Stamp";
import { KIND_TITLE, headline, shortDate, type Receipt } from "@/lib/receipt";

export type ReceiptTheme = "paper" | "night";

const THEMES: Record<ReceiptTheme, { stage: string; ticket: string; ink: string; muted: string; rule: string }> = {
  paper: { stage: "#1c1917", ticket: "#fafaf9", ink: "#1c1917", muted: "#78716c", rule: "#d6d3d1" },
  night: { stage: "#e7e5e4", ticket: "#1c1917", ink: "#fafaf9", muted: "#a8a29e", rule: "#44403c" },
};

const fmt = (n: number, d = 2) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const short = (h: string) => `${h.slice(0, 6)}…${h.slice(-4)}`;
const time = (s: number) =>
  new Date(s * 1000).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" }) + " UTC";

function rows(r: Receipt): [string, string][] {
  const out: [string, string][] = [];
  if (r.kind === "fixed") {
    out.push(["Paid", `${fmt(r.paid ?? 0)} MUSD`], ["Received", `${fmt(r.received ?? 0, 4)} PT`], ["Fixed rate", `${fmt((r.rate ?? 0) * 100)}% APR`], ["At maturity", `${fmt(r.payout ?? r.received ?? 0, 4)} MUSD`]);
  } else if (r.kind === "bet") {
    out.push(["Paid", `${fmt(r.paid ?? 0, 4)} MUSD`], ["Received", `${fmt(r.received ?? 0, 2)} YT`], ["Break-even", `${fmt((r.rate ?? 0) * 100)}% sMUSD`], ["Exposure", `${fmt((r.received ?? 0) / Math.max(r.paid ?? 1, 1e-9), 0)}x your MUSD`]);
  } else if (r.kind === "claim") {
    out.push(["Received", `${fmt(r.received ?? 0, 6)} MUSD`]);
  } else {
    out.push(["Redeemed", `${fmt(r.paid ?? 0, 4)} PT`], ["Received", `${fmt(r.received ?? 0, 4)} MUSD`]);
  }
  out.push(["Matures", shortDate(r.maturity)], ["Network", r.network === "demo" ? "Demo market" : r.network === "local" ? "Local rehearsal" : "Mezo testnet"]);
  if (r.tx) out.push(["Transaction", short(r.tx)]);
  if (r.block) out.push(["Block", `#${r.block.toLocaleString("en-US")}`]);
  if (r.feeBtc !== undefined) out.push(["Network fee", `${r.feeBtc.toFixed(10).replace(/0+$/, "").replace(/\.$/, "")} BTC`]);
  return out;
}

type Props = { receipt: Receipt; theme: ReceiptTheme; thunk?: boolean };

/** The ticket. Rendered on its own stage so the notches show the stage color, and so the PNG export is self-contained. */
export const ReceiptCard = forwardRef<HTMLDivElement, Props>(function ReceiptCard({ receipt: r, theme, thunk }, ref) {
  const t = THEMES[theme];
  const explorer = r.tx && r.network === "testnet" ? `https://explorer.test.mezo.org/tx/${r.tx}` : null;

  const Perforation = () => (
    <div className="relative h-5" aria-hidden>
      <span className="absolute top-1/2 -left-2.5 size-5 -translate-y-1/2 rounded-full" style={{ background: t.stage }} />
      <span className="absolute top-1/2 -right-2.5 size-5 -translate-y-1/2 rounded-full" style={{ background: t.stage }} />
      <span className="absolute top-1/2 right-4 left-4 border-t-2 border-dashed" style={{ borderColor: t.rule }} />
    </div>
  );

  return (
    <div ref={ref} className="rounded-2xl px-4 py-5 sm:px-8 sm:py-7" style={{ background: t.stage }}>
      <article
        className="relative mx-auto w-full max-w-[380px] overflow-hidden rounded-2xl"
        style={{ background: t.ticket, color: t.ink, boxShadow: "0 18px 40px -18px rgb(0 0 0 / 0.55)" }}
        aria-label={`${KIND_TITLE[r.kind]} receipt`}
      >
        <header className="px-6 pt-6 pb-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span aria-hidden className="grid size-7 place-items-center rounded-md text-xs font-bold" style={{ background: t.ink, color: "#f59e0b" }}>
                T
              </span>
              <span className="text-[15px] font-semibold tracking-tight">Tenor</span>
            </div>
            <span className="text-[11px] font-medium tracking-wide uppercase" style={{ color: t.muted }}>
              {KIND_TITLE[r.kind]}
            </span>
          </div>
          <p className="mt-5 text-[17px] leading-snug font-semibold text-pretty">{headline(r)}</p>
          <p className="mt-1 text-xs tabular-nums" style={{ color: t.muted }}>
            {shortDate(r.at)} · {time(r.at)}
          </p>
        </header>

        <Perforation />

        <div className="px-6 py-4">
          <dl className="flex flex-col gap-2.5 text-[13px]">
            {rows(r).map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-4">
                <dt style={{ color: t.muted }}>{k}</dt>
                <dd className="min-w-0 truncate text-right font-medium tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
        </div>

        <Perforation />

        <footer className="relative flex min-h-[104px] flex-col justify-end gap-1.5 py-2 pr-28 pb-6 pl-6 text-xs sm:pr-36" style={{ color: t.muted }}>
          <div className="pointer-events-none absolute -top-5 right-1 origin-top-right scale-[0.8] sm:scale-100">
            <Stamp receipt={r} size={112} rotate={-11} thunk={thunk} surface={theme === "paper" ? "light" : "dark"} />
          </div>
          {r.network === "demo" ? (
            <p>Simulated in the demo market with Tenor's contract math. No transaction was sent.</p>
          ) : explorer ? (
            <a href={explorer} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline" style={{ color: t.ink }}>
              Verify on explorer <ExternalLink size={11} aria-hidden />
            </a>
          ) : null}
          <p>
            <span className="whitespace-nowrap">harrymove-ctrl</span>
            <wbr />
            .github.io/tenor
          </p>
        </footer>
      </article>
    </div>
  );
});
