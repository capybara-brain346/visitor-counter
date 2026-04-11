import type { Env } from "./types";
import { handleRequest } from "./counter";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },
} satisfies ExportedHandler<Env>;
