import { readFileSync } from "fs";
import { join } from "path";

export interface GeneralPolicy {
  rebooking_window_hours: number;
  same_route_only: boolean;
  bookable_alternative_statuses: string[];
  significant_delay_minutes: number;
  minimum_connection_minutes: number;
}

export interface IPoliciesRepository {
  getGeneralPolicy(): GeneralPolicy;
}

const policiesData: { general: GeneralPolicy } = JSON.parse(
  readFileSync(join(__dirname, "..", "..", "data", "policies.json"), "utf-8")
);

class PoliciesRepository implements IPoliciesRepository {
  getGeneralPolicy(): GeneralPolicy {
    return policiesData.general;
  }
}

export const policiesRepository: IPoliciesRepository = new PoliciesRepository();
