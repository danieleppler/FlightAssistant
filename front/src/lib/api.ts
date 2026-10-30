import type { Flight } from "../types/flight";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL

export class ApiError extends Error { }

async function readError(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (typeof body?.error === "string") return body.error;
  } catch {
    // body wasn't JSON; fall through to a generic message
  }
  return `Request failed with status ${res.status}`;
}

export async function fetchFlight(flightNumber: string, date?: string): Promise<Flight | Flight[]> {
  const url = new URL(`${API_BASE_URL}/flight/${encodeURIComponent(flightNumber)}`);
  if (date) url.searchParams.set("date", date);

  const res = await fetch(url);
  if (!res.ok) throw new ApiError(await readError(res));
  return res.json();
}
