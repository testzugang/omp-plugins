import { describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@oh-my-pi/pi-coding-agent";
import type { HandoffOptions } from "../../extensions/handoff-session/ui.ts";
const { completeMock } = vi.hoisted(() => ({
  completeMock: vi.fn(),
}));

vi.mock("@oh-my-pi/pi-ai", () => ({
  complete: completeMock,
}));

vi.mock("@oh-my-pi/pi-coding-agent", () => ({
  convertToLlm: (messages: unknown[]) => messages,
  getAgentDir: () => process.cwd(),
}));

vi.mock("@oh-my-pi/pi-tui", () => ({
  CURSOR_MARKER: "",
  matchesKey: () => false,
  visibleWidth: (text: string) => text.length,
}));

import registerHandoffSession from "../../extensions/handoff-session/index.ts";
import {
  buildGeneratorPrompt,
  buildSuggestionPrompt,
  contentBlocksToText,
  parseSuggestionResponse,
} from "../../extensions/handoff-session/handoff.ts";

type RegisteredHandler = (
  args: string,
  ctx: ExtensionCommandContext,
) => Promise<void>;

type HandoffOverlay = {
  onGenerate?: (
    options: HandoffOptions,
    signal: AbortSignal,
  ) => Promise<string | null>;
};

type CustomRenderer = (
  tui: { requestRender: () => void },
  theme: unknown,
  keybindings: unknown,
  done: () => void,
) => HandoffOverlay;

type CompletionRequest = {
  messages: Array<{ content: Array<{ text: string }> }>;
};

function isCompletionRequest(value: unknown): value is CompletionRequest {
  if (!value || typeof value !== "object" || !("messages" in value)) {
    return false;
  }
  const { messages } = value;
  return (
    Array.isArray(messages) &&
    messages.length > 0 &&
    typeof messages[0] === "object" &&
    messages[0] !== null &&
    "content" in messages[0] &&
    Array.isArray(messages[0].content) &&
    messages[0].content.length > 0 &&
    typeof messages[0].content[0] === "object" &&
    messages[0].content[0] !== null &&
    "text" in messages[0].content[0] &&
    typeof messages[0].content[0].text === "string"
  );
}

describe("Handoff Generator Prompt", () => {
  it("serializes converted LLM messages into the generated handoff history", async () => {
    completeMock.mockClear();
    completeMock.mockResolvedValue({
      content: [
        {
          type: "text",
          text: '{"goal":"Continue the handoff","sessionName":"continue-handoff"}',
        },
      ],
    });

    let registeredHandler: RegisteredHandler | undefined;
    const extension = {
      registerCommand: (_name: string, command: { handler: RegisteredHandler }) => {
        registeredHandler = command.handler;
      },
      setModel: vi.fn(),
    };

    // The test double implements only the public registration surface under test.
    const testExtension = extension as unknown as ExtensionAPI;
    registerHandoffSession(testExtension);
    expect(registeredHandler).toBeTypeOf("function");

    let generatedPrompt: string | null | undefined;
    const activeModel = { provider: "test", id: "model" };
    const ctx = {
      hasUI: true,
      mode: "tui",
      model: activeModel,
      cwd: process.cwd(),
      modelRegistry: {
        getApiKey: vi.fn().mockResolvedValue("test-key"),
        getAvailable: vi.fn().mockReturnValue([activeModel]),
      },
      sessionManager: {
        getSessionId: vi.fn().mockReturnValue("test-session"),
        getBranch: vi.fn().mockReturnValue([
          {
            type: "custom_message",
            id: "handoff-message",
            parentId: null,
            timestamp: "2026-07-24T00:00:00.000Z",
            customType: "test",
            content: "converted handoff transcript",
            display: true,
          },
        ]),
      },
      ui: {
        theme: {},
        notify: vi.fn(),
        custom: async (render: CustomRenderer) => {
          const component = render(
            { requestRender: vi.fn() },
            undefined,
            undefined,
            vi.fn(),
          );
          if (!component.onGenerate) {
            throw new Error("Handoff overlay must provide a generator callback");
          }
          generatedPrompt = await component.onGenerate(
            {
              goal: "Continue the handoff",
              targetModel: "test/model",
              sessionName: "continue-handoff",
              manualReferences: "",
              saveHandoff: false,
            },
            new AbortController().signal,
          );
          return undefined;
        },
      },
    };

    // The command consumes only the context fields provided by this focused test.
    const testContext = ctx as unknown as ExtensionCommandContext;
    await registeredHandler!("Continue the handoff", testContext);
    expect(ctx.modelRegistry.getApiKey).toHaveBeenCalledWith(
      activeModel,
      "test-session",
    );

    expect(generatedPrompt).toBe(
      '{"goal":"Continue the handoff","sessionName":"continue-handoff"}',
    );
    const generatedRequest = completeMock.mock.calls
      .map((call) => call[1] as unknown)
      .find(isCompletionRequest);
    if (!generatedRequest) {
      throw new Error("Expected a completion request containing conversation history");
    }
    expect(generatedRequest.messages[0].content[0].text).toContain(
      "converted handoff transcript",
    );
    expect(completeMock).toHaveBeenCalledTimes(2);
    for (const call of completeMock.mock.calls) {
      expect(call[2]).toEqual(expect.objectContaining({ apiKey: "test-key" }));
      expect(call[2]).not.toHaveProperty("headers");
    }
  });

  it("assembles correct instructions including goal and referenced documents without reading them", () => {
    const goal = "Refactor active validation pipeline";
    const manualRefs = ["packages/omp-commit/package.json"];
    const autoRefs = ["docs/omp/specs/design.md"];
    const compactionSummary = "Previous work set up workspaces";

    const prompt = buildGeneratorPrompt(goal, manualRefs, autoRefs, compactionSummary);
    
    // Core inputs
    expect(prompt).toContain(goal);
    expect(prompt).toContain("packages/omp-commit/package.json");
    expect(prompt).toContain("docs/omp/specs/design.md");
    expect(prompt).toContain(compactionSummary);
    
    // Constraints and design guidelines from spec
    expect(prompt).toContain("DO NOT read or copy their full text into the handoff prompt");
    expect(prompt).toContain("DO NOT speculate");
    expect(prompt).toContain("Mark any open questions");
  });

  it("builds a context-aware suggestion prompt with JSON-only output contract", () => {
    const prompt = buildSuggestionPrompt(
      "User fixed model switching and now wants better handoff defaults.",
      "Start the next step from this handoff",
    );

    expect(prompt).toContain("User fixed model switching");
    expect(prompt).toContain("goal");
    expect(prompt).toContain("sessionName");
    expect(prompt).toContain("Return only JSON");
  });

  it("parses suggestion JSON and normalizes concise session names", () => {
    const suggestion = parseSuggestionResponse(
      '{"goal":"Improve handoff defaults from recent session context","sessionName":"handoff session improve defaults"}',
      "Fallback goal",
    );

    expect(suggestion).toEqual({
      goal: "Improve handoff defaults from recent session context",
      sessionName: "improve-defaults",
    });
  });

  it("extracts text blocks from model response content", () => {
    expect(
      contentBlocksToText([
        { type: "text", text: "first" },
        { type: "thinking", thinking: "hidden" },
        { type: "text", text: "second" },
      ]),
    ).toBe("first\nsecond");
  });

  it("falls back when suggestion output is not valid JSON", () => {
    const suggestion = parseSuggestionResponse(
      "I would call it model fix",
      "Fix target model handoff",
    );

    expect(suggestion).toEqual({
      goal: "Fix target model handoff",
      sessionName: "fix-target-model",
    });
  });

  it("executes headless handoff generation when hasUI is false", async () => {
    const tempTestDir = path.resolve(process.cwd(), "temp-tests-headless");
    await fs.mkdir(tempTestDir, { recursive: true });
    try {
      completeMock.mockClear();
      completeMock.mockResolvedValue({
        content: [
          {
            type: "text",
            text: "Headless handoff prompt text",
          },
        ],
      });

      let registeredHandler: RegisteredHandler | undefined;
      const extension = {
        registerCommand: (_name: string, command: { handler: RegisteredHandler }) => {
          registeredHandler = command.handler;
        },
        setModel: vi.fn().mockResolvedValue(true),
      };

      const testExtension = extension as unknown as ExtensionAPI;
      registerHandoffSession(testExtension);

      const activeModel = { provider: "test", id: "model" };
      const ctx = {
        hasUI: false,
        model: activeModel,
        cwd: tempTestDir,
        modelRegistry: {
          getApiKey: vi.fn().mockResolvedValue("test-key"),
          getAvailable: vi.fn().mockReturnValue([activeModel]),
        },
        sessionManager: {
          getSessionId: vi.fn().mockReturnValue("test-session"),
          getBranch: vi.fn().mockReturnValue([
            {
              type: "message",
              id: "msg-1",
              parentId: null,
              timestamp: "2026-07-28T00:00:00.000Z",
              message: { role: "user", content: "hello" },
            },
          ]),
          getSessionFile: vi.fn().mockReturnValue("session.jsonl"),
        },
        newSession: vi.fn().mockResolvedValue(undefined),
      };

      await registeredHandler!("Headless goal", ctx as unknown as ExtensionCommandContext);
      expect(ctx.modelRegistry.getApiKey).toHaveBeenCalledWith(
        activeModel,
        "test-session",
      );

      expect(completeMock).toHaveBeenCalled();
      const generatedCall = completeMock.mock.calls.find((call) =>
        isCompletionRequest(call[1]),
      );
      expect(generatedCall?.[2]).toEqual({ apiKey: "test-key" });
      expect(ctx.newSession).toHaveBeenCalled();
    } finally {
      await fs.rm(tempTestDir, { recursive: true, force: true });
    }
  });
  it("aborts before opening the overlay when credentials are unavailable", async () => {
    completeMock.mockClear();
    let registeredHandler: RegisteredHandler | undefined;
    const extension = {
      registerCommand: (_name: string, command: { handler: RegisteredHandler }) => {
        registeredHandler = command.handler;
      },
      setModel: vi.fn(),
    };
    registerHandoffSession(extension as unknown as ExtensionAPI);

    const activeModel = { provider: "test", id: "model" };
    const ctx = {
      hasUI: true,
      mode: "tui",
      model: activeModel,
      modelRegistry: {
        getApiKey: vi.fn().mockResolvedValue(undefined),
        getAvailable: vi.fn().mockReturnValue([activeModel]),
      },
      sessionManager: {
        getSessionId: vi.fn().mockReturnValue("test-session"),
      },
      ui: {
        notify: vi.fn(),
        custom: vi.fn(),
      },
    };

    await registeredHandler!("", ctx as unknown as ExtensionCommandContext);

    expect(ctx.modelRegistry.getApiKey).toHaveBeenCalledWith(
      activeModel,
      "test-session",
    );
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "Authentication for model test/model is missing or invalid. Handoff generation aborted.",
      "error",
    );
    expect(ctx.ui.custom).not.toHaveBeenCalled();
    expect(completeMock).not.toHaveBeenCalled();
  });
});
