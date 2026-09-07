export interface Env {
  UPSTASH_URL: string;
  UPSTASH_TOKEN: string;
  ACCESS_TOKEN: string;
}

export type CounterOperation = "increment" | "decrement" | "read" | "upvote";

export interface CounterResponse {
  count: number;
  operation: CounterOperation;
}

export interface ErrorResponse {
  error: string;
  message: string;
}

export interface RequestBody {
  delta?: unknown;
}
