import type { Env } from "./types";

export { Counter } from "./counter";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const id = env.COUNTER.idFromName("global");
    const stub = env.COUNTER.get(id);
    return stub.fetch(request);
  },
} satisfies ExportedHandler<Env>;
