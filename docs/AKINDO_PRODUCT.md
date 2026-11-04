# AKINDO Create Product: paste-ready values

## Field values

| Field | Value |
|---|---|
| Product icon | `docs/akindo-upload/tenor-icon.png` |
| Product name | Tenor |
| Product type | Functional |
| Image gallery | The five numbered files in `docs/akindo-upload/`, in order |
| Deliverable URL | https://github.com/harrymove-ctrl/tenor |
| Video | Public YouTube URL (the form asks for public) |
| Live demo | https://harrymove-ctrl.github.io/tenor/ |
| Build with | Mezo |
| Product Category | DeFi, Fixed Income, Yield Trading |
| Tags | Solidity, Foundry, viem, React, Vite, Tailwind CSS, Tigris, MUSD, sMUSD |
| Product detail visibility | Show |

## Tagline

Fixed-rate MUSD on Mezo: lock what sMUSD pays, or trade it.

## About

Copy everything below this line.

### The problem

sMUSD pays MUSD from trove interest, and its realized rate swings with Mezo's revenue. Read from Mezo mainnet on 2026-11-03, it paid 0.03% annualized over 7 days, 2.06% over 30 days and 3.35% over 60 days. A saver cannot plan on that, and nobody can take a view on it.

### What Tenor does

Tenor splits sMUSD into two tokens with a fixed maturity:

1. **Principal token (PT):** redeems for exactly 1 MUSD at maturity. Savers buy it below 1 MUSD to lock a rate.
2. **Yield token (YT):** collects all sMUSD yield until maturity. Rate traders buy it for a fraction of a MUSD to get leveraged exposure to sMUSD's yield.

PT trades against MUSD on a Tigris stable pool, so the market prices a fixed MUSD savings rate.

### How it uses Mezo

1. `TenorMarket` deposits into sMUSD (MUSDSavingsRate), pulls yield with `claimYield`, and keeps every PT backed 1:1 by unstaked sMUSD.
2. `TenorRouter` trades on a Tigris stable pool created permissionlessly through `PoolFactory`, and buys YT in one transaction with the pool's flash callback (`IPoolCallee.hook`).
3. A starter flow swaps testnet BTC for MUSD on Tigris, so a new user needs only the faucet.

### What shipped this wave

Entirely new in Wave 2, live on Mezo testnet.

1. **Contracts:** TenorMarket, TenorToken, TenorRouter and TenorFactory, with no owner, pause or upgrade path. Factory `0x6326349e8ebb72e14a18d280f7cf54611c904945`, router `0xc012212d50946318f9236547949e73fe9f2fbd71`, with markets maturing 2026-11-12 and 2026-12-31.
2. **Tests:** 24 unit and fuzz tests against the real Tigris Pool and PoolFactory, 3 invariants (backing, supply parity, yield solvency) at 16,384 calls each with zero reverts, and an opt-in mainnet fork suite against the real sMUSD.
3. **On-chain proof:** the live testnet proof passed 6 of 6 checks: [docs/proof.md](https://github.com/harrymove-ctrl/tenor/blob/main/docs/proof.md).
4. **App:** a wallet-free demo with the contracts' math, live sMUSD rates from mainnet, a live panel that trades the deployed testnet markets, and a shareable receipt with an ink stamp for every action.

### Business model

5% of harvested sMUSD yield, plus Tigris swap fees for liquidity providers. Nothing depends on emissions.

### Materials

[Pitch deck (PDF)](https://harrymove-ctrl.github.io/tenor/tenor-deck.pdf)

### Next

Capped mainnet market for Dec 31, keeper on a schedule, a concentrated-liquidity PT pool for depth, a MEZO-mode YT that stakes sMUSD in its gauge, and PT as Morpho collateral. Asks to Mezo: gauge whitelisting for PT and a lower stable fee for PT pools.
