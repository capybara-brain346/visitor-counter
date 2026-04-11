export interface Env {
  UPSTASH_URL: string;
  UPSTASH_TOKEN: string;
}

export interface CounterResponse {
  count: number;
  operation: "increment" | "decrement" | "read";
}

export interface ErrorResponse {
  error: string;
  message: string;
}

export interface RequestBody {
  delta?: unknown;
}
