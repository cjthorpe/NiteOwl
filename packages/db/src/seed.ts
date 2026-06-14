/**
 * Seed script for local development.
 *
 * Inserts fake users, integrations, oauth tokens, activity_events,
 * slack_alert_configs, and webhook events so engineers can start the dev
 * server with realistic data.
 *
 * Usage:
 *   DATABASE_URL=postgres://... pnpm --filter @niteowl/db db:seed
 */

import { createHash } from 'crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgres://niteowl:niteowl_dev_password@localhost:5432/niteowl';

const PROVIDERS = ['github', 'linear', 'jira', 'slack'] as const;

const GITHUB_EVENT_TYPES = ['push', 'pull_request', 'issue', 'review'] as const;
const LINEAR_EVENT_TYPES = ['issue_created', 'issue_updated', 'comment'] as const;
const JIRA_EVENT_TYPES = ['issue_created', 'issue_updated', 'sprint_started'] as const;
const SLACK_EVENT_TYPES = ['message', 'reaction_added', 'channel_joined'] as const;

const PROVIDER_SCOPES: Record<string, string> = {
  github: 'repo read:user notifications',
  linear: 'read write',
  jira: 'read:jira-work write:jira-work',
  slack: 'channels:read chat:write reactions:read',
};

function randomChoice<T>(arr: readonly T[]): T {
  const idx = Math.floor(Math.random() * arr.length);
  if (idx >= arr.length) throw new Error('empty array');
  return arr[idx] as T;
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

/** Placeholder: real code would AES-256-GCM encrypt before storage */
function fakeEncrypted(value: string): string {
  return `enc:v1:${Buffer.from(value).toString('base64')}`;
}

function payloadHash(provider: string, eventId: string): string {
  return createHash('sha256').update(`${provider}:${eventId}`).digest('hex');
}

async function seed(): Promise<void> {
  const client = postgres(DATABASE_URL);
  const db = drizzle(client, { schema });

  console.log('Seeding database…');

  // ------------------------------------------------------------------
  // Users
  // ------------------------------------------------------------------
  const seedUsers = [
    { email: 'alice@example.com', displayName: 'Alice' },
    { email: 'bob@example.com', displayName: 'Bob' },
    { email: 'carol@example.com', displayName: 'Carol' },
  ];

  const insertedUsers = await db
    .insert(schema.users)
    .values(seedUsers)
    .onConflictDoNothing()
    .returning();

  console.log(`  users: ${insertedUsers.length} inserted`);

  if (insertedUsers.length === 0) {
    console.log('  Data already present — skipping remaining seed steps.');
    await client.end();
    return;
  }

  // ------------------------------------------------------------------
  // OAuth tokens + integrations (one per user per provider)
  // ------------------------------------------------------------------
  const integrationsByUser: Record<string, Record<string, string>> = {};

  for (const user of insertedUsers) {
    integrationsByUser[user.id] = {};

    for (const provider of PROVIDERS) {
      await db
        .insert(schema.oauthTokens)
        .values({
          userId: user.id,
          provider,
          accessTokenEncrypted: fakeEncrypted(`at-${provider}-${user.id}`),
          refreshTokenEncrypted: fakeEncrypted(`rt-${provider}-${user.id}`),
          expiresAt: daysAgo(-30), // expires 30 days from now
          scopes: PROVIDER_SCOPES[provider],
        })
        .onConflictDoNothing();

      const [integration] = await db
        .insert(schema.integrations)
        .values({
          userId: user.id,
          provider,
          configJson: { autoSync: true, webhooksEnabled: true },
          enabled: true,
          connectedAt: daysAgo(60),
          lastSyncedAt: daysAgo(1),
        })
        .returning();

      if (integration) {
        integrationsByUser[user.id]![provider] = integration.id;
      }
    }
  }

  console.log(
    `  oauth_tokens + integrations: seeded for ${insertedUsers.length} users × 4 providers`,
  );

  // ------------------------------------------------------------------
  // Activity events (30 per user across providers)
  // ------------------------------------------------------------------
  const activityRows: schema.NewActivityEvent[] = [];

  for (const user of insertedUsers) {
    for (let i = 0; i < 30; i++) {
      const provider = randomChoice(PROVIDERS);
      const integrationId = integrationsByUser[user.id]?.[provider];
      if (!integrationId) continue;

      const eventTypeMap = {
        github: GITHUB_EVENT_TYPES,
        linear: LINEAR_EVENT_TYPES,
        jira: JIRA_EVENT_TYPES,
        slack: SLACK_EVENT_TYPES,
      } as const;
      const eventType = randomChoice(eventTypeMap[provider]);
      const externalId = `${provider}-evt-${user.id.slice(0, 8)}-${i}`;

      activityRows.push({
        userId: user.id,
        integrationId,
        provider,
        eventType,
        externalId,
        title: `[${provider}] ${eventType} #${i + 1}`,
        url: `https://${provider}.example.com/events/${externalId}`,
        metadata: { seeded: true, index: i },
        occurredAt: daysAgo(Math.floor(Math.random() * 30)),
      });
    }
  }

  const insertedActivities = await db
    .insert(schema.activityEvents)
    .values(activityRows)
    .onConflictDoNothing()
    .returning();

  console.log(`  activity_events: ${insertedActivities.length} inserted`);

  // ------------------------------------------------------------------
  // Slack alert configs (one per user)
  // ------------------------------------------------------------------
  const slackConfigRows: schema.NewSlackAlertConfig[] = insertedUsers.map((user) => ({
    userId: user.id,
    webhookUrlEncrypted: fakeEncrypted(
      `https://hooks.slack.com/services/T00000/${user.id.slice(0, 8)}`,
    ),
    watchedRepos: ['niteowl/api', 'niteowl/web'],
  }));

  const insertedSlackConfigs = await db
    .insert(schema.slackAlertConfigs)
    .values(slackConfigRows)
    .onConflictDoNothing()
    .returning();

  console.log(`  slack_alert_configs: ${insertedSlackConfigs.length} inserted`);

  // ------------------------------------------------------------------
  // Webhook events (idempotency records for the first 20 activities)
  // ------------------------------------------------------------------
  const webhookRows: schema.NewWebhookEvent[] = activityRows.slice(0, 20).map((a) => ({
    provider: a.provider,
    payloadHash: payloadHash(a.provider, a.externalId),
    eventType: a.eventType,
    status: 'processed' as const,
    processedAt: new Date(),
  }));

  const insertedWebhooks = await db
    .insert(schema.webhookEvents)
    .values(webhookRows)
    .onConflictDoNothing()
    .returning();

  console.log(`  webhook_events: ${insertedWebhooks.length} inserted`);

  await client.end();
  console.log('Seed complete.');
}

seed().catch((err: unknown) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
