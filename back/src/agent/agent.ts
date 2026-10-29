import Anthropic from "@anthropic-ai/sdk";
import type {
  ContentBlock,
  ContentBlockParam,
  MessageParam,
  TextBlock,
} from "@anthropic-ai/sdk/resources/messages";
import { tools, toolHandlers } from "./tools";
import { getHistory, saveHistory } from "./sessionStore";
import { recordUsage } from "./tokenUsageTracker";

const anthropic = new Anthropic();

const MODEL = "claude-haiku-4-5";
const MAX_TOKENS = 1024;
const MAX_TOOL_ROUNDS = 5;
const MAX_HISTORY_MESSAGES = 20; // kept even so slicing preserves user/assistant alternation

function buildSystemPrompt(bookingNumber: string, date: string, status: string): string {
  return (
    "You are a flight disruption assistant for DemoAir. Use the available tools to look up " +
    "flight statuses, find rebooking alternatives, and check policy entitlements. Answer the " +
    "passenger's question clearly and concisely based on the tool results. If a tool returns " +
    "an error, relay the issue to the passenger in plain language instead of guessing.\n\n" +
    "You are informational only, not operational: you can look up flights, alternatives, and " +
    "entitlements, but you cannot book, cancel, modify, or otherwise change any flight or " +
    "reservation. Never say or imply that you've booked, cancelled, or changed anything. If the " +
    "passenger asks you to actually perform one of these actions, tell them you can't do it and " +
    "point them to the airline's booking channel or a human agent instead.\n\n" +
    `The passenger is already identified by booking number "${bookingNumber}", which is their ` +
    `flight number, on "${date}", and their flight's current status is already known to be ` +
    `"${status}". You already know all three — never ask the passenger for their flight number, ` +
    "date, or status. Use the booking number and date as the flight_number and date arguments for " +
    "tools unless the passenger explicitly asks about a different flight. You may still call " +
    "get_flight_statuses for details beyond the status itself (e.g. gate, delay minutes, " +
    "disruption reason)."
  );
}

export async function runAgent(
  sessionId: string,
  userMessage: string,
  bookingNumber: string,
  date: string,
  status: string
): Promise<string> {
  const history = getHistory(sessionId);
  const messages: MessageParam[] = [...history, { role: "user", content: userMessage }];
  const systemPrompt = buildSystemPrompt(bookingNumber, date, status);

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      tools,
      messages,
    });

    console.log(`[agent] session=${sessionId} round=${round} stop_reason=${response.stop_reason}`);

    recordUsage(bookingNumber.toUpperCase(), response.usage.input_tokens + response.usage.output_tokens);

    if (response.stop_reason !== "tool_use") {
      messages.push({ role: "assistant", content: response.content });
      saveHistory(sessionId, trimHistory(messages));

      const reply = extractText(response.content);
      console.log(`[agent] reply=${JSON.stringify(reply)}`);
      return reply;
    }

    messages.push({ role: "assistant", content: response.content });
    messages.push({ role: "user", content: runTools(response.content) });
  }

  // Gave up mid tool-use loop — don't persist the dangling round, so the next
  // turn resumes cleanly from the last known-good history instead of a broken one.
  console.log("[agent] gave up after max tool rounds");
  return "I wasn't able to finish processing that request. Please try again.";
}

function trimHistory(messages: MessageParam[]): MessageParam[] {
  return messages.length > MAX_HISTORY_MESSAGES
    ? messages.slice(-MAX_HISTORY_MESSAGES)
    : messages;
}

function runTools(content: ContentBlock[]): ContentBlockParam[] {
  return content
    .filter((block) => block.type === "tool_use")
    .map((block) => {
      console.log(`[agent] tool_call name=${block.name} input=${JSON.stringify(block.input)}`);

      const handler = toolHandlers[block.name];
      const result = handler
        ? handler(block.input)
        : { error: `Unknown tool: ${block.name}` };

      console.log(`[agent] tool_result name=${block.name} result=${JSON.stringify(result)}`);

      return {
        type: "tool_result",
        tool_use_id: block.id,
        content: JSON.stringify(result),
      };
    });
}

function extractText(content: ContentBlock[]): string {
  return content
    .filter((block): block is TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}
