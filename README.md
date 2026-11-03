# Tenor

Fixed-rate MUSD on Mezo. Tenor splits Mezo's savings token sMUSD into a **principal token (PT)** that redeems for exactly 1 MUSD at a fixed date and a **yield token (YT)** that collects all sMUSD yield until that date. PT trades against MUSD on a Tigris stable pool, so the market prices a fixed MUSD savings rate.

Why now: sMUSD paid 0.03% annualized over the last 7 days, 2.06% over 30 days and 3.35% over 60 days (read from Mezo mainnet on 2026-11-03). A saver cannot know what it will pay next month. Tenor lets them lock it, and lets anyone with a view on Mezo's protocol revenue take the other side.

## Review in five minutes

| Step | Where |
|---|---|
| 1. Run the demo (no wallet needed) | `cd web && npm install && npm run dev`, open http://localhost:5178 |
| 2. Lock a fixed rate, buy YT, set sMUSD to 8%, press "+1 week", claim, jump to maturity, hold to redeem | the demo |
| 3. Read the market contract | `contracts/src/TenorMarket.sol` |
| 4. Run the tests | `cd contracts && forge test` |
| 5. See the trade flow statechart and checked scenarios | `docs/ui-statechart.md` |

The demo market is simulated in the browser with the same math as the contracts (Tigris stable curve with its 0.05% fee, yield index, settlement at maturity). The sMUSD rate tiles are read live from Mezo mainnet.

## Receipts and stamps

Every lock, rate bet, claim and redemption produces a receipt: a ticket with the amounts, the fixed or break-even rate, the maturity and, on testnet, the transaction, block and fee with an explorer link. Each receipt carries an ink stamp whose shape tells the action apart (circle for a fixed rate, frame for a rate bet, hexagon for a claim, ticket for a redemption), and every stamp collects in "Your stamps". Receipts come in Paper and Night styles, download as PNG, and "Copy link" encodes the receipt in the URL (`?r=`) so it reopens on any device. Demo receipts say plainly that no transaction was sent.

## Built on Mezo

| Mezo contract | Mainnet address | What Tenor calls |
|---|---|---|
| sMUSD (MUSDSavingsRate) | `0xb4D498029af77680cD1eF828b967f010d06C51CC` | `deposit`, `withdraw`, `claimYield`, `yieldIndex`, `supplyYieldIndex`, `claimableYield` |
| Tigris PoolFactory | `0x83FE469C636C4081b87bA5b3Ae9991c6Ed104248` | `createPool(pt, musd, stable=true)` (permissionless) |
| Tigris Pool | per market | `getAmountOut`, `swap` with the `IPoolCallee.hook` flash callback |
| MUSD | `0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186` | the asset |

## Contracts

| Contract | Role |
|---|---|
| `TenorMarket` | One per maturity. Holds unstaked sMUSD 1:1 against PT. `mint`, `mintFromSavings`, `combine` (before maturity), `redeem` (after), `claim`, permissionless `harvest` and `collectFees`. No owner, pause or upgrade path. |
| `TenorToken` | PT and YT. Every transfer settles yield for both sides first, like sMUSD itself. |
| `TenorRouter` | `buyPrincipal`, `sellPrincipal`, and `buyYield` through a Tigris flash swap. Slippage limits and deadlines on every trade; holds nothing between calls. |
| `TenorFactory` | Creates one market per maturity at a CREATE2 address. |

Yield accounting: `sMUSD.claimYield()` is pulled into `ytIndex` until the first harvest at or after maturity, which settles the market; later yield goes to `ptIndex` for PT holders who have not redeemed. A 5% fee on harvested yield goes to an immutable recipient.

### Tests

`forge test` runs 29 tests against the real Tigris `Pool` and `PoolFactory` (vendored from mezo-org/tigris, MIT) and a mock that reproduces MUSDSavingsRate accounting, including `withdraw` releasing fresh protocol yield inside the call.

| Invariant | Meaning |
|---|---|
| T1 | `sMUSD.balanceOf(market) == PT.totalSupply()` |
| T2 | Before maturity, PT supply equals YT supply |
| T3 | MUSD held covers fees, booked yield and yield accrued in the indexes |

The invariant suite runs 256 runs x 64 calls with `fail_on_revert = true`. A mainnet fork suite (`test/fork/`) runs the real sMUSD and Tigris factory when `MEZO_MAINNET_RPC` is set.

One bug the tests caught: `combine` and `redeem` first burned tokens and then withdrew from sMUSD. Because `sMUSD.withdraw` can distribute fresh protocol yield inside the call, that yield found a zero YT supply and fell to fees. The fix withdraws first, then burns.

## Testnet operations

All scripts live in `ops/` (viem, idempotent, every transaction recorded in `deployments/31611.json`). The deployer key sits in `contracts/.env` (gitignored; see `contracts/.env.example`).

| Command (in `ops/`) | What it does |
|---|---|
| `npm run deploy -- --dry` | Simulates factory and router creation on Mezo testnet with `eth_call` |
| `npm run deploy` | Deploys TenorFactory, TenorRouter, the 12NOV26 and 31DEC26 markets and a Tigris stable pool for each |
| `npm run seed` | Swaps testnet BTC for MUSD on Tigris, seeds each pool 1:1, then opens a discount to about a 3% implied rate. Pool size follows the BTC balance |
| `npm run prove` | Live lifecycle checks (buy PT, buy YT, sMUSD yield, claim, combine, backing invariant) written to `docs/proof.md` |
| `npm run prove -- --redeem` | After 2026-11-12 12:00 UTC, redeems the matured market and checks settlement |
| `npm run keeper` | Harvests yield and trades the pool back inside 3% +/- 1% (single YT buys skew thin pools) |

Rehearse everything first on a local chain: start anvil on port 8547 with chain id 31611, run `forge script script/LocalMezo.s.sol` from `contracts/` (see the script header), then run the same scripts with `TENOR_NETWORK=local`. The web app's live panel uses that chain with `?network=local`.

## Known product facts

1. Tigris charges its stable fee (0.05%) on the full PT notional. A YT buy goes through PT, so the fee adds roughly 0.3 points to the YT break-even rate over eight weeks. A lower custom fee for the PT pool would need Mezo's fee manager.
2. A gauge for the PT/MUSD pool needs Mezo governance (non-governors can only create gauges for whitelisted tokens).
3. PT held inside the pool after maturity keeps earning post-settlement yield that the pool cannot claim; LPs should exit at maturity.

## Credits

See `NOTICE.md`.
