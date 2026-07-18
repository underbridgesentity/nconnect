import { defineConfig } from "drizzle-kit";
import { config as loadEnv } from "dotenv";
loadEnv({ path: [".env.local", ".env"] });

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./lib/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  strict: true,
  verbose: true,
});
