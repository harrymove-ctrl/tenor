// Receipts for every Tenor action, plus the share-link encoding behind
// "Copy link" (?r=<base64url JSON>), which reopens the same receipt.

export type ReceiptKind = "fixed" | "bet" | "claim" | "redeem";

export type Receipt = {
  v: 1;
  id: string;
  kind: ReceiptKind;
  at: number; // unix seconds (chain time in the demo)
  network: "demo" | "testnet" | "local";
  market: string; // maturity label, e.g. 31DEC26
  maturity: number; // unix seconds
  paid?: number; // MUSD spent
  received?: number; // PT, YT or MUSD received
  rate?: number; // fixed APR for "fixed", break-even APR for "bet"
  payout?: number; // MUSD due at maturity for "fixed"
  tx?: string;
  block?: number;
  feeBtc?: number;
  account?: string;
};

export const KIND_TITLE: Record<ReceiptKind, string> = {
  fixed: "Fixed rate locked",
  bet: "Rate bet placed",
  claim: "Yield claimed",
  redeem: "PT redeemed",
};

const fmt = (n: number, d = 2) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
export const shortDate = (s: number) =>
  new Date(s * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** One sentence that says what happened, used as the receipt headline. */
export function headline(r: Receipt): string {
  switch (r.kind) {
    case "fixed":
      return `You locked ${fmt((r.rate ?? 0) * 100)}% on ${fmt(r.paid ?? 0)} MUSD until ${shortDate(r.maturity)}.`;
    case "bet":
      return `You bought ${fmt(r.received ?? 0, 0)} YT for ${fmt(r.paid ?? 0)} MUSD.`;
    case "claim":
      return `You claimed ${fmt(r.received ?? 0, 4)} MUSD of sMUSD yield.`;
    case "redeem":
      return `You redeemed ${fmt(r.paid ?? 0)} PT for ${fmt(r.received ?? 0)} MUSD.`;
  }
}

export function newReceipt(fields: Omit<Receipt, "v" | "id">): Receipt {
  const id = `${fields.kind}-${fields.at}-${Math.random().toString(36).slice(2, 7)}`;
  return { v: 1, id, ...fields };
}

export function encodeReceipt(r: Receipt): string {
  const json = JSON.stringify(r);
  return btoa(String.fromCharCode(...new TextEncoder().encode(json))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeReceipt(s: string): Receipt | null {
  try {
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const r = JSON.parse(new TextDecoder().decode(bytes)) as Receipt;
    if (r?.v !== 1 || !(r.kind in KIND_TITLE) || typeof r.maturity !== "number") return null;
    return r;
  } catch {
    return null;
  }
}

export function shareUrl(r: Receipt): string {
  const url = new URL(window.location.href);
  url.search = "";
  url.searchParams.set("r", encodeReceipt(r));
  return url.toString();
}

// Per-viewer history so stamps survive a reload. Storage can be missing or
// throw (private windows, blocked site data); the app works without it.
const KEY = "tenor.receipts.v1";
export function loadReceipts(): Receipt[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as Receipt[]) : [];
    return Array.isArray(list) ? list.filter((r) => r?.v === 1).slice(0, 24) : [];
  } catch {
    return [];
  }
}
export function saveReceipts(list: Receipt[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, 24)));
  } catch {
    // ignore: storage is a convenience
  }
}
