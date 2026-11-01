import { describe, it, expect, vi, beforeEach } from "vitest";
import { runAgent } from "./agent";

const createMock = vi.hoisted(() => vi.fn());
const getHistoryMock = vi.hoisted(() => vi.fn());
const saveHistoryMock = vi.hoisted(() => vi.fn());
const recordUsageMock = vi.hoisted(() => vi.fn());
const getFlightStatusesMock = vi.hoisted(() => vi.fn());
const findAlternativesMock = vi.hoisted(() => vi.fn());

vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn().mockImplementation(function AnthropicMock() {
    return { messages: { create: createMock } };
  }),
}));

vi.mock("./sessionStore", () => ({
  getHistory: getHistoryMock,
  saveHistory: saveHistoryMock,
}));

vi.mock("./tokenUsageTracker", () => ({
  recordUsage: recordUsageMock,
}));

vi.mock("./tools", () => ({
  tools: [],
  toolHandlers: {
    get_flight_statuses: getFlightStatusesMock,
    find_alternatives: findAlternativesMock,
  },
}));

const MAX_TOOL_ROUNDS = 5;
const MAX_HISTORY_MESSAGES = 20;

function textResponse(text: string, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    stop_reason: "end_turn",
    usage: { input_tokens: 10, output_tokens: 5 },
    content: [{ type: "text", text }],
    ...overrides,
  };
}

function toolUseResponse(
  calls: { id: string; name: string; input: unknown }[],
  overrides: Partial<Record<string, unknown>> = {}
) {
  return {
    stop_reason: "tool_use",
    usage: { input_tokens: 10, output_tokens: 5 },
    content: calls.map((c) => ({ type: "tool_use", id: c.id, name: c.name, input: c.input })),
    ...overrides,
  };
}

// agent.ts mutates and reuses the same `messages` array across rounds, so
// inspecting `createMock.mock.calls[i][0].messages` after the fact reflects the
// array's FINAL state, not what was actually sent on call i. Snapshot it instead.
function queueResponses(...responses: unknown[]): any[] {
  const captured: any[] = [];
  for (const response of responses) {
    createMock.mockImplementationOnce(async (params: any) => {
      captured.push(JSON.parse(JSON.stringify(params)));
      return response;
    });
  }
  return captured;
}

function alternatingHistory(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: `msg-${i}`,
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  getHistoryMock.mockReturnValue([]);
});

// Orchestration mechanics of runAgent: the tool-calling loop, its safety valves
// (max rounds / max_tokens), and session-history bookkeeping. The Anthropic SDK
// and tool handlers are mocked, so these run instantly with no API cost and
// don't assert on anything the model actually says — see agent.behavioral.test.ts
// for tests that check the agent surfaces the right information.
describe("runAgent (technical)", () => {
  it("1. returns the model's text reply when it answers without a tool call", async () => {
    createMock.mockResolvedValueOnce(textResponse("Your flight is on time."));

    const reply = await runAgent("s1", "what's my status", "DM321", "2026-11-05", "on_time");

    expect(reply).toBe("Your flight is on time.");
  });

  it("2. sends prior session history plus the new user message to the model", async () => {
    const history = alternatingHistory(2); // [user, assistant]
    getHistoryMock.mockReturnValue(history);
    const calls = queueResponses(textResponse("ok"));

    await runAgent("s2", "follow up", "DM321", "2026-11-05", "on_time");

    expect(calls[0].messages).toEqual([...history, { role: "user", content: "follow up" }]);
  });

  it("3. persists the full turn (user + assistant) to session history on completion", async () => {
    createMock.mockResolvedValueOnce(textResponse("Got it."));

    await runAgent("s3", "hello", "DM321", "2026-11-05", "on_time");

    const [sessionId, saved] = saveHistoryMock.mock.calls[0];
    expect(sessionId).toBe("s3");
    expect(saved).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: [{ type: "text", text: "Got it." }] },
    ]);
  });

  it("4. calls the right tool handler with its input, then returns the next round's final text", async () => {
    getFlightStatusesMock.mockReturnValue({ status: "cancelled" });
    createMock
      .mockResolvedValueOnce(
        toolUseResponse([{ id: "tu_1", name: "get_flight_statuses", input: { flight_number: "DM321" } }])
      )
      .mockResolvedValueOnce(textResponse("Your flight was cancelled."));

    const reply = await runAgent("s4", "status?", "DM321", "2026-11-05", "on_time");

    expect(getFlightStatusesMock).toHaveBeenCalledWith({ flight_number: "DM321" });
    expect(createMock).toHaveBeenCalledTimes(2);
    expect(reply).toBe("Your flight was cancelled.");
  });

  it("5. runs every parallel tool_use block in a round, not just the first", async () => {
    getFlightStatusesMock.mockReturnValue({ status: "on_time" });
    findAlternativesMock.mockReturnValue([{ flight_number: "DM323" }]);
    const calls = queueResponses(
      toolUseResponse([
        { id: "tu_1", name: "get_flight_statuses", input: { flight_number: "DM321" } },
        { id: "tu_2", name: "find_alternatives", input: { flight_number: "DM321" } },
      ]),
      textResponse("here are your options")
    );

    await runAgent("s5", "alternatives?", "DM321", "2026-11-05", "on_time");

    const secondCallMessages = calls[1].messages;
    const toolResults = secondCallMessages[secondCallMessages.length - 1].content;
    expect(toolResults.map((r: any) => r.tool_use_id)).toEqual(["tu_1", "tu_2"]);
    expect(getFlightStatusesMock).toHaveBeenCalledTimes(1);
    expect(findAlternativesMock).toHaveBeenCalledTimes(1);
  });

  it("6. an unrecognized tool name doesn't crash the loop, it returns an error tool_result", async () => {
    const calls = queueResponses(
      toolUseResponse([{ id: "tu_1", name: "not_a_real_tool", input: {} }]),
      textResponse("done")
    );

    const reply = await runAgent("s6", "hi", "DM321", "2026-11-05", "on_time");

    const secondCallMessages = calls[1].messages;
    const toolResult = secondCallMessages[secondCallMessages.length - 1].content[0];
    expect(JSON.parse(toolResult.content)).toEqual({ error: "Unknown tool: not_a_real_tool" });
    expect(reply).toBe("done");
  });

  it("7. gives up after MAX_TOOL_ROUNDS and does not persist the abandoned turn", async () => {
    getFlightStatusesMock.mockReturnValue({ status: "on_time" });
    createMock.mockResolvedValue(
      toolUseResponse([{ id: "tu_x", name: "get_flight_statuses", input: {} }])
    );

    const reply = await runAgent("s7", "loop forever", "DM321", "2026-11-05", "on_time");

    expect(createMock).toHaveBeenCalledTimes(MAX_TOOL_ROUNDS);
    expect(reply).toBe("I wasn't able to finish processing that request. Please try again.");
    expect(saveHistoryMock).not.toHaveBeenCalled();
  });

  it("8. a max_tokens truncation returns a canned reply and does not persist history", async () => {
    createMock.mockResolvedValueOnce(textResponse("", { stop_reason: "max_tokens" }));

    const reply = await runAgent("s8", "tell me everything", "DM321", "2026-11-05", "on_time");

    expect(reply).toBe("I wasn't able to finish that response. Could you ask again, maybe a bit more specifically?");
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(saveHistoryMock).not.toHaveBeenCalled();
  });

  it("9. records token usage per model call, keyed by the uppercased booking number", async () => {
    getFlightStatusesMock.mockReturnValue({ status: "on_time" });
    createMock
      .mockResolvedValueOnce(
        toolUseResponse([{ id: "tu_1", name: "get_flight_statuses", input: {} }], {
          usage: { input_tokens: 10, output_tokens: 5 },
        })
      )
      .mockResolvedValueOnce(textResponse("ok", { usage: { input_tokens: 20, output_tokens: 8 } }));

    await runAgent("s9", "status?", "dm321", "2026-11-05", "on_time");

    expect(recordUsageMock).toHaveBeenCalledTimes(2);
    expect(recordUsageMock).toHaveBeenNthCalledWith(1, "DM321", 15);
    expect(recordUsageMock).toHaveBeenNthCalledWith(2, "DM321", 28);
  });

  it("10. trims saved history to the last MAX_HISTORY_MESSAGES entries, still starting with 'user'", async () => {
    getHistoryMock.mockReturnValue(alternatingHistory(MAX_HISTORY_MESSAGES)); // already at the cap
    createMock.mockResolvedValueOnce(textResponse("ok"));

    await runAgent("s10", "one more", "DM321", "2026-11-05", "on_time");

    const saved = saveHistoryMock.mock.calls[0][1];
    expect(saved).toHaveLength(MAX_HISTORY_MESSAGES);
    expect(saved[0]).toEqual({ role: "user", content: "msg-2" }); // oldest pair dropped
    expect(saved[0].role).toBe("user");
  });
});
