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
│  - Workers AI (Llama 3.3 70B)              │
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

## Credits

- [OpenCode](https://opencode.ai) - The amazing AI coding assistant that makes this possible
- [Cloudflare Workers](https://workers.cloudflare.com) - Edge compute platform
- [Cloudflare Durable Objects](https://developers.cloudflare.com/durable-objects/) - Stateful serverless
- [Workers AI](https://developers.cloudflare.com/workers-ai/) - AI inference at the edge

## License

MIT
