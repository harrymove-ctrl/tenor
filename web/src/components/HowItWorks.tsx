import { Accordion } from "@/components/interior/accordion";
import { CopyButton } from "@/components/interior/copy-button";
import { DEPLOYMENT, NETWORK } from "@/lib/live";

const TENOR =
  DEPLOYMENT && NETWORK === "testnet"
    ? [
        { name: "TenorFactory (Mezo testnet)", address: DEPLOYMENT.factory },
        { name: "TenorRouter (Mezo testnet)", address: DEPLOYMENT.router },
        ...Object.entries(DEPLOYMENT.markets).map(([k, m]) => ({ name: `TenorMarket ${k} (Mezo testnet)`, address: m.market })),
      ]
    : [];

const CONTRACTS = [
  ...TENOR,
  { name: "sMUSD (Mezo mainnet)", address: "0xb4D498029af77680cD1eF828b967f010d06C51CC" },
  { name: "Tigris PoolFactory (Mezo mainnet)", address: "0x83FE469C636C4081b87bA5b3Ae9991c6Ed104248" },
];

export function HowItWorks() {
  return (
    <section className="card flex flex-col gap-3" aria-label="How it works">
      <h2 className="text-[15px] font-semibold">How it works</h2>
      <Accordion
        type="single"
        collapsible
        items={[
          {
            id: "split",
            title: "One sMUSD becomes one PT and one YT",
            content: (
              <p>
                Tenor deposits your MUSD into Mezo's savings vault (sMUSD) and mints a principal token and a yield token. The
                PT is worth exactly 1 MUSD at maturity. The YT collects every MUSD of sMUSD yield until then.
              </p>
            ),
          },
          {
            id: "price",
            title: "Where the fixed rate comes from",
            content: (
              <p>
                PT trades against MUSD in a Tigris stable pool. If PT costs 0.997 MUSD and pays 1 MUSD in 58 days, that is
                about a 1.9% fixed rate. Savers buy PT; people who expect sMUSD to pay more buy YT.
              </p>
            ),
          },
          {
            id: "risk",
            title: "What can go wrong",
            content: (
              <ul className="list-inside list-decimal space-y-1">
                <li>sMUSD pays less than the break-even rate, so YT loses money.</li>
                <li>Mezo governance changes sMUSD. PT still redeems 1:1 while sMUSD withdrawals work.</li>
                <li>A thin pool moves the price. Every quote shows price impact first.</li>
              </ul>
            ),
          },
          {
            id: "contracts",
            title: "Contracts",
            content: (
              <ul className="flex flex-col gap-2">
                {CONTRACTS.map((c) => (
                  <li key={c.address} className="flex items-center justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block text-xs text-stone-500 dark:text-stone-400">{c.name}</span>
                      <code className="block truncate text-xs">{c.address}</code>
                    </span>
                    <CopyButton value={c.address} label="Copy" className="shrink-0" />
                  </li>
                ))}
                {TENOR.length === 0 && <li className="text-xs text-stone-500 dark:text-stone-400">Tenor's own testnet addresses appear here after deployment.</li>}
              </ul>
            ),
          },
        ]}
      />
    </section>
  );
}
