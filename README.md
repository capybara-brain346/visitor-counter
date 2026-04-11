# visitor-counter

A visitor counter API deployed on Cloudflare Workers, backed by Upstash Redis for atomic increments. Built to avoid the lost-update race condition that makes raw KV unsuitable for concurrent writes.

## How it works

Every request hits a Cloudflare Worker at the edge. The worker proxies increment/decrement operations to Upstash Redis using a Lua `EVAL` script — executed atomically on the Redis side — which eliminates the read-modify-write race entirely. The counter is clamped to `>= 0` so decrements can never go negative.

Repeat-visitor deduplication is handled via a `portfolio_visited` cookie (24 h TTL, `HttpOnly`). On `/increment`, if that cookie is present the worker reads the current count without mutating it and returns early. This prevents a single user from inflating the count across page reloads.

All endpoints require a Bearer token (`Authorization: Bearer <token>`). Token validation is a constant-time string comparison against the `ACCESS_TOKEN` secret.

```
Client → Cloudflare Worker (edge) → Upstash Redis (atomic EVAL)
```

## API

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/increment` | Increment counter, set visited cookie |
| `POST` | `/decrement` | Decrement counter (floor 0) |

Optional JSON body for bulk operations:

```json
{ "delta": 5 }
```

`delta` must be a non-zero integer. Defaults to `1`.

**Response**

```json
{ "count": 42, "operation": "increment" }
```

**Error shape**

```json
{ "error": "invalid_delta", "message": "delta must be a non-zero integer" }
```

| Status | Reason |
|--------|--------|
| 400 | Invalid or malformed delta |
| 401 | Missing or invalid Bearer token |
| 405 | Wrong HTTP method |
| 500 | Redis read/write failure |

## Dev setup

**Prerequisites:** Node.js 18+, a [Wrangler](https://developers.cloudflare.com/workers/wrangler/) account, and an [Upstash Redis](https://upstash.com/) database.

```bash
npm install
```

Create `.dev.vars` in the project root (this file is gitignored):

```
UPSTASH_URL=https://<your-db>.upstash.io
UPSTASH_TOKEN=<your-token>
ACCESS_TOKEN=<any-secret-you-choose>
```

```bash
npm run dev        # start local dev server via wrangler dev
npm test           # run tests (vitest + @cloudflare/vitest-pool-workers)
npm run test:watch # watch mode
```

Tests stub the Upstash HTTP API in-memory — no live Redis needed to run them.

## Deployment

Set production secrets (one-time, per environment):

```bash
wrangler secret put UPSTASH_URL
wrangler secret put UPSTASH_TOKEN
wrangler secret put ACCESS_TOKEN
```

Deploy:

```bash
npm run deploy
```
