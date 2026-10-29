import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import { flightsRepository, Flight } from "../../repositories/flightsRepository";
import { policiesRepository, FareClassId, FareClassPolicy } from "../../repositories/policiesRepository";
import { isValidFlightNumber, isValidDateFormat } from "../../validators/flightInput";
import { getBookableAlternatives } from "./findAlternatives";

export interface PolicyCheckInput {
  flight_number: string;
  date?: string;
  fare_class?: FareClassId;
  alternative_flight_number?: string;
  alternative_date?: string;
}

interface RebookingVerdict {
  alternative_flight_number: string;
  verdict: "free" | "fee" | "not_eligible";
  fee?: number;
  message: string;
}

interface PolicyCheckResult {
  flight_number: string;
  date: string;
  status: string;
  disruption_reason: string | null;
  handoff_message?: string;
  entitlements: {
    meal_voucher: { eligible: boolean; amount: number };
    hotel_night: { eligible: boolean };
    refund: { eligible: boolean };
    compensation: { eligible: boolean; amount: number | null };
  };
  rebooking?: RebookingVerdict;
}

export type PolicyCheckOutput = PolicyCheckResult | { error: string };

const FARE_CLASS_IDS = Object.keys(
  policiesRepository.getFareClasses()
) as FareClassId[];

export const policyCheckTool: Tool = {
  name: "policy_check",
  description:
    "Check what DemoAir's rebooking and passenger-rights policy entitles a passenger to for a " +
    "given flight: meal voucher, hotel night, refund, and cash compensation eligibility. " +
    "Optionally, pass `alternative_flight_number` (and the passenger's `fare_class`) to also get " +
    "the rebooking verdict for that specific alternative — whether it's free, has a fee, or is " +
    "not eligible. If the flight number has departures on multiple dates, pass `date` to disambiguate.",
  input_schema: {
    type: "object",
    properties: {
      flight_number: {
        type: "string",
        description: "The passenger's original (disrupted) flight number, e.g. \"DM321\".",
      },
      date: {
        type: "string",
        description: "Date of the original flight, in YYYY-MM-DD format.",
      },
      fare_class: {
        type: "string",
        enum: FARE_CLASS_IDS,
        description:
          "The passenger's fare class. Required only when checking a specific alternative's " +
          "rebooking fee/eligibility.",
      },
      alternative_flight_number: {
        type: "string",
        description: "An alternative flight number to check rebooking eligibility for, e.g. \"DM323\".",
      },
      alternative_date: {
        type: "string",
        description: "Date of the alternative flight, in YYYY-MM-DD format.",
      },
    },
    required: ["flight_number"],
  },
};

export function policyCheck(input: PolicyCheckInput): PolicyCheckOutput {
  const {
    flight_number: flightNumber,
    date,
    fare_class: fareClass,
    alternative_flight_number: altFlightNumber,
    alternative_date: altDate,
  } = input;

  if (!isValidFlightNumber(flightNumber)) {
    return { error: "Flight number must contain only letters and digits" };
  }
  if (date !== undefined && !isValidDateFormat(date)) {
    return { error: "Date must be in YYYY-MM-DD format" };
  }

  const original = resolveFlight(flightNumber, date);
  if ("error" in original) return original;

  const disruptionTypes = policiesRepository.getDisruptionTypes();

  if (original.status === "diverted") {
    return {
      flight_number: original.flight_number,
      date: original.date,
      status: original.status,
      disruption_reason: original.disruption_reason,
      handoff_message: disruptionTypes.diverted?.handoff_message,
      entitlements: {
        meal_voucher: { eligible: false, amount: 0 },
        hotel_night: { eligible: false },
        refund: { eligible: false },
        compensation: { eligible: false, amount: null },
      },
    };
  }

  const bookableAlternatives = getBookableAlternatives(original);
  const entitlements = computeEntitlements(original, bookableAlternatives);

  const result: PolicyCheckResult = {
    flight_number: original.flight_number,
    date: original.date,
    status: original.status,
    disruption_reason: original.disruption_reason,
    entitlements,
  };

  if (altFlightNumber !== undefined) {
    if (!isValidFlightNumber(altFlightNumber)) {
      return { error: "Alternative flight number must contain only letters and digits" };
    }
    if (altDate !== undefined && !isValidDateFormat(altDate)) {
      return { error: "Alternative date must be in YYYY-MM-DD format" };
    }
    if (fareClass === undefined) {
      return { error: "fare_class is required to check rebooking eligibility for an alternative" };
    }
    if (!FARE_CLASS_IDS.includes(fareClass)) {
      return { error: `fare_class must be one of: ${FARE_CLASS_IDS.join(", ")}` };
    }

    const alternative = resolveFlight(altFlightNumber, altDate);
    if ("error" in alternative) return alternative;

    result.rebooking = {
      alternative_flight_number: alternative.flight_number,
      ...computeRebookingVerdict(original, alternative, fareClass),
    };
  }

  return result;
}

function resolveFlight(flightNumber: string, date?: string): Flight | { error: string } {
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
  return matches[0];
}

function computeEntitlements(original: Flight, bookableAlternatives: Flight[]) {
  const entitlements = policiesRepository.getEntitlements();
  const { airline_controlled } = policiesRepository.getDisruptionReasons();

  const waitMinutes = computeWaitMinutes(original, bookableAlternatives);

  const mealVoucher = computeMealVoucher(original, waitMinutes, entitlements.meal_voucher);
  const hotelNight = computeHotelNight(original, bookableAlternatives, entitlements.hotel_night);
  const refund = computeRefund(original, entitlements.refund.min_delay_minutes);
  const compensation = computeCompensation(
    original,
    entitlements.compensation,
    airline_controlled
  );

  return {
    meal_voucher: mealVoucher,
    hotel_night: hotelNight,
    refund,
    compensation,
  };
}

function computeWaitMinutes(original: Flight, bookableAlternatives: Flight[]): number | null {
  if (original.status === "delayed") return original.delay_minutes;

  if (original.status === "cancelled") {
    if (bookableAlternatives.length === 0) return null;
    const earliest = bookableAlternatives[0];
    const diffMs =
      new Date(earliest.scheduled_departure).getTime() -
      new Date(original.scheduled_departure).getTime();
    return Math.round(diffMs / 60000);
  }

  return null;
}

function computeMealVoucher(
  original: Flight,
  waitMinutes: number | null,
  policy: { applies_to: string[]; tiers: { min_wait_minutes: number; amount: number }[] }
): { eligible: boolean; amount: number } {
  if (!policy.applies_to.includes(original.status) || waitMinutes === null) {
    return { eligible: false, amount: 0 };
  }

  const tier = [...policy.tiers]
    .sort((a, b) => b.min_wait_minutes - a.min_wait_minutes)
    .find((t) => waitMinutes >= t.min_wait_minutes);

  return tier ? { eligible: true, amount: tier.amount } : { eligible: false, amount: 0 };
}

function computeHotelNight(
  original: Flight,
  bookableAlternatives: Flight[],
  policy: { applies_to: string[] }
): { eligible: boolean } {
  if (!policy.applies_to.includes(original.status) || bookableAlternatives.length === 0) {
    return { eligible: false };
  }
  const earliest = bookableAlternatives[0];
  return { eligible: earliest.date > original.date };
}

function computeRefund(original: Flight, minDelayMinutes: number): { eligible: boolean } {
  if (original.status === "cancelled") return { eligible: true };
  if (original.status === "delayed" && original.delay_minutes >= minDelayMinutes) {
    return { eligible: true };
  }
  return { eligible: false };
}

function computeCompensation(
  original: Flight,
  policy: { min_delay_minutes: number; bands_by_distance_km: { max_km: number | null; amount: number }[] },
  airlineControlledReasons: string[]
): { eligible: boolean; amount: number | null } {
  const isAirlineControlled =
    original.disruption_reason !== null &&
    airlineControlledReasons.includes(original.disruption_reason);

  if (!isAirlineControlled) return { eligible: false, amount: null };

  const qualifies =
    original.status === "cancelled" ||
    (original.status === "delayed" && original.delay_minutes >= policy.min_delay_minutes);

  if (!qualifies) return { eligible: false, amount: null };

  const distanceKm = policiesRepository.getRouteDistanceKm(
    original.origin.code,
    original.destination.code
  );
  if (distanceKm === null) return { eligible: true, amount: null };

  const sortedBands = [...policy.bands_by_distance_km].sort((a, b) => {
    if (a.max_km === null) return 1;
    if (b.max_km === null) return -1;
    return a.max_km - b.max_km;
  });
  const band = sortedBands.find((b) => b.max_km === null || distanceKm <= b.max_km);

  return { eligible: true, amount: band ? band.amount : null };
}

function computeRebookingVerdict(
  original: Flight,
  alternative: Flight,
  fareClassId: FareClassId
): Omit<RebookingVerdict, "alternative_flight_number"> {
  const general = policiesRepository.getGeneralPolicy();
  const fare = policiesRepository.getFareClasses()[fareClassId];

  if (!general.bookable_alternative_statuses.includes(alternative.status)) {
    return { verdict: "not_eligible", message: "This flight is not open for booking." };
  }

  if (
    alternative.origin.code !== original.origin.code ||
    alternative.destination.code !== original.destination.code
  ) {
    return { verdict: "not_eligible", message: "Rebooking is only possible on the same route." };
  }

  const originalDeparture = new Date(original.scheduled_departure).getTime();
  const altDeparture = new Date(alternative.scheduled_departure).getTime();
  const windowEnd = originalDeparture + general.rebooking_window_hours * 60 * 60 * 1000;

  if (altDeparture < originalDeparture || altDeparture > windowEnd) {
    return {
      verdict: "not_eligible",
      message: `This flight is outside the ${general.rebooking_window_hours}-hour rebooking window.`,
    };
  }

  const hasOwnCabinSeats = alternative.seats_left[fare.cabin] > 0;
  const hasBusinessSeats = alternative.seats_left.business > 0;

  if (!hasOwnCabinSeats && !hasBusinessSeats) {
    return { verdict: "not_eligible", message: "This flight is sold out." };
  }

  const disrupted =
    original.status === "cancelled" ||
    (original.status === "delayed" && original.delay_minutes >= general.significant_delay_minutes);

  if (hasOwnCabinSeats) {
    if (disrupted) {
      return {
        verdict: "free",
        fee: 0,
        message: `Free rebooking because your original flight was ${original.status}.`,
      };
    }
    return voluntaryChangeVerdict(fare);
  }

  return upgradeOnlyVerdict(fare);
}

function voluntaryChangeVerdict(
  fare: FareClassPolicy
): Omit<RebookingVerdict, "alternative_flight_number"> {
  switch (fare.voluntary_change) {
    case "free":
      return { verdict: "free", fee: 0, message: `Free change, included in your ${fare.name} fare.` };
    case "fee":
      return {
        verdict: "fee",
        fee: fare.change_fee ?? 0,
        message: `Change fee of ${fare.change_fee} USD under your ${fare.name} fare.`,
      };
    default:
      return {
        verdict: "not_eligible",
        message: `Your ${fare.name} fare does not allow changes for this delay.`,
      };
  }
}

function upgradeOnlyVerdict(
  fare: FareClassPolicy
): Omit<RebookingVerdict, "alternative_flight_number"> {
  switch (fare.upgrade_to_business) {
    case "fee":
      return {
        verdict: "fee",
        fee: fare.upgrade_fee ?? 0,
        message: `Only business seats are left. Upgrade fee of ${fare.upgrade_fee} USD under your ${fare.name} fare.`,
      };
    default:
      return {
        verdict: "not_eligible",
        message: `Only business seats are left, and your ${fare.name} fare cannot be upgraded.`,
      };
  }
}
