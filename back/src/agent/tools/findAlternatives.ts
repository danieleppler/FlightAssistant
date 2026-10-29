import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import { flightsRepository, Flight } from "../../repositories/flightsRepository";
import { policiesRepository } from "../../repositories/policiesRepository";
import { isValidFlightNumber, isValidDateFormat } from "../../validators/flightInput";

export interface FindAlternativesInput {
  flight_number: string;
  date?: string;
}

export type FindAlternativesResult = Flight[] | { error: string };

export const findAlternativesTool: Tool = {
  name: "find_alternatives",
  description:
    "Find bookable alternative flights on the same route as a given flight, within the airline's " +
    "rebooking window. Only returns flights that are open for booking (on_time or delayed), depart " +
    "no earlier than the original flight and no later than the rebooking window allows, have seats " +
    "left in some cabin, and are not the original flight itself. Use this after identifying a " +
    "disrupted flight to offer the passenger rebooking options. If the flight number has departures " +
    "on multiple dates, pass `date` to identify which one is disrupted.",
  input_schema: {
    type: "object",
    properties: {
      flight_number: {
        type: "string",
        description: "The original flight's number, e.g. \"DM321\".",
      },
      date: {
        type: "string",
        description: "Date of the original flight, in YYYY-MM-DD format.",
      },
    },
    required: ["flight_number"],
  },
};

export function findAlternatives(
  input: FindAlternativesInput
): FindAlternativesResult {
  const { flight_number: flightNumber, date } = input;

  if (!isValidFlightNumber(flightNumber)) {
    return { error: "Flight number must contain only letters and digits" };
  }

  if (date !== undefined && !isValidDateFormat(date)) {
    return { error: "Date must be in YYYY-MM-DD format" };
  }

  const matches = flightsRepository.findByFlightNumber(flightNumber, date);

  if (matches.length === 0) {
    const suffix = date ? ` on ${date}` : "";
    return { error: `Flight ${flightNumber.toUpperCase()} not found${suffix}` };
  }

  if (matches.length > 1) {
    return {
      error: `Multiple flights found for ${flightNumber.toUpperCase()}; specify a date to disambiguate`,
    };
  }

  const original = matches[0];
  const { bookable_alternative_statuses, rebooking_window_hours } =
    policiesRepository.getGeneralPolicy();

  const originalDeparture = new Date(original.scheduled_departure).getTime();
  const windowEnd = originalDeparture + rebooking_window_hours * 60 * 60 * 1000;

  const alternatives = flightsRepository
    .findByRoute(original.origin.code, original.destination.code)
    .filter((f) => {
      if (f.id === original.id) return false;
      if (!bookable_alternative_statuses.includes(f.status)) return false;
      const departure = new Date(f.scheduled_departure).getTime();
      if (departure < originalDeparture || departure > windowEnd) return false;
      return f.seats_left.economy > 0 || f.seats_left.business > 0;
    })
    .sort(
      (a, b) =>
        new Date(a.scheduled_departure).getTime() -
        new Date(b.scheduled_departure).getTime()
    );

  if (alternatives.length === 0) {
    return {
      error: `No bookable alternatives found for ${original.flight_number} on the ${original.origin.code}-${original.destination.code} route within the rebooking window`,
    };
  }

  return alternatives;
}
