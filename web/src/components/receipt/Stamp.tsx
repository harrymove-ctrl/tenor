import { useId } from "react";
import { motion, useReducedMotion } from "motion/react";
import { type Receipt, shortDate } from "@/lib/receipt";

// One ink stamp per receipt. Shape and color follow the action, so a page of
// stamps reads at a glance: circle = fixed rate, frame = rate bet,
// hexagon = yield claimed, ticket = redeemed.

// "auto" follows the page theme (stamp book); "light" and "dark" follow the
// surface the stamp is printed on (a Paper or Night receipt).
const TONE: Record<"auto" | "light" | "dark", Record<Receipt["kind"], string>> = {
  auto: {
    fixed: "text-amber-600 dark:text-amber-400",
    bet: "text-violet-600 dark:text-violet-400",
    claim: "text-emerald-600 dark:text-emerald-400",
    redeem: "text-sky-600 dark:text-sky-400",
  },
  light: { fixed: "text-amber-700", bet: "text-violet-700", claim: "text-emerald-700", redeem: "text-sky-700" },
  dark: { fixed: "text-amber-400", bet: "text-violet-400", claim: "text-emerald-400", redeem: "text-sky-400" },
};

const mono = { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" } as const;
const fmt = (n: number, d = 2) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const upperDate = (s: number) => shortDate(s).replace(",", "").toUpperCase();

export function stampLabel(r: Receipt): string {
  switch (r.kind) {
    case "fixed":
      return `Fixed rate stamp: ${fmt((r.rate ?? 0) * 100)}% locked until ${shortDate(r.maturity)}`;
    case "bet":
      return `Rate bet stamp: ${fmt(r.received ?? 0, 0)} YT, break-even ${fmt((r.rate ?? 0) * 100)}%`;
    case "claim":
      return `Yield claimed stamp: ${fmt(r.received ?? 0, 4)} MUSD`;
    case "redeem":
      return `Redeemed stamp: ${fmt(r.received ?? 0)} MUSD`;
  }
}

type Props = { receipt: Receipt; size?: number; rotate?: number; thunk?: boolean; surface?: "auto" | "light" | "dark"; className?: string };

export function Stamp({ receipt: r, size = 132, rotate = -10, thunk = false, surface = "auto", className = "" }: Props) {
  const uid = useId().replace(/:/g, "");
  const reduced = useReducedMotion();
  const seed = [...r.id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 997, 7);
  const filter = `url(#ink-${uid})`;
  const wide = r.kind === "bet" || r.kind === "redeem";
  const vb = wide ? "0 0 180 116" : "0 0 160 160";

  return (
    <motion.svg
      role="img"
      aria-label={stampLabel(r)}
      viewBox={vb}
      width={wide ? size * 1.2 : size}
      className={`${TONE[surface][r.kind]} ${className}`}
      style={{ rotate }}
      initial={thunk && !reduced ? { scale: 1.6, opacity: 0 } : false}
      animate={{ scale: 1, opacity: 0.92 }}
      transition={{ type: "spring", stiffness: 520, damping: 22, mass: 0.7, delay: thunk ? 0.18 : 0 }}
    >
      <defs>
        <filter id={`ink-${uid}`} x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="2" seed={seed} result="grain" />
          <feColorMatrix in="grain" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -4 2.85" result="speckle" />
          <feComposite in="SourceGraphic" in2="speckle" operator="in" result="inked" />
          <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed={seed + 3} result="warp" />
          <feDisplacementMap in="inked" in2="warp" scale="2.4" xChannelSelector="R" yChannelSelector="G" />
        </filter>
        <path id={`ring-${uid}`} d="M80,80 m-57,0 a57,57 0 1,1 114,0 a57,57 0 1,1 -114,0" />
      </defs>
      <g filter={filter} fill="none" stroke="currentColor" style={mono}>
        {r.kind === "fixed" && (
          <>
            <circle cx="80" cy="80" r="75" strokeWidth="3.2" />
            <circle cx="80" cy="80" r="66" strokeWidth="1.2" />
            <circle cx="80" cy="80" r="45" strokeWidth="1" strokeDasharray="2 3" />
            <text fill="currentColor" stroke="none" fontSize="10.5" letterSpacing="2.6" fontWeight="700">
              <textPath href={`#ring-${uid}`} startOffset="0">
                TENOR · FIXED RATE · TENOR · FIXED RATE ·
              </textPath>
            </text>
            <text x="80" y="78" textAnchor="middle" fill="currentColor" stroke="none" fontSize="23" fontWeight="800">
              {fmt((r.rate ?? 0) * 100)}%
            </text>
            <text x="80" y="95" textAnchor="middle" fill="currentColor" stroke="none" fontSize="8.5" letterSpacing="1.6" fontWeight="700">
              LOCKED TO
            </text>
            <text x="80" y="108" textAnchor="middle" fill="currentColor" stroke="none" fontSize="8.5" letterSpacing="1.2" fontWeight="700">
              {upperDate(r.maturity)}
            </text>
          </>
        )}
        {r.kind === "bet" && (
          <>
            <rect x="4" y="4" width="172" height="108" rx="10" strokeWidth="3" />
            <rect x="11" y="11" width="158" height="94" rx="6" strokeWidth="1.1" />
            <line x1="11" y1="33" x2="169" y2="33" strokeWidth="1.1" />
            <line x1="11" y1="83" x2="169" y2="83" strokeWidth="1.1" />
            <text x="90" y="26" textAnchor="middle" fill="currentColor" stroke="none" fontSize="10" letterSpacing="2.4" fontWeight="700">
              TENOR · RATE BET
            </text>
            <text x="90" y="66" textAnchor="middle" fill="currentColor" stroke="none" fontSize="22" fontWeight="800">
              {fmt(r.received ?? 0, 0)} YT
            </text>
            <text x="90" y="98" textAnchor="middle" fill="currentColor" stroke="none" fontSize="8.5" letterSpacing="1.4" fontWeight="700">
              BREAK-EVEN {fmt((r.rate ?? 0) * 100)}% · {r.market}
            </text>
          </>
        )}
        {r.kind === "claim" && (
          <>
            <path d="M80 6 L144 43 L144 117 L80 154 L16 117 L16 43 Z" strokeWidth="3.2" strokeLinejoin="round" />
            <path d="M80 17 L134 49 L134 111 L80 143 L26 111 L26 49 Z" strokeWidth="1.1" strokeLinejoin="round" />
            <text x="80" y="58" textAnchor="middle" fill="currentColor" stroke="none" fontSize="9" letterSpacing="2" fontWeight="700">
              YIELD CLAIMED
            </text>
            <text x="80" y="88" textAnchor="middle" fill="currentColor" stroke="none" fontSize="19" fontWeight="800">
              +{fmt(r.received ?? 0, (r.received ?? 0) < 1 ? 4 : 2)}
            </text>
            <text x="80" y="105" textAnchor="middle" fill="currentColor" stroke="none" fontSize="9" letterSpacing="2" fontWeight="700">
              MUSD · {r.market}
            </text>
          </>
        )}
        {r.kind === "redeem" && (
          <>
            <path d="M14 4 H166 A10 10 0 0 0 176 14 V102 A10 10 0 0 0 166 112 H14 A10 10 0 0 0 4 102 V14 A10 10 0 0 0 14 4 Z" strokeWidth="3" />
            <line x1="132" y1="12" x2="132" y2="104" strokeWidth="1.1" strokeDasharray="3 3" />
            <text x="68" y="36" textAnchor="middle" fill="currentColor" stroke="none" fontSize="10" letterSpacing="2.2" fontWeight="700">
              REDEEMED 1:1
            </text>
            <text x="68" y="68" textAnchor="middle" fill="currentColor" stroke="none" fontSize="18" fontWeight="800">
              {fmt(r.received ?? 0)}
            </text>
            <text x="68" y="90" textAnchor="middle" fill="currentColor" stroke="none" fontSize="8.5" letterSpacing="1.4" fontWeight="700">
              MUSD · {upperDate(r.at)}
            </text>
            <text x="154" y="62" textAnchor="middle" fill="currentColor" stroke="none" fontSize="9" letterSpacing="1.6" fontWeight="700" transform="rotate(90 154 58)">
              {r.market}
            </text>
          </>
        )}
      </g>
    </motion.svg>
  );
}
