// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
/**
 * BullMQ worker for outbound Slack PR-merge alerts (FUL-34).
 *
 * Each job carries a {@link SlackAlertJobData} that identifies which
 * slack_alert_configs row to use (looked up fresh on every attempt so that
 * config deletions and URL rotations are respected between retries).
 *
 * Retry strategy — configured on the queue, not inside this worker:
 *   - 3 retries after the initial attempt (4 total)
 *   - 60-second fixed delay between each retry
 *
 * This means a transient Slack outage lasting up to 3 minutes will be
 * automatically recovered without any manual intervention.
 *
 * The worker deliberately calls sendSlackAlert with retries=0 so that
 * BullMQ — rather than an in-process sleep loop — owns the back-off timing.
 * This keeps the worker non-blocking and gives visibility in any BullMQ
 * dashboard (Bull Board, Arena, etc.).
 */

import type { Db } from '@niteowl/db';
import { decrypt, schema } from '@niteowl/db';
import type { SlackAlertJobData } from '@niteowl/types';
import { Worker } from 'bullmq';
import { and, eq } from 'drizzle-orm';

import { formatPrMergeAlert, sendSlackAlert } from '../lib/slack-alert.js';

export const SLACK_ALERT_QUEUE = 'slack-alert';

/**
 * Creates and starts the BullMQ Slack-alert worker.
 *
 * @param db          - Drizzle DB client for config lookup.
 * @param redisOptions - Redis connection options (host + port).
 */
export function createSlackAlertWorker(
  db: Db,
  redisOptions: { host: string; port: number },
): Worker<SlackAlertJobData> {
  const worker = new Worker<SlackAlertJobData>(
    SLACK_ALERT_QUEUE,
    async (job) => {
      const { configId, userId, alertData } = job.data;

      // Re-fetch config on every attempt — a user may have updated/deleted it
      // between the initial enqueue and a retry.
      const [config] = await db
        .select({
          webhookUrlEncrypted: schema.slackAlertConfigs.webhookUrlEncrypted,
          enabled: schema.slackAlertConfigs.enabled,
        })
        .from(schema.slackAlertConfigs)
        .where(
          and(
            eq(schema.slackAlertConfigs.id, configId),
            eq(schema.slackAlertConfigs.userId, userId),
          ),
        )
        .limit(1);

      if (!config) {
        // Config deleted since enqueue — drop silently, do not retry.
        console.info(
          `[slack-alert-worker] Config ${configId} no longer exists — dropping job ${job.id ?? ''}`,
        );
        return;
      }

      if (!config.enabled) {
        // Config disabled since enqueue — drop silently, do not retry.
        console.info(
          `[slack-alert-worker] Config ${configId} is disabled — dropping job ${job.id ?? ''}`,
        );
        return;
      }

      const webhookUrl = decrypt(config.webhookUrlEncrypted);
      const message = formatPrMergeAlert(alertData);

      // retries=0 — BullMQ handles the 3-retry / 60-second delay strategy.
      const result = await sendSlackAlert(webhookUrl, message, 0);

      console.info(
        `[slack-alert-worker] Alert sent for config ${configId} (job ${job.id ?? ''}) after ${result.attempts} HTTP attempt(s)`,
      );
    },
    {
      connection: redisOptions,
      concurrency: 20,
    },
  );

  worker.on('failed', (job, err) => {
    console.error(
      `[slack-alert-worker] Job ${job?.id ?? 'unknown'} failed (attempt ${job?.attemptsMade ?? '?'}/4)`,
      {
        configId: job?.data.configId,
        repo: job?.data.alertData.repo,
        error: err.message,
      },
    );
  });

  worker.on('completed', (job) => {
    console.info(
      `[slack-alert-worker] Job ${job.id ?? ''} completed for config ${job.data.configId}`,
    );
  });

  return worker;
}
