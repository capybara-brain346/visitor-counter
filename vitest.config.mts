import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.toml" },
      miniflare: {
        vars: {
          UPSTASH_URL: "https://test.upstash.io",
          UPSTASH_TOKEN: "test-token",
        },
      },
    }),
  ],
});
