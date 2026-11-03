# Notices and credits

| Component | Source | License | Where |
|---|---|---|---|
| Tigris `Pool`, `PoolFees`, `PoolFactory` and interfaces (test only, imports rewritten to `@oz4/`) | github.com/mezo-org/tigris | MIT | `contracts/test/vendor/tigris/` |
| OpenZeppelin Contracts 5.1.0 and 4.9.0 (4.9 only for the vendored Tigris pool) | github.com/OpenZeppelin/openzeppelin-contracts | MIT | `contracts/lib/` |
| forge-std 1.9.7 | github.com/foundry-rs/forge-std | MIT / Apache-2.0 | `contracts/lib/forge-std` |
| interior.dev micro-interactions (segmented control, slider detents, loading button, hold to confirm, value flash, task steps, skeleton swap, tooltip group, accordion, copy button), installed with the shadcn CLI and then edited | interior.dev, github.com/ddoemonn/interior | MIT | `web/src/components/interior/` |

Local edits to interior components: `ValueFlash` inherits font size; `LoadingButton` gained a `primary` variant; `SegmentedControl` buttons carry an explicit `aria-label`.

## Ideas taken from Mezo Buildathon Wave 1 entries

No code was copied from other teams. These public patterns shaped the project:

| Pattern | Seen in |
|---|---|
| Quote before a wallet connects, and a wallet-free demo path | Doji, Janus, Keel, Surety |
| Mainnet fork tests pinned to a block, with an explicit list of what runs on chain | Baserate, mbLP, Plumb |
| One-command lifecycle proof and a proof table built from deployment files | Doji (`prove-it.sh`), Surety (`proof-table.mjs`) |
| Contract address table in the README, "review in five minutes" first | most top entries |
