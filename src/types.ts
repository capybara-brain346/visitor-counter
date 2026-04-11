export interface Env {
  counter_db_apac: D1Database;
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
