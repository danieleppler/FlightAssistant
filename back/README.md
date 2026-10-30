# Converting this project's tools to MCP

Today, `get_flight_statuses`, `find_alternatives`, and `policy_check`
(`src/agent/tools/*`) are plain Anthropic API "tool use" definitions, called
directly as in-process TypeScript functions from `agent.ts` via the
`toolHandlers` map in `src/agent/tools/index.ts`. There's no protocol, no
separate server — just function calls in the same process.

MCP (Model Context Protocol) would turn these tools into a standalone server
that *any* MCP-compatible host (Claude Desktop, Claude Code, another backend)
could connect to and use — not just this agent. Here's the short version of
what that conversion involves.

## 1. Stand up an MCP server

Add `@modelcontextprotocol/sdk` and create a server (e.g. `src/mcp/server.ts`)
using `McpServer`. For each existing tool, register it with the same name,
input schema, and handler logic that already exists — the business logic in
`findAlternatives.ts`, `getFlightStatuses.ts`, and `policyCheck.ts` (and the
repositories underneath them) doesn't change at all. Only the *wrapper* around
each function changes, from an entry in `toolHandlers` to an `server.tool(...)`
registration.

## 2. Pick a transport

- **stdio** — the server runs as a child process; simplest for local use
  (e.g. Claude Desktop spawning it), no networking involved.
- **Streamable HTTP** — the server runs as its own long-lived process/endpoint,
  reachable over the network; needed if the MCP server should be usable by
  hosts that aren't spawning it as a subprocess (e.g. a different backend
  entirely).

For this project, HTTP is the more natural fit since `back/` is already a
server, not a CLI tool.

## 3. Turn `agent.ts` into an MCP *client*

Right now `agent.ts` calls `toolHandlers[block.name](block.input)` directly.
After the conversion, it would instead hold an MCP client connection (opened
once at startup) and call `client.callTool({ name, arguments })`, sending the
request over the chosen transport instead of invoking a local function. The
Anthropic tool-use loop itself (the `for` loop over `MAX_TOOL_ROUNDS` in
`runAgent`) stays exactly the same — only how a `tool_use` block gets turned
into a `tool_result` changes.

## 4. Drop the `tools` array definitions, or keep them as the client's cache

The `Tool[]` array passed to `anthropic.messages.create({ tools })` can either
stay hand-written (as now) or be fetched dynamically from the MCP server via
`client.listTools()` at startup, so the tool definitions live in one place
(the server) instead of being duplicated between server and client.

## Is it worth it here?

Only if something *other than this agent* needs to call these same tools —
e.g. you want Claude Desktop or a separate app to look up DemoAir flight
statuses directly. For a single backend that is the only consumer of its own
tools, MCP adds a server process, a transport, and a protocol layer for no
functional gain — which is why this project doesn't use it today (see
`decisions.md` for the project's other architecture decisions).
