import { describe, it, expect } from "vitest";
import { NetworkStateMachine, TRANSITION_TABLE, backoffMs } from "../../main/net/state-machine.js";

describe("[unit] network state machine", () => {
  it("starts in 'connected' by default", () => {
    expect(new NetworkStateMachine().current()).toBe("connected");
  });

  it.each(TRANSITION_TABLE)(
    "from $from on $on → $to",
    ({ from, on, to }) => {
      const sm = new NetworkStateMachine(from);
      sm.signal({ type: on } as never);
      expect(sm.current()).toBe(to);
    },
  );

  it("ignores non-applicable signals (no transition row)", () => {
    const sm = new NetworkStateMachine("connected");
    sm.signal({ type: "ok" });
    expect(sm.current()).toBe("connected");
  });

  it("emits 'change' on transition only", () => {
    const sm = new NetworkStateMachine("connected");
    let emits = 0;
    sm.on("change", () => emits++);
    sm.signal({ type: "ok" }); // no-op
    expect(emits).toBe(0);
    sm.signal({ type: "stream-closed" }); // -> reconnecting
    expect(emits).toBe(1);
    sm.signal({ type: "ok" }); // -> connected
    expect(emits).toBe(2);
  });
});

describe("[unit] backoffMs", () => {
  it("doubles each attempt up to the cap", () => {
    expect(backoffMs(0)).toBe(1000);
    expect(backoffMs(1)).toBe(2000);
    expect(backoffMs(2)).toBe(4000);
    expect(backoffMs(3)).toBe(8000);
    expect(backoffMs(10)).toBe(60_000); // capped
  });
  it("treats negative attempts as the base", () => {
    expect(backoffMs(-1)).toBe(1000);
  });
  it("honours custom base + cap", () => {
    expect(backoffMs(0, { base: 250 })).toBe(250);
    expect(backoffMs(20, { base: 250, cap: 8000 })).toBe(8000);
  });
});
