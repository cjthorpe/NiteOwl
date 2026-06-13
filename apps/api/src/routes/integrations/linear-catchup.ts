import { and, eq } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";

import type { Db } from "@niteowl/db";
import { schema } from "@niteowl/db";

import { requireAuth } from "../../plugins/auth.js";

// ---------------------------------------------------------------------------
// Linear GraphQL types (minimal)
// ---------------------------------------------------------------------------

interface LinearIssueNode {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  url: string;
  state: { name: string; type: string };
  team: { name: string; key: string };
  completedAt: string | null;
  canceledAt: string | null;
  createdAt: string;
  updatedAt: string;
  assignee: { name: string; email: string } | null;
  creator: { name: string; email: string } | null;
}

interface LinearIssuesResponse {
  data?: {
    issues?: {
      nodes: LinearIssueNode[];
    };
  };
  errors?: Array<{ message: string }>;
}

const CATCHUP_QUERY = `
  query RecentCompleted($since: DateTimeOrDuration!) {
    issues(
      filter: {
        completedAt: { gte: $since }
      }
      orderBy: updatedAt
      first: 100
    ) {
      nodes {
        id
        identifier
        title
        description
        url
        state { name type }
        team { name key }
        completedAt
        canceledAt
        createdAt
        updatedAt
        assignee { name email }
        creator { name email }
      }
    }
  }
`;

async function fetchRecentlyCompletedIssues(
  accessToken: string,
  since: Date,
): Promise<LinearIssueNode[]> {
  const res = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: CATCHUP_QUERY,
      variables: { since: since.toISOString() },
    }),
  });

  if (!res.ok) {
    throw new Error(`Linear API error: ${res.status}`);
  }

  const body = (await res.json()) as LinearIssuesResponse;

  if (body.errors && body.errors.length > 0) {
    throw new Error(
      `Linear GraphQL error: ${body.errors.map((e) => e.message).join(", ")}`,
    );
  }

  return body.data?.issues?.nodes ?? [];
}

function issueToExternalId(issue: LinearIssueNode): string {
  // Stable external ID: maps to the "update completed" action in the normalizer.
  return `issue:${issue.id}:update`;
}

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

export const linearCatchupRoutes: FastifyPluginAsync<{ db: Db }> = async (
  fastify,
  { db },
) => {
  /**
   * POST /api/integrations/linear/catchup
   *
   * Fetches issues completed in the last 24 h from Linear and inserts any
   * missing ones into activity_events. Idempotent — duplicate externalIds are
   * silently ignored via ON CONFLICT DO NOTHING.
   */
  fastify.post(
    "/linear/catchup",
    {
      preHandler: requireAuth,
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const userId = request.user!.sub;

      // ── Find the user's Linear integration ──────────────────────────────────
      const [integration] = await db
        .select({ id: schema.integrations.id, configJson: schema.integrations.configJson })
        .from(schema.integrations)
        .where(
          and(
            eq(schema.integrations.userId, userId),
            eq(schema.integrations.provider, "linear"),
            eq(schema.integrations.enabled, true),
          ),
        )
        .limit(1);

      if (!integration) {
        return reply.code(404).send({
          success: false,
          error: "No enabled Linear integration found",
        });
      }

      // ── Get the stored OAuth token ───────────────────────────────────────────
      const [tokenRow] = await db
        .select({ accessTokenEncrypted: schema.oauthTokens.accessTokenEncrypted })
        .from(schema.oauthTokens)
        .where(
          and(
            eq(schema.oauthTokens.userId, userId),
            eq(schema.oauthTokens.provider, "linear"),
          ),
        )
        .limit(1);

      if (!tokenRow) {
        return reply.code(404).send({
          success: false,
          error: "No Linear OAuth token found",
        });
      }

      const accessToken = tokenRow.accessTokenEncrypted;

      // ── Fetch issues completed in the last 24 h ──────────────────────────────
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

      let issues: LinearIssueNode[];
      try {
        issues = await fetchRecentlyCompletedIssues(accessToken, since);
      } catch (err) {
        const message = err instanceof Error ? err.message : "fetch_failed";
        request.log.error({ error: message }, "[linear-catchup] Failed to fetch issues");
        return reply.code(502).send({ success: false, error: message });
      }

      if (issues.length === 0) {
        await db
          .update(schema.integrations)
          .set({ lastSyncedAt: new Date() })
          .where(eq(schema.integrations.id, integration.id));

        return reply.code(200).send({ success: true, data: { ingested: 0 } });
      }

      // ── Normalise and upsert activity events ─────────────────────────────────
      const rows = issues.map((issue) => {
        const stateType = issue.state.type;
        const occurredAt = new Date(
          issue.completedAt ?? issue.canceledAt ?? issue.updatedAt,
        );
        const eventType =
          stateType === "completed" || stateType === "cancelled"
            ? "issue_closed"
            : "issue_updated";

        return {
          userId,
          integrationId: integration.id,
          provider: "linear" as const,
          eventType,
          externalId: issueToExternalId(issue),
          title: `[${issue.team.key}] ${issue.identifier}: ${issue.title}`,
          url: issue.url,
          metadata: {
            identifier: issue.identifier,
            teamKey: issue.team.key,
            teamName: issue.team.name,
            state: issue.state.name,
            stateType,
            assignee: issue.assignee?.name ?? null,
            creator: issue.creator?.name ?? null,
          },
          occurredAt,
        };
      });

      // Batch insert; duplicate externalIds are silently skipped.
      await db
        .insert(schema.activityEvents)
        .values(rows)
        .onConflictDoNothing();

      await db
        .update(schema.integrations)
        .set({ lastSyncedAt: new Date() })
        .where(eq(schema.integrations.id, integration.id));

      return reply.code(200).send({
        success: true,
        data: { ingested: rows.length },
      });
    },
  );
};
