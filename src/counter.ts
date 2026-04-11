import type { CounterResponse, ErrorResponse, RequestBody } from "./types";

const MIN_COUNT = 0;
const COOKIE_TTL_SECONDS = 24 * 60 * 60; // 24 hours

function jsonResponse(body: CounterResponse | ErrorResponse, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function parseDelta(body: RequestBody): number | null {
  if (body.delta === undefined) return 1;
  if (typeof body.delta !== "number" || !Number.isInteger(body.delta) || body.delta === 0) {
    return null;
  }
  return body.delta;
}

function isReturningVisitor(request: Request): boolean {
  const cookieHeader = request.headers.get("Cookie") ?? "";
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.split("=");
    if (name.trim() === "portfolio_visited" && rest.join("=").trim() === "true") {
      return true;
    }
  }
  return false;
}

export class Counter implements DurableObject {
  private state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    const startMs = Date.now();
    const url = new URL(request.url);
    const pathname = url.pathname;

    // POST /increment and POST /decrement
    if (pathname === "/increment" || pathname === "/decrement") {
      if (request.method !== "POST") {
        return jsonResponse(
          { error: "method_not_allowed", message: "POST is required for " + pathname },
          405
        );
      }

      let body: RequestBody = {};
      try {
        const text = await request.text();
        if (text.trim().length > 0) {
          body = JSON.parse(text) as RequestBody;
        }
      } catch {
        return jsonResponse(
          { error: "invalid_body", message: "request body must be valid JSON" },
          400
        );
      }

      const delta = parseDelta(body);
      if (delta === null) {
        return jsonResponse(
          { error: "invalid_delta", message: "delta must be a non-zero integer" },
          400
        );
      }

      let count: number;
      try {
        count = (await this.state.storage.get<number>("count")) ?? 0;
      } catch (err) {
        console.error("DO storage read failure", err);
        return jsonResponse(
          { error: "storage_failure", message: "failed to read counter from storage" },
          500
        );
      }

      const operation = pathname === "/increment" ? "increment" : "decrement" as const;

      // Skip increment if the visitor has already been counted (cookie "portfolio_visited" === "true")
      if (operation === "increment" && isReturningVisitor(request)) {
        const latencyMs = Date.now() - startMs;
        console.log(JSON.stringify({ operation: "increment_skipped", delta: 0, resulting_count: count, latency_ms: latencyMs }));
        return jsonResponse({ count, operation });
      }

      const effectiveDelta = operation === "increment" ? delta : -delta;
      count = Math.max(MIN_COUNT, count + effectiveDelta);

      try {
        await this.state.storage.put("count", count);
      } catch (err) {
        console.error("DO storage write failure", err);
        return jsonResponse(
          { error: "storage_failure", message: "failed to write counter to storage" },
          500
        );
      }

      const latencyMs = Date.now() - startMs;
      console.log(JSON.stringify({ operation, delta, resulting_count: count, latency_ms: latencyMs }));

      const response = jsonResponse({ count, operation });
      if (operation === "increment") {
        response.headers.append(
          "Set-Cookie",
          `portfolio_visited=true; Max-Age=${COOKIE_TTL_SECONDS}; Path=/; HttpOnly; SameSite=Lax`
        );
      }
      return response;
    }

    return jsonResponse(
      { error: "not_found", message: "unknown path: " + pathname },
      404
    );
  }
}
