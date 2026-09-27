export type DiagnosticKind = "info" | "warning" | "error";
export type DiagnosticValue = string | number | boolean;

const SENSITIVE_FIELD =
  /(auth|cookie|credential|password|passwd|secret|token|api.?key)/i;
const MAX_MESSAGE_LENGTH = 1200;
const MAX_CONTEXT_FIELDS = 8;
const MAX_CONTEXT_VALUE_LENGTH = 200;

function redactText(text: string): string {
  return text
    .slice(0, MAX_MESSAGE_LENGTH)
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, "$1[redacted]")
    .replace(
      /\b((?:proxy-)?authorization\s*[:=]\s*)(?:(?:bearer|basic)\s+)?[^\s,;"']+/gi,
      "$1[redacted]",
    )
    .replace(
      /(["']?)(cookie|set-cookie|credential|password|passwd|secret|(?:access|refresh|client)[_-]?(?:token|secret)|token|api[_-]?key|x-api-key|authorization)\1\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;&]+)/gi,
      "$2=[redacted]",
    );
}

function safeContext(context: Readonly<Record<string, unknown>> = {}) {
  const result: Record<string, DiagnosticValue> = {};
  for (const [key, value] of Object.entries(context).slice(
    0,
    MAX_CONTEXT_FIELDS,
  )) {
    if (SENSITIVE_FIELD.test(key)) continue;
    if (typeof value === "string")
      result[key] = redactText(value).slice(0, MAX_CONTEXT_VALUE_LENGTH);
    else if (typeof value === "number" || typeof value === "boolean")
      result[key] = value;
  }
  return result;
}

/**
 * Write a structured diagnostic through Bench's existing console.error capture.
 * The host stores it locally; this function does not send network requests.
 */
export function reportDiagnostic(
  kind: DiagnosticKind,
  code: string,
  message: string,
  context?: Readonly<Record<string, unknown>>,
): void {
  const payload = {
    source: "bench-extension",
    kind,
    code: redactText(code).slice(0, 80),
    message: redactText(message),
    context: safeContext(context),
  };
  console.error("[bench-extension diagnostic]", payload);
}
