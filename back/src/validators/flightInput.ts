const FLIGHT_NUMBER_PATTERN = /^[0-9a-zA-Z]+$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isValidFlightNumber(value: string): boolean {
  return FLIGHT_NUMBER_PATTERN.test(value);
}

export function isValidDateFormat(value: string): boolean {
  return DATE_PATTERN.test(value);
}
