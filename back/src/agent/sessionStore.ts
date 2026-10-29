import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";

interface Session {
  messages: MessageParam[];
  lastAccessedAt: number;
}

const SESSION_TTL_MS = 60 * 60 * 1000; // evict sessions idle for over an hour
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;

const sessions = new Map<string, Session>();

export function getHistory(sessionId: string): MessageParam[] {
  const session = sessions.get(sessionId);
  return session ? session.messages : [];
}

export function saveHistory(sessionId: string, messages: MessageParam[]): void {
  sessions.set(sessionId, { messages, lastAccessedAt: Date.now() });
}

function sweep(): void {
  const now = Date.now();
  for (const [sessionId, session] of sessions) {
    if (now - session.lastAccessedAt > SESSION_TTL_MS) {
      sessions.delete(sessionId);
    }
  }
}

setInterval(sweep, SWEEP_INTERVAL_MS).unref();
