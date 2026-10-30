import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ApiError, sendChatMessage } from "../lib/api";
import type { Flight } from "../types/flight";
import type { ChatMessage } from "../types/chat";
import "./ChatWidget.css";

interface ChatWidgetProps {
  flight: Flight;
  onClose: () => void;
}

function sessionStorageKey(bookingNumber: string, date: string): string {
  return `flight-assistant:session:${bookingNumber}:${date}`;
}

function newId(): string {
  return crypto.randomUUID();
}

function formatResetTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function renderFormattedText(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") && part.length >= 4 ? (
      <strong key={i}>{part.slice(2, -2)}</strong>
    ) : (
      part
    )
  );
}

export function ChatWidget({ flight, onClose }: ChatWidgetProps) {
  const bookingNumber = flight.flight_number;
  const date = flight.date;

  const [sessionId, setSessionId] = useState<string | undefined>(() =>
    sessionStorage.getItem(sessionStorageKey(bookingNumber, date)) ?? undefined
  );
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: newId(),
      role: "agent",
      text: `Hi! I'm your flight assistant. Ask me anything about flight ${bookingNumber} on ${date}.`,
    },
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [limitResetAt, setLimitResetAt] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [input]);

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      e.currentTarget.form?.requestSubmit();
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || sending || limitResetAt) return;

    setMessages((prev) => [...prev, { id: newId(), role: "customer", text }]);
    setInput("");
    setSending(true);

    try {
      const result = await sendChatMessage(text, bookingNumber, date, sessionId);
      setSessionId(result.session_id);
      sessionStorage.setItem(sessionStorageKey(bookingNumber, date), result.session_id);
      setMessages((prev) => [...prev, { id: newId(), role: "agent", text: result.reply }]);
    } catch (err) {
      if (err instanceof ApiError && err.resetAt) {
        setLimitResetAt(err.resetAt);
        setMessages((prev) => [
          ...prev,
          { id: newId(), role: "system", text: `${err.message} You can ask again on ${formatResetTime(err.resetAt!)}.` },
        ]);
      } else {
        const text = err instanceof ApiError ? err.message : "Something went wrong. Please try again.";
        setMessages((prev) => [...prev, { id: newId(), role: "system", text }]);
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="chat-widget" role="dialog" aria-label={`Chat about flight ${bookingNumber}`}>
      <header className="chat-widget-header">
        <div>
          <strong>Flight Assistant</strong>
          <span className="chat-widget-subtitle">
            {bookingNumber} · {date}
          </span>
        </div>
        <button type="button" className="chat-widget-close" onClick={onClose} aria-label="Close chat">
          ×
        </button>
      </header>

      <div className="chat-widget-messages">
        {messages.map((msg) => (
          <div key={msg.id} className={`chat-bubble chat-bubble-${msg.role}`}>
            {renderFormattedText(msg.text)}
          </div>
        ))}
        {sending && <div className="chat-bubble chat-bubble-agent chat-bubble-pending">…</div>}
        <div ref={messagesEndRef} />
      </div>

      <form className="chat-widget-input" onSubmit={handleSubmit}>
        <textarea
          ref={textareaRef}
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={limitResetAt ? `Usage limit reached — try again on ${formatResetTime(limitResetAt)}` : "Type a message…"}
          disabled={sending || !!limitResetAt}
          autoComplete="off"
        />
        <button type="submit" disabled={sending || !!limitResetAt || !input.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
