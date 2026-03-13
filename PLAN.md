# OpenCode on Durable Objects

Run OpenCode as a Cloudflare Worker + Durable Object, connecting via the standard OpenCode desktop app.

## Goal

**Phase 1 Demo**: Run `opencode run --attach http://localhost:8787 "hello"` against a local Wrangler dev server. One-shot prompt/response, no persistent sessions needed.

**Later**: Full `opencode attach` with persistent sessions, hibernation, walk away and come back.

## Architecture

```
┌─────────────────────────────────────────────┐
│  OpenCode Desktop / TUI                     │
│  `opencode attach http://localhost:8787`    │
└──────────────────┬──────────────────────────┘
                   │ HTTP + WebSocket (OpenCode API)
                   ▼
┌─────────────────────────────────────────────┐
│  Cloudflare Worker                          │
│  - Routes requests to session DOs           │
│  - Implements OpenCode OpenAPI spec         │
└──────────────────┬──────────────────────────┘
                   │ DO RPC
                   ▼
┌─────────────────────────────────────────────┐
│  Session Durable Object                     │
│  (extends AIChatAgent from Agents SDK)      │
│                                             │
│  Storage (SQLite):                          │
│  - Messages / conversation history          │
│  - Session state                            │
│  - Project files (via durable-object-fs)    │
│                                             │
│  Capabilities:                              │
│  - LLM calls via Vercel AI SDK              │
│  - Tool execution (Read/Write/Edit/Glob/Grep)│
│  - Hibernation when idle                    │
│  - WebSocket streaming                      │
└─────────────────────────────────────────────┘
```

## Key Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `wrangler` | 4.73.0 | Dev server + deploy |
| `@cloudflare/agents` | 0.0.16 | Agents SDK (AIChatAgent) |
| `ai` | latest | Vercel AI SDK |
| `@ai-sdk/anthropic` | latest | Claude provider |
| `worker-fs-mount` | latest | DO filesystem |
| `durable-object-fs` | latest | SQLite-backed fs |
| `zod` | latest | Schema validation |

## Project Setup

```
opencode-do/
├── src/
│   ├── index.ts          # Worker entry, routes to DO
│   ├── agent.ts          # Session DO (extends AIChatAgent)
│   ├── tools/            # OpenCode tool implementations
│   │   ├── read.ts
│   │   ├── write.ts
│   │   ├── edit.ts
│   │   ├── glob.ts
│   │   └── grep.ts
│   ├── api/              # OpenCode API compatibility layer
│   │   └── routes.ts
│   └── fs/               # Filesystem integration
│       └── index.ts
├── wrangler.jsonc
├── tsconfig.json
├── package.json
├── oxlint.json
└── PLAN.md
```

## Tooling

- **TypeScript** with strict mode
- **OXLint** for linting (fast)
- **OXFormat** for formatting (fast)  
- **Wrangler** for dev/deploy

## Phases

### Phase 1: Minimal Working Demo

Target: `opencode run --attach http://localhost:8787 "hello"` works.

**What `opencode run --attach` actually calls** (from source analysis):

```typescript
// 1. Subscribe to SSE event stream
sdk.event.subscribe()  // GET /event

// 2. Create session
sdk.session.create({ title, permission })  // POST /session

// 3. Send prompt
sdk.session.prompt({ sessionID, parts, model, agent })  // POST /session/:id/prompt

// Events it listens for:
// - message.updated (new assistant message)
// - message.part.updated (tool calls, text chunks)
// - session.status { type: "idle" } (done)
// - session.error (errors)
// - permission.asked (auto-rejects)
```

**Implementation steps:**

1. Set up project with Wrangler, TypeScript, OXLint
2. Create Worker + DO structure using Agents SDK
3. Implement these endpoints:
   - `GET /event` - SSE stream
   - `POST /session` - Create session, returns `{ id, ... }`
   - `POST /session/:id/prompt` - Send message, triggers LLM
4. Emit these events on the SSE stream:
   ```typescript
   // When assistant starts responding
   { type: "message.updated", properties: { info: AssistantMessage } }
   
   // For each text chunk
   { type: "message.part.updated", properties: { part: TextPart } }
   
   // When done
   { type: "session.status", properties: { sessionID, status: { type: "idle" } } }
   ```
5. Use Workers AI for LLM (simplest, no API keys needed)
6. No tools yet, just chat working
7. Test with `opencode run --attach http://localhost:8787 "hello"`

### Phase 2: Filesystem + Tools

1. Integrate `durable-object-fs` for project storage
2. Implement core tools:
   - `Read` - read file contents
   - `Write` - write file contents
   - `Edit` - oldString/newString replacement
   - `Glob` - find files by pattern
   - `Grep` - search file contents
3. Add tool execution to the agent loop
4. Test file operations via OpenCode

### Phase 3: Full API Compatibility

1. Implement remaining OpenCode API endpoints
2. Session persistence across hibernation
3. Proper streaming via WebSocket/SSE
4. Auth (basic auth like OpenCode server)

### Phase 4: Advanced Features (Later)

- TypeScript execution via Dynamic Worker Loaders
- `just-bash` for shell commands (if needed)
- Git operations via isomorphic-git
- MCP server support

## Decisions

1. **Project bootstrap**: Git clone via isomorphic-git (or similar). User provides repo URL.
2. **DO structure**: One DO per user (user state) + one DO per project (files + sessions).
3. **LLM**: Workers AI for Phase 1 (no API keys needed). Can add Anthropic/OpenAI later.
4. **OpenCode API version**: Don't pin, just implement what we need to work.

## Commands

```bash
# Install dependencies
pnpm install

# Dev server
pnpm dev

# Type check
pnpm typecheck

# Lint
pnpm lint

# Format
pnpm format

# Deploy
pnpm deploy

# Test with OpenCode (phase 1 - one shot)
opencode run --attach http://localhost:8787 "hello"

# Test with OpenCode (later - persistent)
opencode attach http://localhost:8787
```

## Resources

- [OpenCode Server API](https://opencode.ai/docs/server/)
- [OpenCode SDK](https://opencode.ai/docs/sdk/)
- [Cloudflare Agents SDK](https://developers.cloudflare.com/agents/)
- [worker-fs-mount](https://github.com/danlapid/worker-fs-mount)
- [Vercel AI SDK](https://ai-sdk.dev/)
