export interface Env {
  COUNTER: DurableObjectNamespace;
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
