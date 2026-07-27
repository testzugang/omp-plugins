import { describe, expect, it, vi } from "vitest";
import type { SessionEntry } from "@oh-my-pi/pi-coding-agent";

const codingAgentMocks = vi.hoisted(() => ({
  getAgentDir: vi.fn(() => "/tmp/omp-agent"),
}));

vi.mock("@oh-my-pi/pi-coding-agent", () => ({
  convertToLlm: vi.fn(),
  getAgentDir: codingAgentMocks.getAgentDir,
}));
vi.mock("@oh-my-pi/pi-ai", () => ({ complete: vi.fn() }));
vi.mock("@oh-my-pi/pi-tui", () => ({
  CURSOR_MARKER: "█",
  matchesKey: vi.fn(),
  visibleWidth: vi.fn((text: string) => text.length),
}));
import { parseReferences, autoDetectReferences } from "../../extensions/handoff-session/references.ts";
import handoffSession, {
  prepareHandoffContext,
  type HandoffContext,
} from "../../extensions/handoff-session/index.ts";


const publicPrepareHandoffContext: (
  branch: SessionEntry[],
) => HandoffContext = prepareHandoffContext;
void publicPrepareHandoffContext;
describe("Reference Utilities", () => {
  it("parses and normalizes manual reference inputs, including deduplication", () => {
    const input = "docs/omp/specs/design.md, @packages/foo/index.ts, docs/omp/specs/design.md, https://github.com/org/repo/pull/12";
    const parsed = parseReferences(input);
    
    expect(parsed).toContain("docs/omp/specs/design.md");
    expect(parsed).toContain("packages/foo/index.ts");
    expect(parsed).toContain("https://github.com/org/repo/pull/12");
    
    // Check that there is no leading @
    expect(parsed).not.toContain("@packages/foo/index.ts");

    // Deduplication check
    expect(parsed.filter(r => r === "docs/omp/specs/design.md").length).toBe(1);
  });

  it("auto-detects paths, markdown docs and git hashes from session message entries", () => {
    const entries: SessionEntry[] = [
      {
        id: "1",
        type: "message",
        timestamp: "2026-06-24T12:00:00.000Z",
        message: {
          role: "user",
          content: "Please check docs/omp/specs/2026-06-23-handoff-session-design.md, we also changed packages/omp-commit/package.json.",
        },
      },
      {
        id: "2",
        type: "message",
        timestamp: "2026-06-24T12:01:00.000Z",
        message: {
          role: "assistant",
          content: "Done, the changes are committed under 0b83ed4. PR is on https://github.com/hasit/omp/pull/42, we also have another on https://github.com/hasit/omp/pull/13.",
        },
      },
    ];
    
    const detected = autoDetectReferences(entries);
    expect(detected).toContain("docs/omp/specs/2026-06-23-handoff-session-design.md");
    expect(detected).toContain("packages/omp-commit/package.json");
    expect(detected).toContain("0b83ed4");
    expect(detected).toContain("https://github.com/hasit/omp/pull/42");
    expect(detected).toContain("https://github.com/hasit/omp/pull/13");
    // Ensure trailing punctuation was successfully stripped
    expect(detected).not.toContain("https://github.com/hasit/omp/pull/42,");
    expect(detected).not.toContain("https://github.com/hasit/omp/pull/13.");
  });

  it("extracts and slices messages properly based on compaction entries for token protection", () => {
    const branch: SessionEntry[] = [
      {
        id: "old-1",
        type: "message",
        timestamp: "2026-06-24T10:00:00.000Z",
        message: { role: "user", content: "Compacted message 1" }
      },
      {
        id: "compaction-1",
        type: "compaction",
        timestamp: "2026-06-24T10:05:00.000Z",
        summary: "This is the compaction summary",
        tokensBefore: 2000,
        firstKeptEntryId: "kept-1"
      },
      {
        id: "kept-1",
        type: "message",
        timestamp: "2026-06-24T10:10:00.000Z",
        message: { role: "user", content: "Kept message after compaction" }
      }
    ];

    const handoffCtx = prepareHandoffContext(branch);
    const messages = handoffCtx.messages;
    
    // Should contain the compaction summary entry and the kept message, but not the compacted old message
    expect(messages.length).toBe(2);
    expect(messages[0].role).toBe("compactionSummary");
    expect(messages[0].summary).toBe("This is the compaction summary");
    expect(messages[1].content).toBe("Kept message after compaction");
    expect(handoffCtx.compactionSummary).toBe("This is the compaction summary");
  });

  it("registers /handoff-session and opens its custom UI as an overlay", async () => {
    const registerCommand = vi.fn();
    handoffSession({ registerCommand } as never);

    expect(registerCommand).toHaveBeenCalledWith(
      "handoff-session",
      expect.objectContaining({ handler: expect.any(Function) }),
    );


    codingAgentMocks.getAgentDir.mockClear();
    const command = registerCommand.mock.calls[0]?.[1] as {
      handler: (args: string, ctx: never) => Promise<void>;
    };
    const activeModel = { provider: "anthropic", id: "claude-sonnet-4-5" };
    const custom = vi.fn(async () => undefined);

    await command.handler(
      "transfer context",
      {
        cwd: "/tmp/omp-project",
        hasUI: true,
        mode: "tui",
        model: activeModel,
        modelRegistry: {
          getApiKey: vi.fn().mockResolvedValue("test-key"),
          getAvailable: () => [activeModel],
        },
        sessionManager: {
          getSessionId: vi.fn().mockReturnValue("test-session"),
        },
        ui: { custom, notify: vi.fn() },
      } as never,
    );

    expect(custom).toHaveBeenCalledWith(expect.any(Function), { overlay: true });
    expect(codingAgentMocks.getAgentDir).toHaveBeenCalledOnce();
  });
});
