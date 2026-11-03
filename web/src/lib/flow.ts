// The trade flow as an explicit state machine (see docs/ui-statechart.md).
// idle -> ready -> signing(step) -> done | error, with invalid as a guard on
// ready, and cancel returning from signing to ready.

export type FlowState =
  | { status: "idle" }
  | { status: "invalid"; reason: string }
  | { status: "ready" }
  | { status: "signing"; step: number }
  | { status: "done"; message: string }
  | { status: "error"; message: string };

export type FlowEvent =
  | { type: "input"; reason: string | null; empty: boolean }
  | { type: "submit" }
  | { type: "advance" }
  | { type: "succeed"; message: string }
  | { type: "fail"; message: string }
  | { type: "cancel" }
  | { type: "reset" };

export function flow(state: FlowState, event: FlowEvent): FlowState {
  switch (event.type) {
    case "input":
      if (state.status === "signing") return state; // inputs are locked while signing
      if (event.empty) return state.status === "done" ? state : { status: "idle" }; // keep the receipt after the field clears
      return event.reason ? { status: "invalid", reason: event.reason } : { status: "ready" };
    case "submit":
      return state.status === "ready" ? { status: "signing", step: 0 } : state;
    case "advance":
      return state.status === "signing" ? { status: "signing", step: state.step + 1 } : state;
    case "succeed":
      return state.status === "signing" ? { status: "done", message: event.message } : state;
    case "fail":
      return state.status === "signing" ? { status: "error", message: event.message } : state;
    case "cancel":
      return state.status === "signing" ? { status: "ready" } : state;
    case "reset":
      return { status: "idle" };
  }
}

export const SIGNING_STEPS = [
  { id: "approve", label: "Approve MUSD", meta: "Lets the router spend this amount only" },
  { id: "swap", label: "Swap on Tigris", meta: "One transaction through TenorRouter" },
  { id: "confirm", label: "Confirmed on Mezo", meta: "Position updated" },
];
