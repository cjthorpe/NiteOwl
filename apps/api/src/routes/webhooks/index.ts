import type { FastifyPluginAsync } from 'fastify';
import type { Db } from '@niteowl/db';
import { jiraWebhookRoutes } from './jira.js';
import { linearWebhookRoutes } from './linear.js';

export const webhookRoutes: FastifyPluginAsync<{ db: Db }> = async (fastify, opts) => {
  fastify.register(linearWebhookRoutes, opts);
  fastify.register(jiraWebhookRoutes, opts);
};
