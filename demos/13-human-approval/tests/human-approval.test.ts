import { describe, expect, it } from "vitest";
import {
  approvalMode,
  outcomeFor,
  TOOL_NAME,
} from "../src/plugins/human-approval.js";

describe("deterministic approval answerer", () => {
  it("maps allow and reject to closed Runtime outcomes", () => {
    expect(outcomeFor(approvalMode("allow"))).toBe("allowed-once");
    expect(outcomeFor(approvalMode("reject"))).toBe("rejected");
    expect(TOOL_NAME).toBe("high_risk_workspace_delete");
  });

  it("rejects ambiguous configuration", () => {
    expect(() => approvalMode("yes")).toThrow(
      "DEMO_APPROVAL must be exactly allow or reject",
    );
    expect(() => approvalMode(undefined)).toThrow();
  });
});
