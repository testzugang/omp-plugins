import { describe, expect, it, vi } from "vitest";

type SchemaNode = {
  kind: string;
  args: unknown[];
};

type RegisteredTool = {
  name: string;
  parameters: SchemaNode;
};

function createInjectedType() {
  const calls: SchemaNode[] = [];
  const build = (kind: string) => (...args: unknown[]) => {
    const node = { kind, args };
    calls.push(node);
    return node;
  };

  return {
    calls,
    Type: {
      Object: build("Object"),
      Optional: build("Optional"),
      Number: build("Number"),
      String: build("String"),
      Boolean: build("Boolean"),
      Union: build("Union"),
      Literal: build("Literal"),
    },
  };
}

describe("pr_findings tool contract", () => {
  it("constructs the exact public parameter schema through injected TypeBox", async () => {
    vi.resetModules();
    // Dynamic import intentionally exercises the extension's load-time dependency boundary.
    const module = await import("../../extensions/pr-findings");
    const injected = createInjectedType();
    let tool: RegisteredTool | undefined;

    module.default({
      typebox: { Type: injected.Type },
      registerTool: vi.fn((registeredTool: RegisteredTool) => {
        tool = registeredTool;
      }),
    } as never);

    expect(tool?.name).toBe("pr_findings");
    expect(tool?.parameters.kind).toBe("Object");
    expect(injected.calls).toContain(tool?.parameters);
    expect(injected.calls.map((call) => call.kind)).toEqual([
      "Number",
      "Optional",
      "String",
      "Optional",
      "Boolean",
      "Optional",
      "Literal",
      "Literal",
      "Literal",
      "Literal",
      "Union",
      "Optional",
      "Boolean",
      "Optional",
      "Boolean",
      "Optional",
      "Boolean",
      "Optional",
      "Literal",
      "Literal",
      "Union",
      "Optional",
      "Number",
      "Optional",
      "Number",
      "Optional",
      "Object",
    ]);

    const properties = tool?.parameters.args[0] as Record<string, SchemaNode>;
    expect(Object.keys(properties)).toEqual([
      "prNumber",
      "repo",
      "unresolved",
      "severity",
      "includeStale",
      "mine",
      "waitForNextReview",
      "waitMode",
      "waitTimeoutSec",
      "waitPollSec",
    ]);

    expect(properties.prNumber.args[0].kind).toBe("Number");
    expect(properties.repo.args[0].kind).toBe("String");
    expect(properties.unresolved.args[0].kind).toBe("Boolean");
    expect(properties.includeStale.args[0].kind).toBe("Boolean");
    expect(properties.mine.args[0].kind).toBe("Boolean");
    expect(properties.waitForNextReview.args[0].kind).toBe("Boolean");
    expect(properties.waitTimeoutSec.args[0].kind).toBe("Number");
    expect(properties.waitPollSec.args[0].kind).toBe("Number");

    for (const field of Object.values(properties)) {
      expect(field.kind).toBe("Optional");
      expect(injected.calls).toContain(field);
    }

    const severityLiterals = (properties.severity.args[0].args[0] as SchemaNode[])
      .map((node) => node.args[0]);
    expect(severityLiterals).toEqual(["blocker", "warning", "nit", "all"]);

    const waitModeLiterals = (properties.waitMode.args[0].args[0] as SchemaNode[])
      .map((node) => node.args[0]);
    expect(waitModeLiterals).toEqual([
      "new-review-activity",
      "checks-finished",
    ]);
  });
});
