import { vi, beforeEach, describe, it, expect } from "vitest";
import { SELF } from "cloudflare:test";

// Hoist the store so it's accessible inside the fetch mock
const { store } = vi.hoisted(() => ({
  store: new Map<string, number>(),
}));

// Intercept calls to the Upstash REST API and handle them in-memory
vi.stubGlobal("fetch", async (input: RequestInfo, init?: RequestInit): Promise<Response> => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
  if (url === "https://test.upstash.io") {
    const args = JSON.parse((init?.body as string) ?? "[]") as unknown[];
    const command = String(args[0]).toUpperCase();

    let result: unknown = null;
    if (command === "GET") {
      const key = String(args[1]);
      result = store.has(key) ? String(store.get(key)) : null;
    } else if (command === "EVAL") {
      // EVAL script numkeys key delta
      const key = String(args[3]);
      const delta = parseInt(String(args[4]), 10);
      const current = store.get(key) ?? 0;
      const newVal = Math.max(0, current + delta);
      store.set(key, newVal);
      result = newVal;
    }

    return new Response(JSON.stringify({ result }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  // Pass through any other fetch calls (e.g. SELF.fetch)
  return (globalThis as unknown as { _originalFetch: typeof fetch })._originalFetch(input as RequestInfo, init);
});

async function invoke(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<Response> {
  const url = "http://localhost" + path;
  const init: RequestInit = { method };
  const mergedHeaders: Record<string, string> = { ...headers };
  if (body !== undefined) {
    mergedHeaders["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  if (Object.keys(mergedHeaders).length > 0) init.headers = mergedHeaders;
  return SELF.fetch(url, init);
}

/** Directly set the counter value in the mock store, bypassing HTTP. */
function seedCount(value: number): void {
  store.set("counter:global", value);
}

describe("Counter API", () => {
  beforeEach(() => {
    store.clear();
  });

  describe("POST /increment", () => {
    it("increments from 0 to 1 with no body", async () => {
      const res = await invoke("POST", "/increment");
      expect(res.status).toBe(200);
      const body = await res.json<{ count: number; operation: string }>();
      expect(body.count).toBe(1);
      expect(body.operation).toBe("increment");
    });

    it("increments by a custom delta", async () => {
      seedCount(1);
      const res = await invoke("POST", "/increment", { delta: 9 }); // 1 + 9 = 10
      expect(res.status).toBe(200);
      const body = await res.json<{ count: number }>();
      expect(body.count).toBe(10);
    });

    it("returns 400 for non-integer delta", async () => {
      const res = await invoke("POST", "/increment", { delta: "abc" });
      expect(res.status).toBe(400);
      const body = await res.json<{ error: string }>();
      expect(body.error).toBe("invalid_delta");
    });

    it("returns 400 for zero delta", async () => {
      const res = await invoke("POST", "/increment", { delta: 0 });
      expect(res.status).toBe(400);
      const body = await res.json<{ error: string }>();
      expect(body.error).toBe("invalid_delta");
    });

    it("returns 400 for float delta", async () => {
      const res = await invoke("POST", "/increment", { delta: 1.5 });
      expect(res.status).toBe(400);
      const body = await res.json<{ error: string }>();
      expect(body.error).toBe("invalid_delta");
    });

    it("returns 405 when called with GET", async () => {
      const res = await invoke("GET", "/increment");
      expect(res.status).toBe(405);
      await res.text(); // consume body
    });
  });

  describe("POST /decrement", () => {
    it("decrements and floors at 0 (no negative counts)", async () => {
      const res = await invoke("POST", "/decrement");
      expect(res.status).toBe(200);
      const body = await res.json<{ count: number; operation: string }>();
      expect(body.count).toBe(0);
      expect(body.operation).toBe("decrement");
    });

    it("decrements a positive counter", async () => {
      seedCount(5);
      const res = await invoke("POST", "/decrement"); // 5 - 1 = 4
      const body = await res.json<{ count: number }>();
      expect(body.count).toBe(4);
    });

    it("floors at 0 when decrement exceeds current count", async () => {
      // starts at 0, delta=100 → max(0, 0-100) = 0; single request, no seeding needed
      const res = await invoke("POST", "/decrement", { delta: 100 });
      const body = await res.json<{ count: number }>();
      expect(body.count).toBe(0);
    });

    it("returns 400 for invalid delta", async () => {
      const res = await invoke("POST", "/decrement", { delta: "abc" });
      expect(res.status).toBe(400);
      const body = await res.json<{ error: string }>();
      expect(body.error).toBe("invalid_delta");
    });
  });

  describe("portfolio_visited cookie", () => {
    it("skips increment when cookie is 'true'", async () => {
      seedCount(3);
      const res = await invoke("POST", "/increment", undefined, { Cookie: "portfolio_visited=true" });
      expect(res.status).toBe(200);
      const body = await res.json<{ count: number; operation: string }>();
      expect(body.count).toBe(3); // unchanged
      expect(body.operation).toBe("increment");
    });

    it("increments normally when cookie is absent", async () => {
      seedCount(3);
      const res = await invoke("POST", "/increment");
      const body = await res.json<{ count: number }>();
      expect(body.count).toBe(4);
    });

    it("increments normally when cookie has a different value", async () => {
      seedCount(3);
      const res = await invoke("POST", "/increment", undefined, { Cookie: "portfolio_visited=false" });
      const body = await res.json<{ count: number }>();
      expect(body.count).toBe(4);
    });

    it("does not skip decrement when cookie is 'true'", async () => {
      seedCount(3);
      const res = await invoke("POST", "/decrement", undefined, { Cookie: "portfolio_visited=true" });
      const body = await res.json<{ count: number }>();
      expect(body.count).toBe(2);
    });

    it("sets portfolio_visited cookie with 24h TTL on successful increment", async () => {
      const res = await invoke("POST", "/increment");
      await res.text(); // consume body
      const setCookie = res.headers.get("Set-Cookie") ?? "";
      expect(setCookie).toContain("portfolio_visited=true");
      expect(setCookie).toContain("Max-Age=86400");
      expect(setCookie).toContain("HttpOnly");
    });

    it("does not set portfolio_visited cookie on decrement", async () => {
      seedCount(3);
      const res = await invoke("POST", "/decrement");
      await res.text();
      expect(res.headers.get("Set-Cookie")).toBeNull();
    });
  });

  describe("unknown route", () => {
    it("returns 404 for an unrecognised path", async () => {
      const res = await invoke("GET", "/unknown");
      expect(res.status).toBe(404);
      await res.text(); // consume body
    });
  });
});
