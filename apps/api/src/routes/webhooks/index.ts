// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
import type { Db } from '@niteowl/db';
import type { FastifyPluginAsync } from 'fastify';

import { jiraWebhookRoutes } from './jira.js';
import { linearWebhookRoutes } from './linear.js';

export const webhookRoutes: FastifyPluginAsync<{ db: Db }> = async (fastify, opts) => {
  void fastify.register(linearWebhookRoutes, opts);
  void fastify.register(jiraWebhookRoutes, opts);
};
