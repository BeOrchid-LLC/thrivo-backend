/**
 * Audit metadata is operational context, not a second data store. Keep the
 * allow-list deliberately small and redact content that could contain PII,
 * credentials, provider payloads, or message bodies. This is applied both
 * when writing new rows and when mapping legacy rows back out of the API.
 */
const REDACTED = "[redacted]";
const SENSITIVE_KEY =
  /(email|body|note|payload|props|token|secret|password|ciphertext|auth.?tag|iv|user.?agent|referrer|image|url)/i;

export function sanitizeAuditMetadata(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sanitizeAuditMetadata);

  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    result[key] = SENSITIVE_KEY.test(key) ? REDACTED : sanitizeAuditMetadata(child);
  }
  return result;
}

export function safeAuditSnapshot(value: Record<string, unknown> | null | undefined) {
  return value ? sanitizeAuditMetadata(value) : value;
}
