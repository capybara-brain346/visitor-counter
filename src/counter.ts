import type { Env, CounterResponse, ErrorResponse, RequestBody } from "./types";

const COUNTER_KEY = "counter:global";
const COOKIE_TTL_SECONDS = 24 * 60 * 60; // 24 hours

// Atomically add delta to the counter and clamp the result to >= 0
const UPSERT_SCRIPT =
  "local current = redis.call('GET', KEYS[1])" +
  " if not current then current = '0' end" +
  " local new_val = math.max(0, tonumber(current) + tonumber(ARGV[1]))" +
  " redis.call('SET', KEYS[1], tostring(new_val))" +
  " return new_val";

async function redisCommand(env: Env, ...args: unknown[]): Promise<unknown> {
  const res = await fetch(env.UPSTASH_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.UPSTASH_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });
  const data = await res.json<{ result: unknown }>();
  return data.result;
}

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

function isAuthorized(request: Request, env: Env): boolean {
  const authHeader = request.headers.get("Authorization") ?? "";
  const [scheme, token] = authHeader.split(" ");
  return scheme === "Bearer" && token === env.ACCESS_TOKEN;
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  if (!isAuthorized(request, env)) {
    return jsonResponse({ error: "unauthorized", message: "invalid or missing access token" }, 401);
  }

  const startMs = Date.now();
  const url = new URL(request.url);
  const pathname = url.pathname;

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

    const operation = pathname === "/increment" ? "increment" : ("decrement" as const);

    // Skip increment if the visitor has already been counted (cookie "portfolio_visited" === "true")
    if (operation === "increment" && isReturningVisitor(request)) {
      let count: number;
      try {
        const val = await redisCommand(env, "GET", COUNTER_KEY);
        count = val !== null ? Number(val) : 0;
      } catch (err) {
        console.error("Redis read failure", err);
        return jsonResponse(
          { error: "storage_failure", message: "failed to read counter from storage" },
          500
        );
      }
      const latencyMs = Date.now() - startMs;
      console.log(JSON.stringify({ operation: "increment_skipped", delta: 0, resulting_count: count, latency_ms: latencyMs }));
      return jsonResponse({ count, operation });
    }

    const effectiveDelta = operation === "increment" ? delta : -delta;

    let count: number;
    try {
      const result = await redisCommand(env, "EVAL", UPSERT_SCRIPT, 1, COUNTER_KEY, String(effectiveDelta));
      count = Number(result);
    } catch (err) {
      console.error("Redis write failure", err);
      return jsonResponse(
        { error: "storage_failure", message: "failed to update counter in storage" },
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
