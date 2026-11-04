# AKINDO Wave 2 submission draft

Paste-ready. Replace every `TODO` before submitting. Wave 1 judges capped Materials when the deck, video, track or team were missing.

## Product name

Tenor

## Tagline

Fixed-rate MUSD on Mezo: lock what sMUSD pays, or trade it.

## Project category

Fixed-rate savings and yield trading

## Track and status

Track 1 (DeFi). Entirely new in Wave 2. Readiness: testnet deployment. TenorFactory `0x6326349e8ebb72e14a18d280f7cf54611c904945` and TenorRouter `0xc012212d50946318f9236547949e73fe9f2fbd71` on Mezo testnet, with markets maturing 2026-11-12 and 2026-12-31; the live proof passed 6 of 6 checks (see `docs/proof.md`).

## Links

| Item | Link |
|---|---|
| Live app | https://harrymove-ctrl.github.io/tenor/ |
| Code | https://github.com/harrymove-ctrl/tenor |
| Deck | https://harrymove-ctrl.github.io/tenor/tenor-deck.pdf |
| Video (under 2:15, public or unlisted, not private) | TODO |
| On-chain proof | https://github.com/harrymove-ctrl/tenor/blob/main/docs/proof.md |

## Overview

The problem: sMUSD pays MUSD from trove interest through PCV, and its realized rate swings with Mezo's revenue. Read from Mezo mainnet on 2026-11-03, it paid 0.03% annualized over 7 days, 2.06% over 30 days and 3.35% over 60 days. A saver cannot plan on that, and nobody can take a view on it.

What Tenor does: it splits sMUSD into a principal token (PT) that redeems for exactly 1 MUSD at a fixed maturity and a yield token (YT) that collects all sMUSD yield until then. PT trades against MUSD on a Tigris stable pool, so the market prices a fixed MUSD savings rate. Savers buy PT below 1 MUSD to lock a rate. Rate traders buy YT for a fraction of a MUSD to get leveraged exposure to sMUSD's yield.

How it uses Mezo: TenorMarket deposits into sMUSD (MUSDSavingsRate), pulls yield with claimYield and keeps every PT backed 1:1 by unstaked sMUSD. TenorRouter trades on a Tigris stable pool created permissionlessly through PoolFactory, and buys YT in one transaction with the pool's flash callback (IPoolCallee.hook). A starter flow swaps testnet BTC for MUSD on Tigris so a new user needs only the faucet.

What shipped this wave:

1. Contracts: TenorMarket, TenorToken (PT and YT settle yield on every transfer), TenorRouter, TenorFactory. No owner, pause or upgrade path.
2. Tests: 24 unit and fuzz tests against the real Tigris Pool and PoolFactory, 3 invariants (backing, supply parity, yield solvency) at 16,384 calls each with zero reverts, and an opt-in mainnet fork suite against the real sMUSD.
3. Ops: idempotent deploy, seed, prove and keeper scripts; a full local rehearsal passed 8 of 8 on-chain checks, including redemption at maturity.
4. App: a wallet-free demo with the contracts' math, live sMUSD rates from mainnet, and a live panel that trades the deployed testnet markets.

Business model: 5% of harvested sMUSD yield, plus Tigris swap fees for liquidity providers. Nothing depends on emissions.

## Target group

MUSD holders who want a known return, and DeFi users who want a position on Mezo's protocol revenue. This fits Track 1 (DeFi): both sides add new reasons to hold MUSD and sMUSD. Experience level: comfortable with an EVM wallet; the demo needs no wallet at all. Global, desktop and mobile web.

## Tech stack

Solidity and Foundry for contracts; Tigris stable pools and sMUSD on Mezo; React, Vite, Tailwind and viem for the app; GitHub Pages for hosting.

## Chain deployed on

Mezo (testnet)

## Team

Harry Phan: contracts, app, ops. GitHub harrymove-ctrl. X or LinkedIn: TODO.

## Wave 3 plan

Capped mainnet market for Dec 31, keeper on a schedule, a concentrated-liquidity PT pool for depth, a MEZO-mode YT that stakes sMUSD in its gauge, and PT as Morpho collateral. Asks to Mezo: gauge whitelisting for PT and a lower stable fee for PT pools.
