import { useState, type FormEvent } from "react";
import { ApiError, fetchFlight } from "../lib/api";
import type { Flight } from "../types/flight";
import "./FlightLookup.css";

const FLIGHT_NUMBER_PATTERN = /^[0-9a-zA-Z]+$/;

interface FlightLookupProps {
  onFlightFound?: (flight: Flight, date: string) => void;
}

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString(undefined, {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function FlightLookup({ onFlightFound }: FlightLookupProps) {
  const [flightNumber, setFlightNumber] = useState("");
  const [date, setDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flights, setFlights] = useState<Flight[] | null>(null);

  const trimmedNumber = flightNumber.trim();
  const isValidNumber = FLIGHT_NUMBER_PATTERN.test(trimmedNumber);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    if (!isValidNumber) {
      setError("Flight number must contain only letters and digits.");
      return;
    }

    setLoading(true);
    setError(null);
    setFlights(null);

    try {
      const result = await fetchFlight(trimmedNumber, date || undefined);
      const list = Array.isArray(result) ? result : [result];
      const latest = list.length > 1 ? [list.reduce((a, b) => (a.date > b.date ? a : b))] : list;
      setFlights(latest);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="flight-lookup">
      <h1>Track your flight</h1>
      <p className="subtitle">Enter your flight number to check its status.</p>

      <form onSubmit={handleSubmit} noValidate>
        <div className="field">
          <label htmlFor="flight-number">Flight number</label>
          <input
            id="flight-number"
            type="text"
            inputMode="text"
            autoComplete="off"
            placeholder="e.g. DM321"
            value={flightNumber}
            onChange={(e) => setFlightNumber(e.target.value)}
            aria-invalid={flightNumber.length > 0 && !isValidNumber}
          />
        </div>

        <div className="field">
          <label htmlFor="flight-date">Date (optional)</label>
          <input
            id="flight-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>

        <button type="submit" className="submit" disabled={!trimmedNumber || loading}>
          {loading ? "Looking up…" : "Check status"}
        </button>
      </form>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {flights && flights.length > 0 && (
        <ul className="results">
          {flights.map((flight) => (
            <li key={flight.id} className="flight-card">
              <div className="flight-card-header">
                <span className="flight-number">{flight.flight_number}</span>
                <span className={`status status-${flight.status}`}>{flight.status.replace("_", " ")}</span>
              </div>
              <div className="route">
                <span>{flight.origin.city} ({flight.origin.code})</span>
                <span className="arrow">→</span>
                <span>{flight.destination.city} ({flight.destination.code})</span>
              </div>
              <div className="times">
                <span>Departs {formatDateTime(flight.estimated_departure ?? flight.scheduled_departure)}</span>
                <span>Arrives {formatDateTime(flight.estimated_arrival ?? flight.scheduled_arrival)}</span>
              </div>
              {flight.disruption_reason && <p className="disruption">{flight.disruption_reason}</p>}

              <button type="button" className="chat-cta" onClick={() => onFlightFound?.(flight, flight.date)}>
                Ask about this flight
              </button>

            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
