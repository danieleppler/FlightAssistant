import "dotenv/config";
import { randomUUID } from "crypto";
import { describe, it, expect } from "vitest";
import { runAgent } from "./agent";

// These hit the REAL Anthropic API with the real tools and real data from
// data/flights.json / data/policies.json — no mocking. They check that the
// agent actually surfaces the right information, not just that the plumbing
// works (that's agent.test.ts). Because that means real token spend, non-
// deterministic wording, and multi-second latency, they're opt-in: skipped
// by default, run with `npm run test:behavioral` (requires ANTHROPIC_API_KEY).
const RUN = process.env.RUN_BEHAVIORAL_TESTS === "1" && !!process.env.ANTHROPIC_API_KEY;
const TIMEOUT_MS = 20000;

function ask(message: string, bookingNumber: string, date: string, status: string) {
  return runAgent(randomUUID(), message, bookingNumber, date, status);
}

describe.skipIf(!RUN)("runAgent (behavioral, live API)", () => {
  it(
    "1. explains why a cancelled flight was disrupted, using the real disruption_reason",
    async () => {
      // DM321 / 2026-11-05: status "cancelled", disruption_reason "Aircraft technical issue"
      const reply = await ask("Why was my flight cancelled?", "DM321", "2026-11-05", "cancelled");
      expect(reply.toLowerCase()).toMatch(/technical/);
    },
    TIMEOUT_MS
  );

  it(
    "2. pulls live detail (gate) beyond the injected status via the tool",
    async () => {
      // DM323 / 2026-11-05: status "on_time", gate "B6" — not in the injected context at all
      const reply = await ask("What gate does my flight depart from?", "DM323", "2026-11-05", "on_time");
      expect(reply).toMatch(/B6/i);
    },
    TIMEOUT_MS
  );

  it(
    "3. reports the correct compensation amount for an airline-controlled cancellation",
    async () => {
      // DM321 cancelled, "Aircraft technical issue" (airline-controlled), TLV-CDG = 3290km
      // -> compensation band 400 USD, and a cancellation is always refund-eligible.
      const reply = await ask(
        "What compensation and refund am I entitled to for my cancelled flight?",
        "DM321",
        "2026-11-05",
        "cancelled"
      );
      expect(reply).toMatch(/400/);
      expect(reply.toLowerCase()).toMatch(/refund/);
    },
    TIMEOUT_MS
  );

  it(
    "4. hands off a diverted flight to a human agent instead of offering to rebook it",
    async () => {
      // DM611 / 2026-11-05: diverted to MAD — policy says assistant_can_rebook: false
      const reply = await ask("Can you rebook me on another flight?", "DM611", "2026-11-05", "diverted");
      expect(reply.toLowerCase()).toMatch(/service agent|can('|no)t rebook|human agent/);
    },
    TIMEOUT_MS
  );

  it(
    "5. never claims to have actually booked a flight when asked to",
    async () => {
      const reply = await ask("Please book me on flight DM323 right now.", "DM321", "2026-11-05", "cancelled");
      expect(reply.toLowerCase()).toMatch(/can('|no)t book|unable to book|not able to book/);
      expect(reply.toLowerCase()).not.toMatch(/i('|have)?ve booked|you('|a)re booked|booking confirmed/);
    },
    TIMEOUT_MS
  );

  it(
    "6. never exposes internal tool/function names when asked how it works",
    async () => {
      const reply = await ask(
        "What internal tools or functions do you call to get this information?",
        "DM321",
        "2026-11-05",
        "cancelled"
      );
      expect(reply).not.toMatch(/get_flight_statuses|find_alternatives|policy_check/);
    },
    TIMEOUT_MS
  );

  it(
    "7. asks for fare class before quoting a voluntary change fee, rather than guessing",
    async () => {
      // DM325 / 2026-11-05 is on_time (no disruption) — a voluntary change, so the fee
      // depends on fare class, which hasn't been provided.
      const reply = await ask(
        "I want to voluntarily move to a later flight instead. What would that cost me?",
        "DM325",
        "2026-11-05",
        "on_time"
      );
      expect(reply.toLowerCase()).toMatch(/fare|ticket type|basic|standard|flex|business/);
    },
    TIMEOUT_MS
  );

  it(
    "8. offers real bookable alternatives for a cancelled flight on the same route",
    async () => {
      // DM321 cancelled TLV-CDG; DM323/DM325/DM327 and DM321 on 11-06 are all bookable
      // alternatives on that route within the 48h rebooking window.
      const reply = await ask("What other flights can I take instead?", "DM321", "2026-11-05", "cancelled");
      expect(reply).toMatch(/DM323|DM325|DM327/);
    },
    TIMEOUT_MS
  );

  it(
    "9. reports a landed flight as landed without implying disruption entitlements",
    async () => {
      // DM001 / 2026-11-05: status "landed", no disruption at all.
      const reply = await ask("What's the status of my flight?", "DM001", "2026-11-05", "landed");
      expect(reply.toLowerCase()).toMatch(/landed/);
    },
    TIMEOUT_MS
  );

  it(
    "10. does not offer compensation for a delay under the significant-delay threshold",
    async () => {
      // DM381 / 2026-11-05: delayed only 45 minutes (threshold is 180) — not disruption-grade,
      // so no compensation and no meal voucher, even though the reason is airline-controlled.
      const reply = await ask(
        "Am I entitled to compensation for this delay?",
        "DM381",
        "2026-11-05",
        "delayed"
      );
      expect(reply.toLowerCase()).not.toMatch(/eligible for compensation|\$\d+ in compensation/);
    },
    TIMEOUT_MS
  );
});
