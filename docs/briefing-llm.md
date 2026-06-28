# Optional LLM briefing digest (FUL-136)

The morning-briefing digest has two layers:

1. **Heuristic (default, guaranteed).** A pure, deterministic, dependency-free
   summariser in `@niteowl/shared/briefing-digest` (`buildBriefingDigest`). It
   needs no API key, runs on both the browser and the server, and is the
   single source of truth for the `{ headline, highlights[] }` shape.
2. **LLM enhancement (optional).** A server-side rewrite that turns the
   heuristic into warmer, more natural-language copy while preserving the
   structured shape the UI styles against. It is **off by default** and is never
   a hard dependency.

## Request flow

```
Web  ──GET /api/briefing/digest?since=last_login──▶  API
                                                      │ build structured input from DB activity
                                                      │ heuristic = buildBriefingDigest(input)
                                                      │ if LLM enabled: rewrite via Claude (timeout-bounded)
                                                      ▼
Web  ◀──{ headline, highlights[], source }──────────  returns LLM result OR heuristic
   prefers server digest; falls back to the LOCAL heuristic if the
   request itself fails (offline, 5xx, etc.)
```

`source` is `"llm"` or `"heuristic"` (server), and the web hook reports
`"local"` when it fell back to the client-side heuristic because the endpoint
was unreachable. There is **no visible regression** when the LLM is off: the
payload shape is identical.

## Configuration (server-only)

| Env var | Default | Purpose |
|---|---|---|
| `BRIEFING_LLM_ENABLED` | `false` | Master flag. Must be truthy **and** a key present to enable. |
| `ANTHROPIC_API_KEY` | — | Server secret. **Never** sent to the browser. |
| `BRIEFING_LLM_MODEL` | `claude-haiku-4-5-20251001` | Small, fast Claude model. Override per the `claude-api` skill; pin a snapshot in production. |
| `BRIEFING_LLM_TIMEOUT_MS` | `4000` | Hard request timeout (AbortController). On timeout → heuristic. |
| `BRIEFING_LLM_MAX_TOKENS` | `512` | Output cap; the digest is short. |
| `ANTHROPIC_BASE_URL` | `https://api.anthropic.com` | Override for proxies/gateways. |

Enabling requires **both** `BRIEFING_LLM_ENABLED` truthy **and** a non-empty
`ANTHROPIC_API_KEY`, so the feature can never be half-enabled into a
guaranteed-fail state.

## Hard fallback to heuristic

`enhanceBriefingWithLlm` is a **total function**: it never throws and never
returns a malformed digest. Every one of these paths resolves to the heuristic:

- flag off, or no API key (no call is made);
- empty activity window (no call is made);
- network error, or non-2xx response;
- request exceeds `BRIEFING_LLM_TIMEOUT_MS` (aborted);
- model output is not parseable JSON, or fails schema validation
  (missing headline / non-array highlights). Individual highlights with an
  unknown `kind` are dropped; valid ones are kept.

All fallback paths are covered by `apps/api/src/lib/briefing-llm.test.ts`.

## Cost & latency budget

The prompt is tiny — only the aggregated summary counts and the baseline digest
are sent (never raw activity bodies), so input is on the order of a few hundred
tokens and output is capped at 512.

- **Latency:** added time is bounded by `BRIEFING_LLM_TIMEOUT_MS` (default 4 s).
  A Haiku-class call for this payload typically returns in well under a second;
  the timeout is the worst case before silent fallback. The endpoint runs in
  parallel with the feed fetch on the client, so it does not add a waterfall.
- **Cost (order of magnitude):** with Haiku pricing, a single digest is a
  fraction of a US cent (~hundreds of input + ≤512 output tokens). One call per
  briefing load. To bound spend further, lower `BRIEFING_LLM_MAX_TOKENS`, keep
  the default model, or front the endpoint with the existing per-user feed cache
  window.
- **Row bound:** the digest reads at most `MAX_ROWS` (1000) recent events for the
  window, capping both DB load and prompt size.

## Security

- The API key is a **server secret**. The browser only ever talks to
  `GET /api/briefing/digest`; no key or model call is exposed client-side.
- The endpoint requires authentication (`requireAuth`) and is scoped to the
  caller's own `userId`.
- Only aggregate counts and the deterministic baseline digest are sent to the
  model — no secrets, tokens, or raw payloads.
