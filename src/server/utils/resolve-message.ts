// =============================================================================
// Fleet Commander — Message Template Resolver
// =============================================================================
// Resolves a message template from the database, substituting {{PLACEHOLDER}}
// variables. Returns null if the template is disabled or doesn't exist.
// =============================================================================

import { getDatabase } from '../db.js';

/**
 * Look up a message template by ID, substitute variables, and return
 * the final message string. Returns `null` if the template doesn't exist
 * or is disabled.
 *
 * @param templateId - The template ID (e.g. 'ci_green', 'pr_merged')
 * @param vars       - Key/value pairs for {{PLACEHOLDER}} substitution
 */
export function resolveMessage(
  templateId: string,
  vars: Record<string, string>,
): string | null {
  const db = getDatabase();
  const tmpl = db.getMessageTemplate(templateId);
  if (!tmpl || !tmpl.enabled) return null;

  let message = tmpl.template;
  for (const [key, value] of Object.entries(vars)) {
    message = message.replaceAll(`{{${key}}}`, value);
  }
  return message;
}
