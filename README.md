# OpenCode on Durable Objects

A proof-of-concept demonstrating [OpenCode's](https://opencode.ai) remote server capabilities running on Cloudflare Workers + Durable Objects.

## What is this?

This project showcases how OpenCode's `attach` feature enables connecting the OpenCode CLI/TUI to a remote server. By implementing the OpenCode server API on Cloudflare's edge infrastructure, we get:

- **Sessions that persist** - Durable Object SQLite storage keeps your conversation history
- **Pay only when active** - DOs hibernate when idle, no always-on server costs
- **Global edge deployment** - Low latency from anywhere in the world
- **Zero infrastructure management** - Cloudflare handles everything

## Demo

```bash
# Connect to the hosted demo
opencode attach https://opencode-do.southpolesteve.workers.dev

# Or use one-shot mode
opencode run --attach https://opencode-do.southpolesteve.workers.dev "tell me a joke"
```

## How it works

```
┌─────────────────────────────────────────────┐
│  OpenCode CLI/TUI                           │
│  opencode attach <worker-url>               │
└──────────────────┬──────────────────────────┘
                   │ HTTP + SSE (OpenCode API)
                   ▼
┌─────────────────────────────────────────────┐
│  Cloudflare Worker                          │
│  Routes requests, handles bootstrap API     │
└──────────────────┬──────────────────────────┘
                   │ Durable Object RPC
                   ▼
┌─────────────────────────────────────────────┐
│  Session Durable Object                     │
│  - SQLite message storage                   │
│  - SSE event streaming                      │
│  - Workers AI (Llama 3.2 3B)               │
│  - Hibernates when idle                     │
└─────────────────────────────────────────────┘
```

## Limitations (POC)

This is a proof-of-concept, not a production system:

- **Rate limited** - 20 requests per hour per IP (it's a free demo!)
- **No tools** - Read, Write, Edit, Bash, etc. are not implemented
- **No file system** - Can't interact with files
- **Single model** - Llama 3.2 3B via Workers AI (small but fast)
- **No streaming** - Responses come all at once, not streamed

## Deploy your own

1. Clone this repo
2. Install dependencies: `npm install`
3. Login to Cloudflare: `npx wrangler login`
4. Deploy: `npx wrangler deploy`

## Development

```bash
# Install dependencies
npm install

# Run locally
npm run dev

# Type check
npm run typecheck

# Deploy
npm run deploy
```

## Project structure

```
opencode-do/
├── src/
│   └── index.ts        # Worker + Durable Object implementation
├── wrangler.jsonc      # Cloudflare Worker config
├── tsconfig.json       # TypeScript config
└── proxy.ts            # Debug proxy for comparing with local OpenCode
```

## Key implementation details

### Sortable Message IDs

OpenCode's TUI uses string comparison to determine message ordering. We generate IDs in the same format as OpenCode (`msg_<timestamp-hex><random>`) to ensure proper sorting.

### SSE Event Protocol

The TUI expects specific SSE events in a specific order:
1. `message.updated` - User message created
2. `message.part.updated` - User message text
3. `message.updated` - User message with `summary` (signals completion)
4. `message.updated` - Assistant message placeholder
5. `session.status` - `busy`
6. `message.part.updated` - `step-start`
7. `message.part.updated` - Response text
8. `message.part.updated` - `step-finish`
9. `message.updated` - Assistant with `time.completed` and `finish: "stop"`
10. `session.status` - `idle`
11. `session.idle` - Deprecated but still expected

### SQLite Persistence

Messages are stored in Durable Object SQLite storage, which persists across hibernation cycles. This means you can walk away, come back hours later, and your conversation is still there.

## Future Possibilities

This POC demonstrates the basics, but the architecture supports much more. Here's what could be added:

### File System Access

The cleanest solution is [worker-fs-mount](https://github.com/danlapid/worker-fs-mount), a drop-in replacement for `node:fs/promises` with pluggable backends:

- **[durable-object-fs](https://github.com/danlapid/worker-fs-mount/tree/main/packages/durable-object-fs)** - SQLite-backed filesystem in a Durable Object (perfect for per-session workspaces)
- **[r2-fs](https://github.com/danlapid/worker-fs-mount/tree/main/packages/r2-fs)** - R2-backed filesystem for larger files
- **[memory-fs](https://github.com/danlapid/worker-fs-mount/tree/main/packages/memory-fs)** - In-memory filesystem for ephemeral use

This would let you implement Read/Write/Edit tools using standard `fs` APIs, with files persisting in your chosen backend.

### Tool Calling & Code Execution

For running arbitrary code safely, [Dynamic Worker Loaders](https://developers.cloudflare.com/workers/runtime-apis/bindings/worker-loader/) are the way to go:

- Spawn isolated Workers on-demand to execute untrusted code
- Millisecond startup time (much faster than containers)
- Full sandboxing: block network access, provide custom bindings
- Perfect for Bash-like tool execution where the AI generates code

The Cloudflare Agents SDK's [Codemode](https://developers.cloudflare.com/agents/api-reference/codemode/) is built on Dynamic Worker Loaders, giving LLMs a "write code" tool that runs in isolated sandboxes. This pattern would work great here.

For the tool calling flow:
1. Use a model with function calling support (Llama 3.3 70B, Mistral, etc.)
2. When the model requests a tool call, emit `tool-call` message parts via SSE
3. Execute the tool (in a dynamic isolate for untrusted code)
4. Return results as `tool-result` parts
5. Continue the conversation with tool results in context

### Git Operations

Git support could work via:

- **[isomorphic-git](https://isomorphic-git.org/)** - Pure JavaScript git implementation that works in Workers
- Clone repos to R2 or Durable Object storage using worker-fs-mount
- Implement git operations (status, diff, commit, push) as tools
- Use GitHub API for remote operations

### Container Execution

For heavier workloads or full shell environments:

- **[Cloudflare Containers](https://developers.cloudflare.com/containers/)** - Run containers alongside your Worker
- Spin up ephemeral containers for builds, tests, complex toolchains
- Mount R2 storage as the filesystem

### Better Models

Swap in more capable models:

- **Anthropic Claude** via [AI Gateway](https://developers.cloudflare.com/ai-gateway/)
- **OpenAI GPT-4** via AI Gateway
- **Any OpenAI-compatible API** with custom endpoints

The OpenCode protocol is model-agnostic, so you can use whatever model fits your needs.

## Credits

- [OpenCode](https://opencode.ai) - The amazing AI coding assistant that makes this possible
- [Cloudflare Workers](https://workers.cloudflare.com) - Edge compute platform
- [Cloudflare Durable Objects](https://developers.cloudflare.com/durable-objects/) - Stateful serverless
- [Workers AI](https://developers.cloudflare.com/workers-ai/) - AI inference at the edge

## License

MIT
