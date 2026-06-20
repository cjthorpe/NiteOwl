import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  formatPrMergeAlert,
  sendSlackAlert,
  SlackAlertError,
  type PrMergeAlertData,
} from './slack-alert.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const prData: PrMergeAlertData = {
  repo: 'acme/app',
  prNumber: 42,
  prTitle: 'Add dark mode support',
  author: 'octocat',
  url: 'https://github.com/acme/app/pull/42',
  baseBranch: 'main',
  occurredAt: '2024-03-16T09:30:00Z',
};

// ---------------------------------------------------------------------------
// formatPrMergeAlert
// ---------------------------------------------------------------------------

describe('formatPrMergeAlert', () => {
  it('includes repo name in header', () => {
    const msg = formatPrMergeAlert(prData);
    const header = msg.blocks.find((b) => b.type === 'header');
    expect(header).toBeDefined();
    if (header?.type === 'header') {
      expect(header.text.text).toContain('acme/app');
    }
  });

  it('includes PR number, title, author and branch in section text', () => {
    const msg = formatPrMergeAlert(prData);
    const section = msg.blocks.find((b) => b.type === 'section');
    expect(section).toBeDefined();
    if (section?.type === 'section') {
      expect(section.text.text).toContain('#42');
      expect(section.text.text).toContain('Add dark mode support');
      expect(section.text.text).toContain('octocat');
      expect(section.text.text).toContain('main');
    }
  });

  it('includes PR URL as button accessory', () => {
    const msg = formatPrMergeAlert(prData);
    const section = msg.blocks.find((b) => b.type === 'section');
    if (section?.type === 'section' && section.accessory?.type === 'button') {
      expect(section.accessory.url).toBe(prData.url);
    }
  });

  it('sets fallback text containing repo, PR number, and author', () => {
    const msg = formatPrMergeAlert(prData);
    expect(msg.text).toContain('acme/app');
    expect(msg.text).toContain('#42');
    expect(msg.text).toContain('octocat');
  });

  it('escapes < > & in PR title and author', () => {
    const dangerous: PrMergeAlertData = {
      ...prData,
      prTitle: "Fix <script> & 'injection'",
      author: 'user<evil>',
    };
    const msg = formatPrMergeAlert(dangerous);
    const section = msg.blocks.find((b) => b.type === 'section');
    if (section?.type === 'section') {
      expect(section.text.text).not.toContain('<script>');
      expect(section.text.text).toContain('&lt;script&gt;');
      expect(section.text.text).not.toContain('<evil>');
      expect(section.text.text).toContain('&lt;evil&gt;');
      expect(section.text.text).toContain('&amp;');
    }
  });

  it('includes a context block with date string', () => {
    const msg = formatPrMergeAlert(prData);
    const context = msg.blocks.find((b) => b.type === 'context');
    expect(context).toBeDefined();
    if (context?.type === 'context') {
      const hasDate = context.elements.some(
        (e) => e.text.includes('2024') || e.text.includes('NiteOwl'),
      );
      expect(hasDate).toBe(true);
    }
  });

  it('includes a divider block', () => {
    const msg = formatPrMergeAlert(prData);
    expect(msg.blocks.some((b) => b.type === 'divider')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// sendSlackAlert
// ---------------------------------------------------------------------------

describe('sendSlackAlert', () => {
  const webhookUrl = 'https://hooks.slack.com/services/TEST/TEST/TEST';
  const message = formatPrMergeAlert(prData);

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves on 200 OK', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('ok', { status: 200 }));

    const result = await sendSlackAlert(webhookUrl, message);
    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(1);
  });

  it('retries on 503 and succeeds on second attempt', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response('error', { status: 503 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));

    const result = await sendSlackAlert(webhookUrl, message, /* retries */ 3);
    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(2);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it('throws SlackAlertError after exhausting retries', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('gateway error', { status: 503 }));

    await expect(sendSlackAlert(webhookUrl, message, /* retries */ 2)).rejects.toBeInstanceOf(
      SlackAlertError,
    );
    // 1 initial + 2 retries = 3 total calls
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3);
  });

  it('does NOT retry on 400 (permanent error)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('invalid_payload', { status: 400 }));

    await expect(sendSlackAlert(webhookUrl, message, 3)).rejects.toBeInstanceOf(SlackAlertError);
    // Should give up after the first 4xx
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry on 404 (permanent error)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('no_service', { status: 404 }));

    const err = await sendSlackAlert(webhookUrl, message, 3).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SlackAlertError);
    if (err instanceof SlackAlertError) {
      expect(err.permanent).toBe(true);
    }
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it('sends correct JSON body', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('ok', { status: 200 }));

    await sendSlackAlert(webhookUrl, message);

    const call = vi.mocked(fetch).mock.calls[0];
    expect(call).toBeDefined();
    const [url, init] = call as [string, RequestInit];
    expect(url).toBe(webhookUrl);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toMatchObject({
      text: expect.any(String) as string,
      blocks: expect.any(Array) as unknown[],
    });
  });

  it('retries on network error', async () => {
    vi.mocked(fetch)
      .mockRejectedValueOnce(new Error('network timeout'))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));

    const result = await sendSlackAlert(webhookUrl, message, 2);
    expect(result.ok).toBe(true);
    expect(result.attempts).toBe(2);
  });
});
