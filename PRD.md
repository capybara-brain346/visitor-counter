# PRD: Scalable Counter API on Cloudflare Workers

**Status:** Draft  
**Author:** Piyush Choudhari  
**Last Updated:** April 2026

---

## Overview

A lightweight API deployed on Cloudflare Workers that reliably increments and decrements a counter at scale. The core challenge is correctness under concurrent writes — KV's eventual consistency makes it the wrong primitive here, so this PRD specifies Durable Objects as the backing store.

---

## Problem Statement

A naive counter on Cloudflare KV races under concurrent writes. At 100 RPS, read → increment → write produces lost updates because multiple workers can read a stale value before any of them writes back. We need a strongly consistent, low-latency counter that doesn't drop updates.

---

## Goals

- Handle 100+ RPS with zero lost updates
- Sub-100ms p99 latency globally
- Support increment and decrement operations
- Return current count after each operation
- Keep infra entirely on Cloudflare (no external deps)

## Non-Goals

- Persistent history / audit log of operations
- Per-user counters (single global counter for now)
- Counter reset via API (ops task, not product)
- Auth / rate limiting (handled at gateway layer)

---

## API Spec

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/increment` | Increment counter by 1 |
| POST | `/decrement` | Decrement counter by 1 |
| GET | `/count` | Read current value |

### Request

No body required for increment/decrement.

Optional body for bulk operations:
```json
{ "delta": 5 }
```

### Response

```json
{
  "count": 42,
  "operation": "increment"
}
```

### Errors

```json
{
  "error": "invalid_delta",
  "message": "delta must be a non-zero integer"
}
```

| Status | Reason |
|--------|--------|
| 400 | Invalid delta value |
| 405 | Method not allowed |
| 500 | DO storage failure |

---

## Architecture

### Why Durable Objects

KV is eventually consistent — no atomic increment primitive exists. Durable Objects give us a single-instance actor model where all requests are serialized, eliminating race conditions entirely. One DO instance handles the global counter.

```
Client → Cloudflare Worker (edge) → Durable Object (single instance)
                                            ↓
                                     DO Storage (strongly consistent)
```

### Request Flow

1. Request hits nearest Cloudflare edge PoP
2. Worker routes to the named DO instance (`idFromName("global")`)
3. DO processes requests one at a time (built-in serialization)
4. Storage write + response returned
5. Worker forwards response to client

### Read Consistency

All reads (GET `/count`) are routed through the Durable Object — not served from KV or a Worker-level cache. This guarantees that a read always reflects the latest committed write. No stale reads, ever.

### Scalability Model

- **Concurrency:** DO serializes all writes — no locking needed
- **Throughput:** DO can handle ~1000 RPS per instance, well above our 100 RPS target
- **Latency:** Only overhead is the Worker → DO hop (~10–50ms depending on colo proximity)
- **Bottleneck:** At very high scale (10k+ RPS), the single DO becomes the bottleneck. Mitigation: sharded counters with periodic reconciliation (out of scope for v1)

---

## Implementation Notes

### Worker

```js
export default {
  async fetch(request, env) {
    const id = env.COUNTER.idFromName("global");
    const obj = env.COUNTER.get(id);
    return obj.fetch(request);
  }
};
```

### Durable Object

```js
export class Counter {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const body = request.method === "POST"
      ? await request.json().catch(() => ({}))
      : {};
    const delta = body.delta ?? 1;

    let count = (await this.state.storage.get("count")) ?? 0;

    if (url.pathname === "/increment") count += delta;
    else if (url.pathname === "/decrement") count -= delta;
    else if (url.pathname === "/count") {
      // read-only, no mutation — routed through DO for strong consistency
      return new Response(
        JSON.stringify({ count, operation: "read" }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    await this.state.storage.put("count", count);

    return new Response(
      JSON.stringify({ count, operation: url.pathname.slice(1) }),
      { headers: { "Content-Type": "application/json" } }
    );
  }
}
```

### wrangler.toml

```toml
name = "counter-api"
main = "src/worker.js"
compatibility_date = "2024-01-01"

[[durable_objects.bindings]]
name = "COUNTER"
class_name = "Counter"

[[migrations]]
tag = "v1"
new_classes = ["Counter"]
```

---

## Testing Plan

### Unit Tests

- Increment from 0 → 1
- Decrement below 0 (should allow negative values)
- Bulk delta: `{ "delta": 10 }`
- Invalid delta: `{ "delta": "abc" }` → 400
- GET `/count` returns current value without mutation

### Correctness Test

Run 1000 concurrent increments, assert `count === 1000` at the end.

---

## Observability

- Log `operation`, `delta`, `resulting_count`, and `latency_ms` per request
- Cloudflare Analytics for RPS and error rate dashboards
- Alert on: p99 > 200ms, error rate > 0.1%

---

## Open Questions

- Do we need negative floor protection (min count = 0)? -- Yes
- Should reads be separated into a dedicated endpoint for observability (e.g. `/count` vs `/increment`/`/decrement` metrics)? -- Yes

---