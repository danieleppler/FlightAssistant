const FLIGHT_NUMBER_PATTERN = /^[0-9a-zA-Z]+$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const FLIGHT_STATUSES = [
  "on_time",
  "delayed",
  "cancelled",
  "boarding",
  "departed",
  "landed",
  "diverted",
] as const;

export type FlightStatus = (typeof FLIGHT_STATUSES)[number];

export function isValidFlightNumber(value: string): boolean {
  return FLIGHT_NUMBER_PATTERN.test(value);
}

export function isValidDateFormat(value: string): boolean {
  return DATE_PATTERN.test(value);
}

export function isValidFlightStatus(value: string): value is FlightStatus {
  return (FLIGHT_STATUSES as readonly string[]).includes(value);
}
