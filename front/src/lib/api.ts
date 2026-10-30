import type { Flight } from "../types/flight";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL

export class ApiError extends Error {
  resetAt?: string;

  constructor(message: string, resetAt?: string) {
    super(message);
    this.resetAt = resetAt;
  }
}

async function toApiError(res: Response): Promise<ApiError> {
  try {
    const body = await res.json();
    const message = typeof body?.error === "string" ? body.error : `Request failed with status ${res.status}`;
    const resetAt = typeof body?.reset_at === "string" ? body.reset_at : undefined;
    return new ApiError(message, resetAt);
  } catch {
    return new ApiError(`Request failed with status ${res.status}`);
  }
}

export async function fetchFlight(flightNumber: string, date?: string): Promise<Flight | Flight[]> {
  const url = new URL(`${API_BASE_URL}/flight/${encodeURIComponent(flightNumber)}`);
  if (date) url.searchParams.set("date", date);

  const res = await fetch(url);
  if (!res.ok) throw await toApiError(res);
  return res.json();
}

export interface ChatReply {
  reply: string;
  session_id: string;
}

export async function sendChatMessage(
  message: string,
  bookingNumber: string,
  date: string,
  sessionId?: string
): Promise<ChatReply> {
  const res = await fetch(`${API_BASE_URL}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, booking_number: bookingNumber, date, session_id: sessionId }),
  });
  if (!res.ok) throw await toApiError(res);
  return res.json();
}
