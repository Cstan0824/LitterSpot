import { describe, expect, it } from "vitest";
import { assertForwardAlertTransition } from "./alertTransitions.js";

describe("alert status transitions", () => {
  it("allows normal progression and forward stage skipping", () => {
    expect(() => assertForwardAlertTransition("new", "acknowledged")).not.toThrow();
    expect(() => assertForwardAlertTransition("new", "resolved")).not.toThrow();
    expect(() => assertForwardAlertTransition("acknowledged", "resolved")).not.toThrow();
  });

  it("rejects no-op, backward, and reopen transitions", () => {
    expect(() => assertForwardAlertTransition("new", "new")).toThrow("move forward");
    expect(() => assertForwardAlertTransition("in_progress", "acknowledged")).toThrow("move forward");
    expect(() => assertForwardAlertTransition("resolved", "new")).toThrow("cannot be reopened");
  });
});
