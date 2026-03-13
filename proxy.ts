#!/usr/bin/env bun
/**
 * Comparison Proxy for OpenCode DO
 * 
 * Proxies requests to both:
 * 1. Local OpenCode server (opencode serve)
 * 2. Remote DO worker (opencode-do.vinext.workers.dev)
 * 
 * Compares responses and logs differences.
 * 
 * Usage:
 *   1. Start local opencode: `opencode serve`
 *   2. Run this proxy: `bun run proxy.ts`
 *   3. Connect: `opencode attach http://localhost:4097`
 */

import { appendFileSync, writeFileSync } from "fs";

const LOCAL_URL = process.env.LOCAL_URL || "http://localhost:4096";
const REMOTE_URL = process.env.REMOTE_URL || "https://opencode-do.vinext.workers.dev";
const PROXY_PORT = parseInt(process.env.PROXY_PORT || "4097", 10);
const LOG_FILE = process.env.LOG_FILE || "./proxy.log";

// Clear log file on start
writeFileSync(LOG_FILE, `=== Proxy started at ${new Date().toISOString()} ===\n\n`);

// Color codes for terminal output
const colors = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
};

function log(prefix: string, color: string, ...args: unknown[]) {
  const timestamp = new Date().toISOString().split("T")[1].slice(0, 12);
  const message = args.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" ");
  console.log(`${colors.dim}${timestamp}${colors.reset} ${color}${prefix}${colors.reset}`, ...args);
  // Also write to log file (without colors)
  appendFileSync(LOG_FILE, `${timestamp} ${prefix} ${message}\n`);
}

function logLocal(...args: unknown[]) {
  log("[LOCAL ]", colors.green, ...args);
}

function logRemote(...args: unknown[]) {
  log("[REMOTE]", colors.blue, ...args);
}

function logDiff(...args: unknown[]) {
  log("[DIFF  ]", colors.red, ...args);
}

function logProxy(...args: unknown[]) {
  log("[PROXY ]", colors.yellow, ...args);
}

// Deep compare two objects and return differences
function deepCompare(local: unknown, remote: unknown, path = ""): string[] {
  const diffs: string[] = [];

  if (typeof local !== typeof remote) {
    diffs.push(`${path}: type mismatch - local=${typeof local}, remote=${typeof remote}`);
    return diffs;
  }

  if (local === null || remote === null) {
    if (local !== remote) {
      diffs.push(`${path}: null mismatch - local=${local}, remote=${remote}`);
    }
    return diffs;
  }

  if (typeof local !== "object") {
    if (local !== remote) {
      // Ignore time-based differences and UUIDs
      if (path.includes("time") || path.includes("id") || path.includes("ID")) {
        return diffs;
      }
      diffs.push(`${path}: value mismatch - local=${JSON.stringify(local)}, remote=${JSON.stringify(remote)}`);
    }
    return diffs;
  }

  if (Array.isArray(local) && Array.isArray(remote)) {
    if (local.length !== remote.length) {
      diffs.push(`${path}: array length mismatch - local=${local.length}, remote=${remote.length}`);
    }
    const minLen = Math.min(local.length, remote.length);
    for (let i = 0; i < minLen; i++) {
      diffs.push(...deepCompare(local[i], remote[i], `${path}[${i}]`));
    }
    return diffs;
  }

  const localObj = local as Record<string, unknown>;
  const remoteObj = remote as Record<string, unknown>;
  const allKeys = new Set([...Object.keys(localObj), ...Object.keys(remoteObj)]);

  for (const key of allKeys) {
    const newPath = path ? `${path}.${key}` : key;
    if (!(key in localObj)) {
      diffs.push(`${newPath}: missing in local`);
    } else if (!(key in remoteObj)) {
      diffs.push(`${newPath}: missing in remote`);
    } else {
      diffs.push(...deepCompare(localObj[key], remoteObj[key], newPath));
    }
  }

  return diffs;
}

// SSE stream handling
async function handleSSE(req: Request): Promise<Response> {
  logProxy("SSE connection requested");

  // We'll only connect to local for SSE since that's what drives the UI
  // But we log that remote would be available too
  const localUrl = `${LOCAL_URL}${new URL(req.url).pathname}${new URL(req.url).search}`;
  
  logLocal(`SSE -> ${localUrl}`);
  logRemote(`SSE -> (not connected, using local only for SSE)`);

  const localRes = await fetch(localUrl, {
    headers: req.headers,
  });

  return new Response(localRes.body, {
    status: localRes.status,
    headers: localRes.headers,
  });
}

// Regular request handling with comparison
async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname + url.search;
  const method = req.method;

  logProxy(`${method} ${path}`);

  // Clone request body if present
  let bodyText: string | null = null;
  if (req.body && method !== "GET" && method !== "HEAD") {
    bodyText = await req.text();
  }

  // Make requests to both servers in parallel
  const localUrl = `${LOCAL_URL}${path}`;
  const remoteUrl = `${REMOTE_URL}${path}`;

  const makeRequest = async (targetUrl: string) => {
    const headers = new Headers(req.headers);
    headers.delete("host");

    const options: RequestInit = {
      method,
      headers,
    };

    if (bodyText) {
      options.body = bodyText;
    }

    const start = Date.now();
    try {
      const res = await fetch(targetUrl, options);
      const elapsed = Date.now() - start;
      const text = await res.text();
      return { 
        status: res.status, 
        headers: Object.fromEntries(res.headers.entries()),
        body: text,
        elapsed,
        error: null 
      };
    } catch (e) {
      return { 
        status: 0, 
        headers: {},
        body: "",
        elapsed: Date.now() - start,
        error: e instanceof Error ? e.message : String(e)
      };
    }
  };

  const [localResult, remoteResult] = await Promise.all([
    makeRequest(localUrl),
    makeRequest(remoteUrl),
  ]);

  // Log results
  if (localResult.error) {
    logLocal(`ERROR: ${localResult.error}`);
  } else {
    logLocal(`${localResult.status} (${localResult.elapsed}ms) ${localResult.body.slice(0, 100)}${localResult.body.length > 100 ? "..." : ""}`);
  }

  if (remoteResult.error) {
    logRemote(`ERROR: ${remoteResult.error}`);
  } else {
    logRemote(`${remoteResult.status} (${remoteResult.elapsed}ms) ${remoteResult.body.slice(0, 100)}${remoteResult.body.length > 100 ? "..." : ""}`);
  }

  // Compare responses
  if (localResult.status !== remoteResult.status) {
    logDiff(`Status mismatch: local=${localResult.status}, remote=${remoteResult.status}`);
  }

  // Try to parse as JSON and compare structure
  try {
    const localJson = JSON.parse(localResult.body);
    const remoteJson = JSON.parse(remoteResult.body);
    const diffs = deepCompare(localJson, remoteJson);
    if (diffs.length > 0) {
      logDiff(`JSON differences for ${path}:`);
      for (const diff of diffs.slice(0, 10)) {
        console.log(`  ${colors.red}${diff}${colors.reset}`);
        appendFileSync(LOG_FILE, `    ${diff}\n`);
      }
      if (diffs.length > 10) {
        console.log(`  ${colors.dim}... and ${diffs.length - 10} more${colors.reset}`);
        appendFileSync(LOG_FILE, `    ... and ${diffs.length - 10} more\n`);
      }
      // Log full bodies for detailed inspection
      appendFileSync(LOG_FILE, `  LOCAL BODY: ${localResult.body.slice(0, 2000)}\n`);
      appendFileSync(LOG_FILE, `  REMOTE BODY: ${remoteResult.body.slice(0, 2000)}\n\n`);
    }
  } catch {
    // Not JSON, do string comparison
    if (localResult.body !== remoteResult.body) {
      logDiff(`Body mismatch (non-JSON)`);
      appendFileSync(LOG_FILE, `  LOCAL BODY: ${localResult.body.slice(0, 500)}\n`);
      appendFileSync(LOG_FILE, `  REMOTE BODY: ${remoteResult.body.slice(0, 500)}\n\n`);
    }
  }

  // Return local response to the client
  return new Response(localResult.body, {
    status: localResult.status,
    headers: {
      "Content-Type": localResult.headers["content-type"] || "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

// Main server
Bun.serve({
  port: PROXY_PORT,
  async fetch(req) {
    const url = new URL(req.url);

    // Handle CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      });
    }

    // SSE endpoint
    if (url.pathname === "/event") {
      return handleSSE(req);
    }

    // All other requests
    return handleRequest(req);
  },
});

console.log(`
${colors.cyan}╔════════════════════════════════════════════════════════════╗
║  OpenCode DO Comparison Proxy                                ║
╠════════════════════════════════════════════════════════════╣
║  Proxy:  http://localhost:${PROXY_PORT}                            ║
║  Local:  ${LOCAL_URL}                            ║
║  Remote: ${REMOTE_URL}  ║
╠════════════════════════════════════════════════════════════╣
║  Usage:                                                      ║
║  1. Start local: opencode serve                              ║
║  2. Connect:     opencode attach http://localhost:${PROXY_PORT}    ║
╚════════════════════════════════════════════════════════════╝${colors.reset}
`);
