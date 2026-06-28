// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
import type { BriefingDigest as BriefingDigestData } from '../../lib/briefing-digest';

interface BriefingDigestProps {
  digest: BriefingDigestData;
}

/**
 * Narrative "what changed and why it matters" digest that sits above the
 * raw briefing stats (FUL-122). The headline frames the window; highlights
 * are pre-prioritised by actionability, with the review callout emphasised.
 */
export function BriefingDigest({ digest }: BriefingDigestProps) {
  return (
    <section className="briefing-digest" aria-label="Briefing digest">
      <p className="briefing-digest-headline">{digest.headline}</p>

      {digest.highlights.length > 0 && (
        <ul className="briefing-digest-highlights">
          {digest.highlights.map((highlight) => (
            <li
              key={highlight.kind}
              className="briefing-digest-highlight"
              data-kind={highlight.kind}
              data-emphasis={highlight.emphasis ? 'true' : undefined}
            >
              {highlight.text}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
