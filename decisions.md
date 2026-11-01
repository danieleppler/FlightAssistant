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

The same treatment now covers `stop_reason: "max_tokens"` — the model running
out of *output* tokens mid-answer, as opposed to running out of tool-use rounds.
That case is checked before the normal "final answer" branch: the truncated
content is never persisted to history (a half-finished turn would otherwise
look like a completed one on the next request) and the passenger gets an
explicit "I wasn't able to finish that response, ask again" instead of a
reply that just stops mid-sentence.???

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


## Frontend chat UX decisions

The chat widget surfaces the booking-level token-budget reset time to the passenger instead of a generic "try again later": `/chat`'s `429` response now includes `reset_at` (computed from the usage window's `windowStart` + `WINDOW_MS`), and the widget shows it inline ("You can ask again on ...") and disables the input until then, so a throttled passenger knows exactly when they're unblocked instead of retrying blindly. The chat panel is sized to the full viewport height, minus a small margin on each side, rather than a short fixed-height popup, since a flight-disruption conversation can run long and a capped height forced constant scrolling inside a tiny box. The message box is a textarea that auto-resizes vertically as the passenger types — growing with the content instead of staying single-line and cropping or scrolling horizontally — up to a max height, past which it scrolls internally.

## Considered: push live flight-status updates to the client

**Context:** explored adding a feature where the client gets notified the moment a flight's status changes (e.g. `on_time` → `cancelled`), inspired by the pattern of airline apps surfacing real-time status via lock-screen/OS-level live updates. The mechanism considered was Server-Sent Events (SSE): a one-way, long-lived HTTP connection the server can push an event down at any time, with no polling needed on the client's part — a good fit here since only the server needs to push (the client already sends chat messages via a normal `POST /chat`, never needing to push back over the same channel), unlike a WebSocket's two-way channel, which would be capability this app doesn't use.

**Decision:** not implemented. A plain website can only deliver an SSE push while the tab stays open and the JS keeps running — close the tab, lock the phone, switch apps, and the connection dies. That doesn't actually replicate "notify me even when I'm not looking at it," which is the whole point of the pattern this was inspired by; it only helps for the narrower case of a passenger who keeps the chat open and watches it live.

**Why not Web Push instead:** the genuine web equivalent — one that survives the tab being closed — is Web Push (Service Worker + Push API, server posting to a push subscription endpoint whenever status changes). It's real additional infrastructure (service worker, a notification-permission prompt, server-side subscription storage) and comes with a platform caveat: Safari on iOS only supports Web Push for a site installed as a PWA, not a plain browser tab, so it can't fully match a native app's no-install notification behavior anyway.

**Future:** this is better suited to a native/mobile app, where OS-level push notifications (or an iOS Live Activity, matching the lock-screen pattern this was inspired by) are the natural fit and don't carry the "only works while a tab is open" limitation a website has.

## Considered: preventing unlimited/abusive usage

**Context:** reviewed what's actually exposed once this is deployed. `cors()` is unrestricted (defaults to `Access-Control-Allow-Origin: *`), and the only existing abuse control is the per-`booking_number` token-usage throttle (`tokenUsageTracker.ts`). CORS itself turned out not to be a security boundary at all here — it's enforced by the browser, not the server, so it only affects whether a *browser page's* JS can read the response back; the request still reaches and runs on the server regardless, and a non-browser caller (curl, a script, another server) ignores CORS entirely since it never had a page origin to restrict in the first place. The per-booking throttle has a gap of its own: nothing caps total spend *across* bookings, so cycling through many different valid `flight_number`+`date` pairs from `flights.json` gets a fresh budget each time.

**Decision:** not yet implemented — documenting the options considered and their trade-offs.

**Options considered, ranked by protection-per-effort:**
1. A global token/cost ceiling across all bookings in the rolling window, on top of the existing per-booking one — caps worst-case spend regardless of how abuse is spread across fake bookings. Highest priority of the five.
2. IP-based rate limiting (e.g. `express-rate-limit`) on `/chat` — cheap, catches casual scripted abuse, but IPs are shared (false positives for legitimate users behind the same NAT/VPN) and trivially rotatable — raises the bar, doesn't remove the threat.
3. Restrict CORS to the deployed frontend's origin — free, stops *other websites'* browser JS from calling the API, but (per above) does nothing against a non-browser caller.
4. A shared secret header sent by the frontend on every request — filters out generic bots that don't bother inspecting the frontend, but the secret ships inside the public SPA bundle (visible in any browser's network tab), so it's not a real barrier against anyone who looked first.
5. Real user accounts/login — the only way to tie usage to an actual identity rather than "knows a flight number + date." A genuine scope change for an intentionally account-less, informational-only demo; not worth it here.

**Why not auth today:** knowing a flight number + date is the same trust model a real airline's public flight-status lookup uses — it isn't meant to be a secret, so the actual gap isn't "anyone can look up a flight," it's "nothing caps total cost if someone automates many lookups." Option 1 targets that directly; 2 and 3 are worthwhile cheap additions on top; 4 and 5 aren't a good fit for this project's scope.