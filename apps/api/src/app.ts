import cors from "@fastify/cors";
import Fastify from "fastify";
import type { HealthStatus } from "@niteowl/types";

export function buildApp() {
  const app = Fastify({ logger: true });

  app.register(cors, {
    origin: process.env["CORS_ORIGIN"] ?? "http://localhost:5173",
  });

  app.get("/health", async (): Promise<HealthStatus> => {
    return {
      status: "ok",
      timestamp: new Date().toISOString(),
      services: { db: "ok", redis: "ok" },
    };
  });

  return app;
}
