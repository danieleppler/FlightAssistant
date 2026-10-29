import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import { getFlightStatusesTool, getFlightStatuses } from "./getFlightStatuses";
import { findAlternativesTool, findAlternatives } from "./findAlternatives";
import { policyCheckTool, policyCheck } from "./policyCheck";

export const tools: Tool[] = [
  getFlightStatusesTool,
  findAlternativesTool,
  policyCheckTool,
];

export const toolHandlers: Record<string, (input: any) => unknown> = {
  get_flight_statuses: getFlightStatuses,
  find_alternatives: findAlternatives,
  policy_check: policyCheck,
};
