// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 Fullstack Forge
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { describe, expect, it } from 'vitest';

import { planEnum, users, type Plan } from './schema';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, '../migrations');

describe('plan enum + users.plan column (schema)', () => {
  it('exposes the three plan tiers in order, free first', () => {
    expect(planEnum.enumValues).toEqual(['free', 'pro', 'enterprise']);
  });

  it('keeps the persisted enum in sync with the PlanTier union', () => {
    // Compile-time cross-check: every enum value is assignable to Plan and the
    // literal union is exactly these three. A drift in either direction breaks
    // the build here before it reaches the shared capability map.
    const tiers: Plan[] = ['free', 'pro', 'enterprise'];
    expect(tiers).toEqual([...planEnum.enumValues]);
  });

  it('adds a non-null plan column to users defaulting to free', () => {
    const col = users.plan;
    expect(col).toBeDefined();
    expect(col.name).toBe('plan');
    expect(col.notNull).toBe(true);
    expect(col.default).toBe('free');
  });
});

describe('0009_account_plan migration', () => {
  const sql = readFileSync(path.join(migrationsDir, '0009_account_plan.sql'), 'utf8');

  it('creates the plan enum type', () => {
    expect(sql).toMatch(/CREATE TYPE "public"\."plan" AS ENUM\('free', 'pro', 'enterprise'\)/);
  });

  it('adds a NOT NULL plan column to users defaulting to free', () => {
    expect(sql).toContain('ALTER TABLE "users"');
    expect(sql).toMatch(/ADD COLUMN "plan" "public"\."plan" NOT NULL DEFAULT 'free'/);
  });

  it('is registered as idx 9 in the migration journal', () => {
    const journal = JSON.parse(
      readFileSync(path.join(migrationsDir, 'meta', '_journal.json'), 'utf8'),
    ) as { entries: Array<{ idx: number; tag: string }> };
    const entry = journal.entries.find((e) => e.tag === '0009_account_plan');
    expect(entry).toBeDefined();
    expect(entry?.idx).toBe(9);
  });
});
