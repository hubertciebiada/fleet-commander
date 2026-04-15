// =============================================================================
// Fleet Commander — Workflow Template Size Ceiling Test
// =============================================================================
// Prevents templates/workflow.md from exceeding Claude Code's Read limit.
// The CC Read tool has a hard ~10,000-token limit. At ~3.73 chars/token,
// 35,000 chars corresponds to ~9,380 tokens — leaving ~620 tokens of headroom.
// =============================================================================

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const MAX_CHARS = 35_000;

describe('workflow.md token ceiling', () => {
  it('must stay under 9500 tokens (~35000 chars)', () => {
    const workflowPath = resolve(__dirname, '../../templates/workflow.md');
    const content = readFileSync(workflowPath, 'utf-8');
    expect(content.length).toBeLessThan(MAX_CHARS);
  });
});
