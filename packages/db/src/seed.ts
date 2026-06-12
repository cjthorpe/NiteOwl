/**
 * Seed script for local development.
 *
 * Inserts fake users, integrations, oauth tokens, activities, and webhook
 * events so engineers can start the dev server with realistic data.
 *
 * Usage:
 *   DATABASE_URL=postgres://... pnpm --filter @niteowl/db db:seed
 */

import { createHash } from "crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const DATABASE_URL =
  process.env["DATABASE_URL"] ??
  "postgres://niteowl:niteowl_dev_password@localhost:5432/niteowl";

const PROVIDERS = ["github", "linear", "jira", "slack"] as const;

const GITHUB_EVENT_TYPES = ["push", "pull_request", "issue", "review"] as const;
const LINEAR_EVENT_TYPES = ["issue_created", "issue_updated", "comment"] as const;
const JIRA_EVENT_TYPES = ["issue_created", "issue_updated", "sprint_started"] as const;
const SLACK_EVENT_TYPES = ["message", "reaction_added", "channel_joined"] as const;

function randomChoice<T>(arr: readonly T[]): T {
  const idx = Math.floor(Math.random() * arr.length);
  if (idx >= arr.length) throw new Error("empty array");
  return arr[idx] as T;
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function fakeEncrypted(value: string): string {
  // Placeholder: real code would AES-256-GCM encrypt before storage.
  return `enc:v1:${Buffer.from(value).toString("base64")}`;
}

function payloadHash(provider: string, eventId: string): string {
  return createHash("sha256").update(`${provider}:${eventId}`).digest("hex");
}

async function seed(): Promise<void> {
  const client = postgres(DATABASE_URL);
  const db = drizzle(client, { schema });

  console.log("Seeding database…");

  // ------------------------------------------------------------------
  // Users
  // ------------------------------------------------------------------
  const seedUsers = [
    { email: "alice@example.com" },
    { email: "bob@example.com" },
    { email: "carol@example.com" },
  ];

  const insertedUsers = await db
    .insert(schema.users)
    .values(seedUsers)
    .onConflictDoNothing()
    .returning();

  console.log(`  users: ${insertedUsers.length} inserted`);

  if (insertedUsers.length === 0) {
    console.log("  Data already present — skipping remaining seed steps.");
    await client.end();
    return;
  }

  // ------------------------------------------------------------------
  // OAuth tokens + integrations
  // ------------------------------------------------------------------
  for (const user of insertedUsers) {
    for (const provider of PROVIDERS) {
      await db
        .insert(schema.oauthTokens)
        .values({
          userId: user.id,
          provider,
          accessTokenEncrypted: fakeEncrypted(`at-${provider}-${user.id}`),
          refreshTokenEncrypted: fakeEncrypted(`rt-${provider}-${user.id}`),
          expiresAt: daysAgo(-30), // expires 30 days from now
        })
        .onConflictDoNothing();

      await db
        .insert(schema.integrations)
        .values({
          userId: user.id,
          provider,
          configJson: { autoSync: true, webhooksEnabled: true },
          connectedAt: daysAgo(60),
          lastSyncedAt: daysAgo(1),
        })
        .onConflictDoNothing();
    }
  }

  console.log(`  oauth_tokens + integrations: seeded for ${insertedUsers.length} users × 4 providers`);

  // ------------------------------------------------------------------
  // Activities (30 per user across providers)
  // ------------------------------------------------------------------
  const activityRows: schema.NewActivity[] = [];

  for (const user of insertedUsers) {
    for (let i = 0; i < 30; i++) {
      const provider = randomChoice(PROVIDERS);
      const eventTypeMap = {
        github: GITHUB_EVENT_TYPES,
        linear: LINEAR_EVENT_TYPES,
        jira: JIRA_EVENT_TYPES,
        slack: SLACK_EVENT_TYPES,
      } as const;
      const eventType = randomChoice(eventTypeMap[provider]);
      const sourceId = `${provider}-evt-${user.id.slice(0, 8)}-${i}`;

      activityRows.push({
        userId: user.id,
        provider,
        eventType,
        sourceId,
        title: `[${provider}] ${eventType} #${i + 1}`,
        url: `https://${provider}.example.com/events/${sourceId}`,
        metadataJson: { seeded: true, index: i },
        occurredAt: daysAgo(Math.floor(Math.random() * 30)),
      });
    }
  }

  const insertedActivities = await db
    .insert(schema.activities)
    .values(activityRows)
    .onConflictDoNothing()
    .returning();

  console.log(`  activities: ${insertedActivities.length} inserted`);

  // ------------------------------------------------------------------
  // Webhook events (idempotency records)
  // ------------------------------------------------------------------
  const webhookRows: schema.NewWebhookEvent[] = activityRows.slice(0, 20).map((a) => ({
    provider: a.provider,
    payloadHash: payloadHash(a.provider, a.sourceId),
  }));

  const insertedWebhooks = await db
    .insert(schema.webhookEvents)
    .values(webhookRows)
    .onConflictDoNothing()
    .returning();

  console.log(`  webhook_events: ${insertedWebhooks.length} inserted`);

  await client.end();
  console.log("Seed complete.");
}

seed().catch((err: unknown) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
