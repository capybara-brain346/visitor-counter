import { defineWorkersConfig, readD1Migrations } from "@cloudflare/vitest-pool-workers/config";
import path from "node:path";

export default defineWorkersConfig(async () => {
  const migrations = await readD1Migrations(
    path.join(import.meta.dirname, "migrations")
  );

  return {
    test: {
      poolOptions: {
        workers: {
          wrangler: { configPath: "./wrangler.toml" },
          miniflare: {
            bindings: { TEST_MIGRATIONS: migrations },
          },
        },
      },
    },
  };
});
