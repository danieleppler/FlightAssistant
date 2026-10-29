import Anthropic from "@anthropic-ai/sdk";
import type {
  ContentBlock,
  ContentBlockParam,
  MessageParam,
  TextBlock,
} from "@anthropic-ai/sdk/resources/messages";
import { tools, toolHandlers } from "./tools";

const anthropic = new Anthropic();

const MODEL = "claude-sonnet-5-5";
const MAX_TOKENS = 1024;
const MAX_TOOL_ROUNDS = 5;

const SYSTEM_PROMPT =
  "You are a flight disruption assistant for DemoAir. Use the available tools to look up " +
  "flight statuses and find rebooking alternatives. Answer the passenger's question clearly " +
  "and concisely based on the tool results. If a tool returns an error, relay the issue to the " +
  "passenger in plain language instead of guessing.";

export async function runAgent(userMessage: string): Promise<string> {
  const messages: MessageParam[] = [{ role: "user", content: userMessage }];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      tools,
      messages,
    });

    if (response.stop_reason !== "tool_use") {
      return extractText(response.content);
    }

    messages.push({ role: "assistant", content: response.content });
    messages.push({ role: "user", content: runTools(response.content) });
  }

  return "I wasn't able to finish processing that request. Please try again.";
}

function runTools(content: ContentBlock[]): ContentBlockParam[] {
  return content
    .filter((block) => block.type === "tool_use")
    .map((block) => {
      const handler = toolHandlers[block.name];
      const result = handler
        ? handler(block.input)
        : { error: `Unknown tool: ${block.name}` };

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
