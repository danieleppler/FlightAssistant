import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import { flightsRepository, Flight } from "../../repositories/flightsRepository";
import { isValidFlightNumber, isValidDateFormat } from "../../validators/flightInput";

export interface GetFlightStatusesInput {
  flight_number: string;
  date?: string;
}

export type GetFlightStatusesResult = Flight | Flight[] | { error: string };

export const getFlightStatusesTool: Tool = {
  name: "get_flight_statuses",
  description:
    "Look up the current status of a flight by its flight number (e.g. DM321), " +
    "such as whether it's on time, delayed, cancelled, boarding, departed, landed, or diverted. " +
    "If the flight number has departures on multiple dates, pass `date` to disambiguate; " +
    "omitting it returns every matching date.",
  input_schema: {
    type: "object",
    properties: {
      flight_number: {
        type: "string",
        description: "The flight number to look up, e.g. \"DM321\".",
      },
      date: {
        type: "string",
        description: "Optional date to disambiguate, in YYYY-MM-DD format.",
      },
    },
    required: ["flight_number"],
  },
};

export function getFlightStatuses(
  input: GetFlightStatusesInput
): GetFlightStatusesResult {
  const { flight_number: flightNumber, date } = input;

  if (!isValidFlightNumber(flightNumber)) {
    return { error: "Flight number must contain only letters and digits" };
  }

  if (date !== undefined && !isValidDateFormat(date)) {
    return { error: "Date must be in YYYY-MM-DD format" };
  }

  const flights = flightsRepository.findByFlightNumber(flightNumber, date);

  if (flights.length === 0) {
    const suffix = date ? ` on ${date}` : "";
    return { error: `Flight ${flightNumber.toUpperCase()} not found${suffix}` };
  }

  return flights.length === 1 ? flights[0] : flights;
}
