import { readFileSync } from "fs";
import { join } from "path";

export interface GeneralPolicy {
  rebooking_window_hours: number;
  same_route_only: boolean;
  bookable_alternative_statuses: string[];
  significant_delay_minutes: number;
  minimum_connection_minutes: number;
}

export type FareClassId = "basic" | "standard" | "flex" | "business";

export interface FareClassPolicy {
  name: string;
  cabin: "economy" | "business";
  voluntary_change: "not_allowed" | "fee" | "free";
  change_fee: number | null;
  upgrade_to_business: "not_allowed" | "fee" | "not_applicable";
  upgrade_fee: number | null;
  voluntary_refund: boolean;
}

export interface DisruptionTypePolicy {
  description: string;
  counts_as_disruption: boolean | string;
  assistant_can_rebook: boolean;
  handoff?: string;
  handoff_message?: string;
}

export interface DisruptionReasonsPolicy {
  airline_controlled: string[];
  extraordinary: string[];
}

export interface CompensationBand {
  max_km: number | null;
  amount: number;
}

export interface EntitlementsPolicy {
  meal_voucher: {
    applies_to: string[];
    tiers: { min_wait_minutes: number; amount: number }[];
  };
  hotel_night: {
    applies_to: string[];
  };
  refund: {
    applies_when: string;
    min_delay_minutes: number;
  };
  compensation: {
    min_delay_minutes: number;
    bands_by_distance_km: CompensationBand[];
  };
}

interface PoliciesData {
  general: GeneralPolicy;
  fare_classes: Record<FareClassId, FareClassPolicy>;
  disruption_types: Record<string, DisruptionTypePolicy>;
  disruption_reasons: DisruptionReasonsPolicy;
  entitlements: EntitlementsPolicy;
  route_distances_km: Record<string, number>;
}

export interface IPoliciesRepository {
  getGeneralPolicy(): GeneralPolicy;
  getFareClasses(): Record<FareClassId, FareClassPolicy>;
  getDisruptionTypes(): Record<string, DisruptionTypePolicy>;
  getDisruptionReasons(): DisruptionReasonsPolicy;
  getEntitlements(): EntitlementsPolicy;
  getRouteDistanceKm(originCode: string, destinationCode: string): number | null;
}

const policiesData: PoliciesData = JSON.parse(
  readFileSync(join(__dirname, "..", "..", "data", "policies.json"), "utf-8")
);

class PoliciesRepository implements IPoliciesRepository {
  getGeneralPolicy(): GeneralPolicy {
    return policiesData.general;
  }

  getFareClasses(): Record<FareClassId, FareClassPolicy> {
    return policiesData.fare_classes;
  }

  getDisruptionTypes(): Record<string, DisruptionTypePolicy> {
    return policiesData.disruption_types;
  }

  getDisruptionReasons(): DisruptionReasonsPolicy {
    return policiesData.disruption_reasons;
  }

  getEntitlements(): EntitlementsPolicy {
    return policiesData.entitlements;
  }

  getRouteDistanceKm(originCode: string, destinationCode: string): number | null {
    const distances = policiesData.route_distances_km;
    return (
      distances[`${originCode}-${destinationCode}`] ??
      distances[`${destinationCode}-${originCode}`] ??
      null
    );
  }
}

export const policiesRepository: IPoliciesRepository = new PoliciesRepository();
