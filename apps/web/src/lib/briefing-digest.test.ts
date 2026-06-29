// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
import { describe, expect, it } from 'vitest';

import {
  buildBriefingDigest,
  resolveAuthorLogin,
  UNKNOWN_AUTHOR_LOGIN,
  type BriefingDigestInput,
} from './briefing-digest';

// The exhaustive behavioural suite lives next to the implementation in
// `@niteowl/shared` (briefing-digest.test.ts). This smoke test only proves the
// web re-export resolves the node-free subpath under Vite/jsdom and re-exports
// the live function — guarding the wiring that keeps the client-side fallback
// working when the optional server LLM digest is unavailable (FUL-136).
describe('briefing-digest web re-export', () => {
  it('re-exports the shared heuristic and produces the digest shape', () => {
    const empty: BriefingDigestInput = {
      agentGroups: [],
      summary: {
        totalPrsMerged: 0,
        totalIssuesClosed: 0,
        totalCommitsPushed: 0,
        totalPrsOpened: 0,
      },
      totalItems: 0,
    };
    const quiet = buildBriefingDigest(empty);
    expect(quiet.headline).toMatch(/quiet/i);
    expect(quiet.highlights).toHaveLength(0);

    const active = buildBriefingDigest({
      ...empty,
      totalItems: 3,
      summary: { ...empty.summary, totalPrsOpened: 2 },
      agentGroups: [
        {
          login: 'alice',
          items: [],
          prsOpened: 2,
          prsMerged: 0,
          issuesClosed: 0,
          commitsPushed: 0,
        },
      ],
    });
    expect(active.headline).toContain('3 updates');
    expect(active.highlights[0]?.kind).toBe('needs_review');
  });

  it('re-exports the author resolver used by the grouping/avatar (FUL-139)', () => {
    expect(resolveAuthorLogin(null, { author: 'ada' })).toBe('ada');
    expect(resolveAuthorLogin(null, {})).toBeNull();
    expect(UNKNOWN_AUTHOR_LOGIN).toBe('(unknown)');
  });
});
