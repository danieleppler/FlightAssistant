# FlightAssistant (DemoAir)

A demo flight-disruption chatbot for a fictional airline, **DemoAir**. A passenger
looks up a flight, then chats with an AI agent about it — status, why it's
disrupted, rebooking options, and what they're entitled to (refund, meal
voucher, hotel, compensation) under DemoAir's policy.

Two pieces:

- **`back/`** — Express + TypeScript API. Owns the flight/policy data and runs
  the agent loop against the Anthropic API.
- **`front/`** — React + TypeScript (Vite) single-page app. Flight lookup form
  plus a chat widget.

## Live demo

- Frontend: https://flightassistant-9bo5.onrender.com
- Backend: https://flightassistant-back.onrender.com

Both are deployed on Render's free tier, so the first request after a period
of inactivity can take ~30-60s while the instance spins back up.

## Quick start

```bash
# backend
cd back
cp .env.example .env        # add your ANTHROPIC_API_KEY
npm install
npm run dev                 # http://localhost:3000

# frontend (separate terminal)
cd front
cp .env.example .env.local   # points at the backend above by default
npm install
npm run dev                  # http://localhost:5173
```

Open the frontend URL, search for a flight (try flight number `DM321` on
`2026-11-05` — see `back/data/flights.json` for the full seed data), then chat
about it.

## How it works

1. **Flight lookup** (`GET /flight/:number`, `GET /flights?date=`) — plain
   reads from `back/data/flights.json`, no AI involved.
2. **Chat** (`POST /chat`) — takes a message plus the booking's
   `flight_number`/`date`/`session_id`. The server looks up the flight's real
   status itself (never trusts a client-supplied status), then runs the agent.
3. **The agent** (`back/src/agent/agent.ts`) is an Anthropic tool-use loop: the
   model decides which of three tools to call —`get_flight_statuses`,
   `find_alternatives`, `policy_check` — reads the structured result, and
   either calls another tool or answers in natural language. Conversation
   history is kept server-side per `session_id` so the client just sends the
   latest message each turn.

The central design choice (see `decisions.md` for the full list): **business-
critical computation never happens inside the LLM.** Compensation amounts,
rebooking eligibility, refund thresholds — all plain TypeScript, reading
`flights.json`/`policies.json`. The model only orchestrates tool calls and
turns the structured results into a reply; it can't invent or miscompute a
dollar figure or a policy verdict. `decisions.md` also covers session
identification, failure fallbacks, per-booking usage throttling, and prompt-
injection logging.

## Testing

```bash
cd back
npm test                 # mocked unit tests — orchestration, no API calls
npm run test:behavioral  # hits the real Anthropic API; needs ANTHROPIC_API_KEY
```

- `agent.test.ts` — the agent loop's mechanics (tool dispatch, parallel tool
  calls, max-round/max-token fallbacks, history trimming, usage tracking) with
  the SDK and tools mocked.
- `agent.behavioral.test.ts` — live-API checks that the agent actually gives
  the right *information* (correct compensation figure, hands off diverted
  flights to a human agent, asks for fare class before quoting a fee, etc.),
  skipped by default since it costs real tokens.

## Project layout

```
back/
  src/
    index.ts                 # Express app, routes, request validation
    agent/
      agent.ts                # tool-use loop
      systemPrompt.ts
      sessionStore.ts          # in-memory history, keyed by session_id
      tokenUsageTracker.ts     # per-booking usage budget
      tools/                   # get_flight_statuses, find_alternatives, policy_check
    repositories/              # flights.json / policies.json readers
    security/promptGuard.ts     # logs suspicious/injection-looking prompts
  data/flights.json, policies.json

front/
  src/
    components/FlightLookup.*   # search form
    components/ChatWidget.*     # chat UI
    lib/api.ts                  # fetch wrappers for the back/ API
```

## Known limitations (demo scope)

- Session history and usage throttling are in-memory — reset on server
  restart, don't share state across multiple instances. A real deployment
  would move both to Redis/a DB.
- No auth — a booking is looked up by flight number + date only, same trust
  model as a public flight-status page. See `decisions.md` for the options
  considered for abuse prevention.
