import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ApiError, sendChatMessage } from "../lib/api";
import type { Flight } from "../types/flight";
import type { ChatMessage } from "../types/chat";
import "./ChatWidget.css";

interface ChatWidgetProps {
  flight: Flight;
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

const REVEAL_TICK_MS = 20;
const REVEAL_TOTAL_TICKS = 40;

function renderFormattedText(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") && part.length >= 4 ? (
      <strong key={i}>{part.slice(2, -2)}</strong>
    ) : (
      part
    )
  );
}

export function ChatWidget({ flight }: ChatWidgetProps) {
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
  const [minimized, setMinimized] = useState(false);
  const [unread, setUnread] = useState(0);
  const [revealingId, setRevealingId] = useState<string | null>(null);
  const [revealedLength, setRevealedLength] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pillRef = useRef<HTMLButtonElement>(null);
  const widgetRef = useRef<HTMLDivElement>(null);
  const prevMessageCountRef = useRef(messages.length);
  const revealedIdsRef = useRef<Set<string>>(new Set());
  const sendingRef = useRef(false);

  useEffect(() => {
    // "auto" (not "smooth") — this fires on every reveal tick (every 20ms), and
    // restarting a smooth-scroll animation that often makes it stutter instead.
    messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
  }, [messages, revealedLength]);

  useEffect(() => {
    if (!sending && !revealingId && !limitResetAt && !minimized) {
      textareaRef.current?.focus();
    }
  }, [sending, revealingId]);

  useEffect(() => {
    const last = messages[messages.length - 1];
    if (!last || last.role === "customer" || revealedIdsRef.current.has(last.id)) return;

    const chunkSize = Math.max(1, Math.ceil(last.text.length / REVEAL_TOTAL_TICKS));
    setRevealingId(last.id);
    setRevealedLength(0);

    let shown = 0;
    const interval = setInterval(() => {
      shown = Math.min(shown + chunkSize, last.text.length);
      setRevealedLength(shown);
      if (shown >= last.text.length) {
        clearInterval(interval);
        revealedIdsRef.current.add(last.id);
        setRevealingId(null);
      }
    }, REVEAL_TICK_MS);

    return () => clearInterval(interval);
  }, [messages]);

  useEffect(() => {
    if (minimized) {
      pillRef.current?.focus();
    } else {
      textareaRef.current?.focus();
    }
  }, [minimized]);

  useEffect(() => {
    const vv = window.visualViewport;
    const el = widgetRef.current;
    if (!vv || !el || minimized) return;

    function reposition() {
      if (!el || !vv) return;
      const margin = window.innerWidth <= 480 ? 12 : 16;
      el.style.top = `${vv.offsetTop + margin}px`;
      el.style.height = `${vv.height - margin * 2}px`;
    }

    reposition();
    vv.addEventListener("resize", reposition);
    vv.addEventListener("scroll", reposition);
    return () => {
      vv.removeEventListener("resize", reposition);
      vv.removeEventListener("scroll", reposition);
    };
  }, [minimized]);

  useEffect(() => {
    const newCount = messages.length - prevMessageCountRef.current;
    prevMessageCountRef.current = messages.length;
    if (minimized && newCount > 0) {
      const incoming = messages.slice(-newCount).filter((m) => m.role !== "customer").length;
      setUnread((u) => u + incoming);
    }
  }, [messages, minimized]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [input]);

  function handleRestore() {
    setMinimized(false);
    setUnread(0);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      e.currentTarget.form?.requestSubmit();
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || sendingRef.current || limitResetAt || revealingId) return;
    sendingRef.current = true;

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
      sendingRef.current = false;
    }
  }

  if (minimized) {
    return (
      <button
        ref={pillRef}
        type="button"
        className="chat-pill"
        onClick={handleRestore}
        aria-label={`Reopen chat about flight ${bookingNumber}${unread > 0 ? `, ${unread} new message${unread > 1 ? "s" : ""}` : ""}`}
      >
        <span className="chat-pill-label">Flight Assistant</span>
        {unread > 0 && <span className="chat-pill-badge">{unread}</span>}
      </button>
    );
  }

  return (
    <div ref={widgetRef} className="chat-widget" role="dialog" aria-label={`Chat about flight ${bookingNumber}`}>
      <header className="chat-widget-header">
        <svg className="chat-header-avatar" viewBox="0 0 40 40" aria-hidden="true">
          <circle cx="20" cy="20" r="20" fill="var(--accent)" />
          <circle cx="20" cy="16" r="7" fill="#fff" />
          <path d="M6 36c1.5-9 7.8-14 14-14s12.5 5 14 14" fill="#fff" />
        </svg>
        <div>
          <strong>Flight Assistant</strong>
          <span className="chat-widget-subtitle">
            {bookingNumber} · {date}
          </span>
        </div>
        <button type="button" className="chat-widget-close" onClick={() => setMinimized(true)} aria-label="Minimize chat">
          –
        </button>
      </header>

      <div className="chat-widget-messages">
        {messages.map((msg) => (
          <div key={msg.id} className={`chat-bubble chat-bubble-${msg.role}`}>
            {renderFormattedText(msg.id === revealingId ? msg.text.slice(0, revealedLength) : msg.text)}
          </div>
        ))}
        {sending && (
          <div className="chat-bubble chat-bubble-agent chat-bubble-pending">
            <span className="pending-plane" aria-hidden="true">
              ✈️
            </span>
            <span className="pending-dots" aria-hidden="true">
              <span></span>
              <span></span>
              <span></span>
            </span>
            <span className="sr-only">Agent is typing…</span>
          </div>
        )}
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
          disabled={sending || !!limitResetAt || !!revealingId}
          autoComplete="off"
        />
        <button type="submit" disabled={sending || !!limitResetAt || !!revealingId || !input.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
