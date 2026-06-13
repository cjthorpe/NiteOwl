import type { FastifyPluginAsync } from "fastify";
import type { Db } from "@niteowl/db";
import { linearWebhookRoutes } from "./linear.js";

export const webhookRoutes: FastifyPluginAsync<{ db: Db }> = async (
  fastify,
  opts,
) => {
  fastify.register(linearWebhookRoutes, opts);
};
