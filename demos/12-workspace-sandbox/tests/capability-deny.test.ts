import { describe, expect, it, vi } from "vitest";
import { apply } from "../src/plugins/capability-deny.js";

describe("capability deny plugin", () => {
  it("registers monotonic DSH tool guards for Shell and web tools", () => {
    const guard = vi.fn();
    apply({ tools: { guard } } as never);
    const policy = guard.mock.calls[0]?.[0] as (value: {
      name: string;
    }) => string | undefined;

    expect(policy({ name: "bash" })).toBe(
      "demo policy denies Shell by default",
    );
    expect(policy({ name: "web_search" })).toBe(
      "demo policy denies network tools by default",
    );
    expect(policy({ name: "write" })).toBeUndefined();
  });
});
