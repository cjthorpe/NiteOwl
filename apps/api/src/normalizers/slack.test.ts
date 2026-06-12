import { describe, expect, it } from "vitest";
import { normalizeSlackEvent } from "./slack.js";

const USER_ID = "user-abc-123";

// ---------------------------------------------------------------------------
// Fixtures — derived from Slack Events API documentation
// ---------------------------------------------------------------------------

const plainMessagePayload = {
  type: "event_callback",
  team_id: "T01ABCDE",
  api_app_id: "A02ABCDE",
  event_id: "Ev123456",
  event_time: 1710505200,
  event: {
    type: "message",
    channel: "C01GENERAL",
    channel_type: "channel",
    user: "U01USER",
    text: "Hey team, the deploy just went out to prod!",
    ts: "1710505200.123456",
    permalink: "https://acme.slack.com/archives/C01GENERAL/p1710505200123456",
  },
};

const threadedMessagePayload = {
  type: "event_callback",
  team_id: "T01ABCDE",
  api_app_id: "A02ABCDE",
  event_id: "Ev789012",
  event_time: 1710506000,
  event: {
    type: "message",
    channel: "C01ENGINEERING",
    channel_type: "channel",
    user: "U02USER",
    text: "LGTM, merging now",
    ts: "1710506000.654321",
    thread_ts: "1710505000.000000",
    permalink:
      "https://acme.slack.com/archives/C01ENGINEERING/p1710506000654321",
  },
};

const longMessagePayload = {
  type: "event_callback",
  team_id: "T01ABCDE",
  api_app_id: "A02ABCDE",
  event_id: "Ev999",
  event_time: 1710507000,
  event: {
    type: "message",
    channel: "C01GENERAL",
    channel_type: "channel",
    user: "U03USER",
    text: "A".repeat(200),
    ts: "1710507000.000001",
  },
};

const botMessagePayload = {
  type: "event_callback",
  team_id: "T01ABCDE",
  api_app_id: "A02ABCDE",
  event_id: "Ev111",
  event_time: 1710508000,
  event: {
    type: "message",
    subtype: "bot_message",
    channel: "C01GENERAL",
    text: "Deploy #123 succeeded",
    ts: "1710508000.000001",
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("normalizeSlackEvent — plain message", () => {
  it("normalizes a plain channel message", () => {
    const result = normalizeSlackEvent(plainMessagePayload, USER_ID);

    expect(result).not.toBeNull();
    expect(result?.provider).toBe("slack");
    expect(result?.eventType).toBe("issue_updated");
    expect(result?.userId).toBe(USER_ID);
    expect(result?.title).toBe("Slack message in #C01GENERAL");
    expect(result?.description).toBe(
      "Hey team, the deploy just went out to prod!",
    );
    expect(result?.url).toBe(
      "https://acme.slack.com/archives/C01GENERAL/p1710505200123456",
    );
    expect(result?.sourceId).toBe("message:Ev123456");
    expect(result?.metadata).toMatchObject({
      channelId: "C01GENERAL",
      teamId: "T01ABCDE",
      slackUserId: "U01USER",
      threadTs: null,
    });
  });

  it("records thread_ts when message is a reply", () => {
    const result = normalizeSlackEvent(threadedMessagePayload, USER_ID);

    expect(result?.metadata).toMatchObject({
      threadTs: "1710505000.000000",
    });
  });

  it("truncates description at 120 chars for long messages", () => {
    const result = normalizeSlackEvent(longMessagePayload, USER_ID);

    expect(result?.description?.length).toBeLessThanOrEqual(122); // 120 + "…"
    expect(result?.description?.endsWith("…")).toBe(true);
  });

  it("converts Slack ts to a valid ISO timestamp for occurredAt", () => {
    const result = normalizeSlackEvent(plainMessagePayload, USER_ID);

    expect(result?.occurredAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(new Date(result!.occurredAt).getTime()).toBeGreaterThan(0);
  });
});

describe("normalizeSlackEvent — skipped event types", () => {
  it("returns null for bot_message subtype", () => {
    const result = normalizeSlackEvent(botMessagePayload, USER_ID);
    expect(result).toBeNull();
  });

  it("returns null for non-event_callback type", () => {
    expect(
      normalizeSlackEvent({ type: "url_verification", challenge: "abc" }, USER_ID),
    ).toBeNull();
  });

  it("returns null for a non-message event type", () => {
    const reactionPayload = {
      ...plainMessagePayload,
      event: { ...plainMessagePayload.event, type: "reaction_added" },
    };
    expect(normalizeSlackEvent(reactionPayload, USER_ID)).toBeNull();
  });

  it("returns null for empty payload", () => {
    expect(normalizeSlackEvent({}, USER_ID)).toBeNull();
  });
});

describe("normalizeSlackEvent — URL fallback", () => {
  it("constructs archive URL when permalink is absent", () => {
    const payloadWithoutPermalink = {
      ...plainMessagePayload,
      event: {
        ...plainMessagePayload.event,
        ts: "1710505200.123456",
        permalink: undefined,
      },
    };
    const result = normalizeSlackEvent(payloadWithoutPermalink, USER_ID);

    expect(result?.url).toContain("slack.com/archives");
    expect(result?.url).toContain("C01GENERAL");
  });
});

describe("normalizeSlackEvent — determinism", () => {
  it("produces stable non-volatile fields across two calls", () => {
    const a = normalizeSlackEvent(plainMessagePayload, USER_ID);
    const b = normalizeSlackEvent(plainMessagePayload, USER_ID);

    const { id: _ia, ingestedAt: _iia, ...restA } = a!;
    const { id: _ib, ingestedAt: _iib, ...restB } = b!;

    expect(restA).toEqual(restB);
  });
});
