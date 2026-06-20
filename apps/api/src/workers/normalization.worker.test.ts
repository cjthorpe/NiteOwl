/**
 * Unit tests for extractAuthorLogin — the function that surfaces actor identity
 * from activity metadata so it can be stored in author_login and used for feed
 * filtering.
 */
import { describe, it, expect } from 'vitest';
import { extractAuthorLogin } from './normalization.worker.js';

describe('extractAuthorLogin', () => {
  it('returns null for empty metadata', () => {
    expect(extractAuthorLogin({})).toBeNull();
  });

  it('returns null when all candidate fields are missing', () => {
    expect(extractAuthorLogin({ issueKey: 'ABC-1', status: 'open' })).toBeNull();
  });

  it('returns null when candidate fields are non-string', () => {
    expect(extractAuthorLogin({ author: 42, sender: null, creator: true })).toBeNull();
  });

  it('returns null when candidate fields are empty strings', () => {
    expect(extractAuthorLogin({ author: '', sender: '  ' })).toBeNull();
  });

  // ── GitHub PR ─────────────────────────────────────────────────────────────

  it('returns sender (action performer) for GitHub PR events', () => {
    const meta = {
      prNumber: 42,
      repo: 'org/repo',
      author: 'pr-creator-bot',
      sender: 'merger-bot',
      state: 'closed',
      baseBranch: 'main',
    };
    // sender takes priority over author
    expect(extractAuthorLogin(meta)).toBe('merger-bot');
  });

  it('falls back to author when sender is absent — GitHub PR opened', () => {
    const meta = {
      prNumber: 1,
      repo: 'org/repo',
      author: 'pr-creator-bot',
      state: 'open',
      baseBranch: 'main',
    };
    expect(extractAuthorLogin(meta)).toBe('pr-creator-bot');
  });

  // ── GitHub Issue ──────────────────────────────────────────────────────────

  it('returns sender for GitHub issue events', () => {
    const meta = {
      issueNumber: 7,
      repo: 'org/repo',
      author: 'issue-opener',
      sender: 'another-bot',
      state: 'open',
    };
    expect(extractAuthorLogin(meta)).toBe('another-bot');
  });

  // ── GitHub Push ───────────────────────────────────────────────────────────

  it('returns pusher for GitHub push events', () => {
    const meta = {
      ref: 'refs/heads/main',
      branch: 'main',
      commitCount: 3,
      headSha: 'abc123',
      repo: 'org/repo',
      pusher: 'deploy-bot',
    };
    expect(extractAuthorLogin(meta)).toBe('deploy-bot');
  });

  // ── Linear Issue ──────────────────────────────────────────────────────────

  it('returns creator for Linear issue events', () => {
    const meta = {
      identifier: 'ENG-42',
      teamKey: 'ENG',
      teamName: 'Engineering',
      state: 'In Progress',
      stateType: 'started',
      assignee: null,
      creator: 'Alice Bot',
      organizationId: 'org-1',
    };
    expect(extractAuthorLogin(meta)).toBe('Alice Bot');
  });

  // ── Linear Comment ────────────────────────────────────────────────────────

  it('returns author for Linear comment events', () => {
    const meta = {
      commentId: 'cmt-1',
      issueId: 'iss-1',
      identifier: 'ENG-42',
      teamKey: 'ENG',
      teamName: 'Engineering',
      author: 'Review Bot',
      authorEmail: 'bot@example.com',
      organizationId: 'org-1',
    };
    expect(extractAuthorLogin(meta)).toBe('Review Bot');
  });

  // ── Jira Issue ────────────────────────────────────────────────────────────

  it('returns reporter for Jira issue events', () => {
    const meta = {
      issueKey: 'PROJ-10',
      issueType: 'Bug',
      projectKey: 'PROJ',
      projectName: 'My Project',
      status: 'Open',
      statusCategory: 'new',
      assignee: null,
      reporter: 'Triage Bot',
      webhookEvent: 'jira:issue_created',
    };
    expect(extractAuthorLogin(meta)).toBe('Triage Bot');
  });

  // ── Jira Comment ─────────────────────────────────────────────────────────

  it('returns author for Jira comment events', () => {
    const meta = {
      commentId: '12345',
      issueKey: 'PROJ-10',
      projectKey: 'PROJ',
      projectName: 'My Project',
      author: 'Comment Bot',
      authorEmail: 'bot@jira.example.com',
    };
    expect(extractAuthorLogin(meta)).toBe('Comment Bot');
  });

  // ── Priority order ────────────────────────────────────────────────────────

  it('prefers sender over author when both are present', () => {
    expect(extractAuthorLogin({ sender: 's-bot', author: 'a-bot' })).toBe('s-bot');
  });

  it('prefers author over creator when sender is absent', () => {
    expect(extractAuthorLogin({ author: 'a-bot', creator: 'c-bot' })).toBe('a-bot');
  });

  it('prefers creator over reporter when sender and author are absent', () => {
    expect(extractAuthorLogin({ creator: 'c-bot', reporter: 'r-bot' })).toBe('c-bot');
  });

  it('prefers reporter over pusher when higher-priority fields are absent', () => {
    expect(extractAuthorLogin({ reporter: 'r-bot', pusher: 'p-bot' })).toBe('r-bot');
  });
});
