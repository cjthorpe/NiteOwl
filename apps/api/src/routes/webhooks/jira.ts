import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import type { Db } from '@niteowl/db';
import { schema } from '@niteowl/db';

import { timingSafeCompare } from '../../lib/crypto.js';
import { normalizeJiraEvent } from '../../normalizers/jira.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

async function markWebhookStatus(
  db: Db,
  payloadHash: string,
  status: 'processed' | 'failed',
): Promise<void> {
  await db
    .update(schema.webhookEvents)
    .set({ status, processedAt: new Date() })
    .where(
      and(
        eq(schema.webhookEvents.provider, 'jira'),
        eq(schema.webhookEvents.payloadHash, payloadHash),
      ),
    );
}

// ---------------------------------------------------------------------------
// Webhook plugin
// ---------------------------------------------------------------------------

export const jiraWebhookRoutes: FastifyPluginAsync<{ db: Db }> = async (fastify, { db }) => {
  // Override the JSON content-type parser for this plugin scope so we receive
  // the raw Buffer. This is required for idempotency hashing of the exact bytes.
  fastify.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => {
    done(null, body as Buffer);
  });

  fastify.post<{
    Querystring: { token?: string };
    Body: Buffer;
  }>(
    '/jira',
    {
      // Generous limit — webhooks come from Jira's infrastructure, not end-users.
      config: { rateLimit: { max: 500, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const rawBody = request.body;

      // ── 1. Token verification ──────────────────────────────────────────────
      // Jira Cloud does not sign webhook payloads with HMAC by default.
      // Security is enforced via a shared secret embedded in the webhook URL
      // as a ?token= query parameter — timing-safe comparison prevents leaks.
      const secret = process.env['JIRA_WEBHOOK_SECRET'];
      if (!secret) {
        request.log.error('[jira-webhook] JIRA_WEBHOOK_SECRET not configured');
        return reply.code(500).send({ error: 'Webhook not configured' });
      }

      const token = request.query.token;
      if (typeof token !== 'string' || token.length === 0) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      if (!timingSafeCompare(token, secret)) {
        request.log.warn('[jira-webhook] Invalid token');
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      // ── 2. Parse JSON body ─────────────────────────────────────────────────
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>;
      } catch {
        return reply.code(400).send({ error: 'Invalid JSON payload' });
      }

      // ── 3. Idempotency — record this delivery before processing ────────────
      const payloadHash = sha256Hex(rawBody);
      const eventType =
        typeof payload['webhookEvent'] === 'string' ? payload['webhookEvent'] : null;

      try {
        await db.insert(schema.webhookEvents).values({
          provider: 'jira',
          payloadHash,
          eventType,
          status: 'received',
        });
      } catch {
        // Unique constraint on (provider, payloadHash) → duplicate delivery.
        request.log.info({ payloadHash }, '[jira-webhook] Duplicate delivery, acknowledging');
        return reply.code(200).send({ status: 'duplicate' });
      }

      // ── 4. Resolve integration from issue.self host ────────────────────────
      // Both issue and comment payloads include an `issue` object with a `self`
      // field pointing to the Jira REST API URL. Extract the host to match
      // against the siteUrl stored in the integration config.
      const issueObj = payload['issue'];
      const selfStr =
        issueObj != null &&
        typeof issueObj === 'object' &&
        'self' in issueObj &&
        typeof (issueObj as Record<string, unknown>)['self'] === 'string'
          ? ((issueObj as Record<string, unknown>)['self'] as string)
          : null;

      if (!selfStr) {
        request.log.warn('[jira-webhook] Missing issue.self — cannot resolve integration');
        await markWebhookStatus(db, payloadHash, 'failed');
        return reply.code(200).send({ status: 'skipped' });
      }

      let siteUrl: string;
      try {
        const parsed = new URL(selfStr);
        siteUrl = `${parsed.protocol}//${parsed.host}`;
      } catch {
        request.log.warn({ selfStr }, '[jira-webhook] Malformed issue.self URL');
        await markWebhookStatus(db, payloadHash, 'failed');
        return reply.code(200).send({ status: 'skipped' });
      }

      const [integration] = await db
        .select({
          id: schema.integrations.id,
          userId: schema.integrations.userId,
        })
        .from(schema.integrations)
        .where(
          and(
            eq(schema.integrations.provider, 'jira'),
            eq(schema.integrations.enabled, true),
            sql`${schema.integrations.configJson}->>'siteUrl' = ${siteUrl}`,
          ),
        )
        .limit(1);

      if (!integration) {
        request.log.warn({ siteUrl }, '[jira-webhook] No enabled integration for site');
        await markWebhookStatus(db, payloadHash, 'failed');
        return reply.code(200).send({ status: 'no_integration' });
      }

      // ── 5. Normalize the event ─────────────────────────────────────────────
      const activity = normalizeJiraEvent(payload, integration.userId);

      if (!activity) {
        request.log.debug({ eventType }, '[jira-webhook] Event not actionable, skipping');
        await markWebhookStatus(db, payloadHash, 'processed');
        return reply.code(200).send({ status: 'skipped' });
      }

      // ── 6. Persist activity event (idempotent) ─────────────────────────────
      await db
        .insert(schema.activityEvents)
        .values({
          userId: integration.userId,
          integrationId: integration.id,
          provider: 'jira',
          eventType: activity.eventType,
          externalId: activity.sourceId,
          title: activity.title,
          url: activity.url ?? null,
          metadata: activity.metadata,
          occurredAt: new Date(activity.occurredAt),
        })
        .onConflictDoNothing();

      // Update last-synced timestamp on the integration
      await db
        .update(schema.integrations)
        .set({ lastSyncedAt: new Date() })
        .where(eq(schema.integrations.id, integration.id));

      await markWebhookStatus(db, payloadHash, 'processed');

      request.log.info(
        {
          eventType: activity.eventType,
          sourceId: activity.sourceId,
          userId: integration.userId,
        },
        '[jira-webhook] Ingested activity',
      );

      return reply.code(200).send({ status: 'ok' });
    },
  );
};
