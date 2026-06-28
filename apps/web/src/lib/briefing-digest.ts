// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
//
// The heuristic briefing digest is the single source of truth in the isomorphic
// `@niteowl/shared` layer so the web client and the API (`GET /api/briefing/digest`)
// never drift. We import the node-free subpath (`@niteowl/shared/briefing-digest`)
// rather than the package barrel, which re-exports `node:crypto`-backed helpers
// the browser bundle must not pull in.
//
// This module is intentionally a re-export: existing callers keep importing
// `../lib/briefing-digest`, and the heuristic stays the guaranteed client-side
// fallback for when the optional server LLM digest is unavailable (FUL-136).
export type {
  BriefingDigest,
  BriefingDigestInput,
  BriefingHighlight,
  BriefingHighlightKind,
  DigestActivity,
  DigestAgentGroup,
  DigestSummary,
} from '@niteowl/shared/briefing-digest';
export { buildBriefingDigest } from '@niteowl/shared/briefing-digest';
