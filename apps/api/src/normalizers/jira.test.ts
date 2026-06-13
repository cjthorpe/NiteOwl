import { describe, expect, it } from "vitest";
import { normalizeJiraEvent } from "./jira.js";

const USER_ID = "user-abc-123";

// ---------------------------------------------------------------------------
// Fixtures — derived from Jira webhook documentation
// ---------------------------------------------------------------------------

const issueCreatedPayload = {
  webhookEvent: "jira:issue_created",
  issue: {
    id: "10001",
    key: "PROJ-42",
    self: "https://acme.atlassian.net/rest/api/2/issue/10001",
    fields: {
      summary: "Login page crashes on Firefox 124",
      description: "Repro steps: open login page in Firefox 124...",
      status: {
        name: "To Do",
        statusCategory: { key: "new" },
      },
      issuetype: { name: "Bug" },
      project: { key: "PROJ", name: "Main Project" },
      created: "2024-03-15T08:00:00.000+0000",
      updated: "2024-03-15T08:00:00.000+0000",
      resolutiondate: null,
      assignee: {
        displayName: "Alice Dev",
        emailAddress: "alice@acme.com",
      },
      reporter: {
        displayName: "Bob QA",
        emailAddress: "bob@acme.com",
      },
    },
  },
  user: { displayName: "Bob QA", emailAddress: "bob@acme.com" },
};

const issueUpdatedInProgressPayload = {
  webhookEvent: "jira:issue_updated",
  issue: {
    id: "10001",
    key: "PROJ-42",
    self: "https://acme.atlassian.net/rest/api/2/issue/10001",
    fields: {
      summary: "Login page crashes on Firefox 124",
      description: null,
      status: {
        name: "In Progress",
        statusCategory: { key: "indeterminate" },
      },
      issuetype: { name: "Bug" },
      project: { key: "PROJ", name: "Main Project" },
      created: "2024-03-15T08:00:00.000+0000",
      updated: "2024-03-16T10:00:00.000+0000",
      resolutiondate: null,
      assignee: { displayName: "Alice Dev", emailAddress: "alice@acme.com" },
      reporter: null,
    },
  },
};

const issueResolvedPayload = {
  webhookEvent: "jira:issue_updated",
  issue: {
    id: "10001",
    key: "PROJ-42",
    self: "https://acme.atlassian.net/rest/api/2/issue/10001",
    fields: {
      summary: "Login page crashes on Firefox 124",
      description: null,
      status: {
        name: "Done",
        statusCategory: { key: "done" },
      },
      issuetype: { name: "Bug" },
      project: { key: "PROJ", name: "Main Project" },
      created: "2024-03-15T08:00:00.000+0000",
      updated: "2024-03-18T16:00:00.000+0000",
      resolutiondate: "2024-03-18T16:00:00.000+0000",
      assignee: null,
      reporter: null,
    },
  },
};

const issueDeletedPayload = {
  webhookEvent: "jira:issue_deleted",
  issue: {
    id: "10002",
    key: "PROJ-43",
    self: "https://acme.atlassian.net/rest/api/2/issue/10002",
    fields: {
      summary: "Old feature — remove",
      description: null,
      status: {
        name: "To Do",
        statusCategory: { key: "new" },
      },
      issuetype: { name: "Task" },
      project: { key: "PROJ", name: "Main Project" },
      created: "2024-01-01T00:00:00.000+0000",
      updated: "2024-03-18T12:00:00.000+0000",
      resolutiondate: null,
      assignee: null,
      reporter: null,
    },
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("normalizeJiraEvent — issue_opened", () => {
  it("normalizes a jira:issue_created event", () => {
    const result = normalizeJiraEvent(issueCreatedPayload, USER_ID);

    expect(result).not.toBeNull();
    expect(result?.provider).toBe("jira");
    expect(result?.eventType).toBe("issue_opened");
    expect(result?.userId).toBe(USER_ID);
    expect(result?.title).toBe("[PROJ] PROJ-42: Login page crashes on Firefox 124");
    expect(result?.description).toBe("Repro steps: open login page in Firefox 124...");
    expect(result?.url).toBe("https://acme.atlassian.net/browse/PROJ-42");
    expect(result?.sourceId).toBe("issue:10001:jira:issue_created");
    expect(result?.occurredAt).toBe("2024-03-15T08:00:00.000+0000");
    expect(result?.metadata).toMatchObject({
      issueKey: "PROJ-42",
      issueType: "Bug",
      projectKey: "PROJ",
      assignee: "Alice Dev",
      reporter: "Bob QA",
    });
  });
});

describe("normalizeJiraEvent — issue_updated", () => {
  it("returns issue_updated for a non-done status category", () => {
    const result = normalizeJiraEvent(issueUpdatedInProgressPayload, USER_ID);

    expect(result?.eventType).toBe("issue_updated");
    expect(result?.occurredAt).toBe("2024-03-16T10:00:00.000+0000");
    expect(result?.description).toBeUndefined();
    expect(result?.metadata).toMatchObject({ statusCategory: "indeterminate" });
  });

  it("returns issue_closed when status category is done", () => {
    const result = normalizeJiraEvent(issueResolvedPayload, USER_ID);

    expect(result?.eventType).toBe("issue_closed");
    expect(result?.occurredAt).toBe("2024-03-18T16:00:00.000+0000");
  });
});

describe("normalizeJiraEvent — issue_closed via delete", () => {
  it("maps jira:issue_deleted to issue_closed", () => {
    const result = normalizeJiraEvent(issueDeletedPayload, USER_ID);

    expect(result?.eventType).toBe("issue_closed");
    expect(result?.sourceId).toBe("issue:10002:jira:issue_deleted");
  });
});

describe("normalizeJiraEvent — invalid payloads", () => {
  it("returns null for an unknown webhookEvent", () => {
    expect(
      normalizeJiraEvent({ webhookEvent: "jira:sprint_started", issue: issueCreatedPayload.issue }, USER_ID),
    ).toBeNull();
  });

  it("returns null for missing webhookEvent", () => {
    expect(normalizeJiraEvent({ issue: {} }, USER_ID)).toBeNull();
  });

  it("returns null for empty payload", () => {
    expect(normalizeJiraEvent({}, USER_ID)).toBeNull();
  });
});

describe("normalizeJiraEvent — determinism", () => {
  it("produces stable non-volatile fields across two calls", () => {
    const a = normalizeJiraEvent(issueCreatedPayload, USER_ID);
    const b = normalizeJiraEvent(issueCreatedPayload, USER_ID);

    const { id: _ia, ingestedAt: _iia, ...restA } = a!;
    const { id: _ib, ingestedAt: _iib, ...restB } = b!;

    expect(restA).toEqual(restB);
  });
});

// ---------------------------------------------------------------------------
// Comment events
// ---------------------------------------------------------------------------

const commentCreatedPayload = {
  webhookEvent: "comment_created",
  comment: {
    id: "50001",
    self: "https://acme.atlassian.net/rest/api/2/issue/10001/comment/50001",
    body: "Looks good — merging now.",
    created: "2024-03-16T11:00:00.000+0000",
    updated: "2024-03-16T11:00:00.000+0000",
    author: { displayName: "Alice Dev", emailAddress: "alice@acme.com" },
  },
  issue: {
    id: "10001",
    key: "PROJ-42",
    self: "https://acme.atlassian.net/rest/api/2/issue/10001",
    fields: {
      summary: "Login page crashes on Firefox 124",
      project: { key: "PROJ", name: "Main Project" },
    },
  },
};

describe("normalizeJiraEvent — comment_created", () => {
  it("normalizes a comment_created event", () => {
    const result = normalizeJiraEvent(commentCreatedPayload, USER_ID);

    expect(result).not.toBeNull();
    expect(result?.provider).toBe("jira");
    expect(result?.eventType).toBe("comment_created");
    expect(result?.userId).toBe(USER_ID);
    expect(result?.sourceId).toBe("comment:50001");
    expect(result?.title).toBe(
      "[PROJ] Comment on PROJ-42: Login page crashes on Firefox 124",
    );
    expect(result?.description).toBe("Looks good — merging now.");
    expect(result?.url).toBe(
      "https://acme.atlassian.net/browse/PROJ-42?focusedCommentId=50001",
    );
    expect(result?.occurredAt).toBe("2024-03-16T11:00:00.000+0000");
    expect(result?.metadata).toMatchObject({
      commentId: "50001",
      issueKey: "PROJ-42",
      projectKey: "PROJ",
      author: "Alice Dev",
      authorEmail: "alice@acme.com",
    });
  });

  it("returns null for comment_updated (not ingested)", () => {
    const updated = { ...commentCreatedPayload, webhookEvent: "comment_updated" };
    expect(normalizeJiraEvent(updated, USER_ID)).toBeNull();
  });

  it("returns null when comment field is missing", () => {
    const bad = { webhookEvent: "comment_created", issue: commentCreatedPayload.issue };
    expect(normalizeJiraEvent(bad, USER_ID)).toBeNull();
  });

  it("returns null when issue field is missing from comment event", () => {
    const bad = { webhookEvent: "comment_created", comment: commentCreatedPayload.comment };
    expect(normalizeJiraEvent(bad, USER_ID)).toBeNull();
  });

  it("produces stable non-volatile fields across two calls", () => {
    const a = normalizeJiraEvent(commentCreatedPayload, USER_ID);
    const b = normalizeJiraEvent(commentCreatedPayload, USER_ID);

    const { id: _ia, ingestedAt: _iia, ...restA } = a!;
    const { id: _ib, ingestedAt: _iib, ...restB } = b!;
    expect(restA).toEqual(restB);
  });
});
