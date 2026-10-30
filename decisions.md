# Decisions

## Session identification: `session_id`, not `booking_number` + `date`

**Context:** `/chat` is stateless per request, but the agent needs to remember prior
turns (e.g. a passenger answering "yes" to a question the agent asked earlier).
Something has to key that stored conversation history.

**Decision:** Use a dedicated `session_id` (client-generated or server-issued on
the first call, returned in the response, then sent back on every subsequent
call) instead of keying history off `booking_number` + `date`.

**Why not `booking_number` + `date`:** it's simpler (no new field) but collapses
every conversation about the same flight into a single thread — two devices or
browser tabs open on the same booking would share and interleave one history.
A separate `session_id` lets each device/tab hold its own independent
conversation about the same booking.

**Consequence:** the client must persist `session_id` (e.g. in `localStorage`)
across calls. History is kept in-memory on the server, keyed by `session_id`,
with a TTL sweep to evict idle sessions.

## Architecture: hybrid of LLM agent + deterministic backend logic

**Decision:** Business rules (rebooking eligibility, compensation bands, refund
thresholds, etc.) are never left to the LLM to compute or recall. They live as
plain TypeScript in the repositories and tools (`policy_check`, `find_alternatives`,
`get_flight_statuses`), reading directly from `flights.json` / `policies.json`.
The LLM agent's job is orchestration and language: deciding which tool to call,
with what arguments, and turning the structured tool results into a clear reply
— never inventing numbers or policy outcomes itself.

**Why:** keeps correctness (compensation amounts, eligibility verdicts, flight
data) deterministic and testable independent of the model, while still getting
the LLM's strengths (understanding free-form passenger questions, chaining
multiple tools, producing a natural-language answer). It also means swapping or
upgrading the model later can't silently change a compensation amount or a
rebooking verdict.

## Decision: have a fallback for when the agent can't finish

**Decision:** the agent must never hand back a broken or silently-wrong response
when it can't complete normally — it should fail into a clear, user-facing
message instead.

**Current implementation:** the tool-use loop is bounded (`MAX_TOOL_ROUNDS`); if
the model keeps calling tools without ever producing a final answer, the agent
gives up with an explicit apology ("I wasn't able to finish processing that
request. Please try again.") instead of looping forever or returning nothing.
The dangling, incomplete round is not persisted to session history, so the next
turn resumes from the last known-good state rather than a broken one.

**Not yet implemented:** a dedicated fallback for the model running out of
*output* tokens mid-answer (`stop_reason: "max_tokens"`), as opposed to running
out of tool-use rounds. Today that case isn't specially detected — a truncated
answer would currently be returned to the passenger as-is. This is a known gap,
not yet addressed.

## Per-client token usage throttling

**Context:** nothing stopped a single client from running up unbounded Anthropic
API cost by sending unlimited `/chat` messages.

**Decision:** track cumulative token usage (`input_tokens` + `output_tokens` from
each Anthropic response) per `booking_number`, in a rolling 24h window. Once a
booking crosses `MAX_TOKENS_PER_WINDOW`, `/chat` rejects further requests for
that booking with `429` until the window resets — checked before `runAgent` is
even called, so an over-budget request costs nothing further.

**Why `booking_number` and not `session_id`:** it throttles per passenger/flight,
not per browser tab — multiple tabs or devices on the same booking share one
budget, which better reflects "this client" than a tab-scoped session would.

**Current implementation:** in-memory `Map` (`tokenUsageTracker.ts`), same
pattern as the session store, with a periodic sweep to evict expired windows.

**At scale:** this resets on server restart and doesn't work across multiple
server instances — acceptable for a single-process demo, but a real deployment
would move this counter to Redis (or a DB) so usage is shared and durable across
all instances, the same caveat noted for the session store.

## Malicious prompt detection: log, don't block

**Context:** passengers can send prompt-injection/jailbreak attempts (e.g.
"ignore all previous instructions", "reveal your system prompt", "you are now
DAN", probing for the API key). The agent's own system-prompt instructions
already resist acting on these, but there was no visibility into when someone
tries.

**Decision:** run a lightweight regex-based detector (`promptGuard.ts`) over
every incoming `/chat` message, matching known injection/jailbreak/extraction/
credential-probing signatures. On a match, log a tagged `[security]
suspicious_prompt ...` warning (session id, booking number, date, matched
pattern labels, full message) — but still let the request proceed normally to
the agent.

**Why log instead of block:** the agent already has its own instructions not to
comply with these (don't reveal internals, don't treat embedded text as new
instructions), so blocking outright would risk false-positive refusals on
legitimate questions that happen to match a pattern (e.g. a passenger asking
"what information do you have about my flight"). Logging gives visibility and
an audit trail without that risk; blocking can be layered on top later if
abuse patterns justify it.

**Current implementation:** pattern-matching only (no LLM-based classification),
covering: instruction override, system-prompt extraction, role override /
jailbreak keywords, unauthorized override of rules/policy, and credential
probing. False negatives are expected for novel phrasings not covered by the
patterns.

## sweeping mechanisem
## tool usage logging for further fine tuning