// Deterministic, best-effort secret redaction. Isomorphic: the browser runs it for
// the live preview (so secrets never leave the page), and the server runs it again
// before anything is sent to a model.
//
// Every replacement is a typed token, e.g. [REDACTED:URL_PASSWORD]. Counting tokens
// in the output gives the redaction summary, and re-running is a no-op.
//
// Deliberately NOT redacted: hostnames, IPs, ports, file paths, package names, and
// hashes (npm integrity sha512 strings, commit SHAs). Debugging often depends on them.

export const REDACTION_LABELS: Record<string, string> = {
  PRIVATE_KEY: "private key",
  AUTH_HEADER: "authorization header",
  BEARER_TOKEN: "bearer token",
  JWT: "JWT",
  AWS_KEY: "AWS access key",
  GITHUB_TOKEN: "GitHub token",
  GOOGLE_API_KEY: "Google API key",
  OPENAI_KEY: "OpenAI key",
  ANTHROPIC_KEY: "Anthropic key",
  STRIPE_KEY: "Stripe key",
  SLACK_TOKEN: "Slack token",
  NPM_TOKEN: "npm token",
  XAI_KEY: "xAI key",
  URL_PASSWORD: "URL password",
  SECRET: "secret value",
  EMAIL: "email address",
};

const token = (type: keyof typeof REDACTION_LABELS) => `[REDACTED:${type}]`;
const TOKEN_PATTERN = /\[REDACTED:([A-Z_]+)\]/g;
const isRedacted = (value: string) => value.startsWith("[REDACTED");

// Values that are obviously placeholders, not secrets.
const PLACEHOLDER = /^(?:\$\{?[A-Za-z0-9_]+\}?|%[A-Za-z0-9_]+%|<[^>]*>|\*+|x{3,}|\.{3,}|null|none|nil|undefined|true|false|""|'')$/i;
// Key names that contain "token"/"key" but are not secrets.
const NOT_SECRET_NAME = /^(?:max_?tokens?|.*tokens?_(?:count|limit|used|usage|type)|tokeni[sz]er.*|.*_?key_?(?:id|name|path|file)|public_?key.*)$/i;

type Rule = { pattern: RegExp; replace: (match: string, ...groups: string[]) => string };

const literal = (type: keyof typeof REDACTION_LABELS): Rule["replace"] => () => token(type);

const RULES: Rule[] = [
  // Whole PEM private key blocks, then truncated blocks with no END line.
  {
    pattern: /-----BEGIN ([A-Z0-9 ]*)PRIVATE KEY-----[\s\S]*?-----END \1PRIVATE KEY-----/g,
    replace: literal("PRIVATE_KEY"),
  },
  {
    pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----(?:\s*[A-Za-z0-9+/=]{16,})+/g,
    replace: literal("PRIVATE_KEY"),
  },
  // Authorization / Proxy-Authorization headers: keep the header name and scheme.
  {
    pattern: /\b((?:proxy-)?authorization)(["']?\s*[:=]\s*["']?)(?:(bearer|basic|token|digest|negotiate)\s+)?([^\s"',;]+)/gi,
    replace: (m, name, sep, scheme, value) =>
      isRedacted(value) ? m : `${name}${sep}${scheme ? `${scheme} ` : ""}${token("AUTH_HEADER")}`,
  },
  // Bearer tokens outside a header.
  {
    pattern: /\b(bearer)\s+([A-Za-z0-9\-._~+/]{8,}=*)/gi,
    replace: (_m, scheme) => `${scheme} ${token("BEARER_TOKEN")}`,
  },
  // Credentials inside URLs: keep scheme, user, host, port, and path.
  {
    pattern: /\b([a-z][a-z0-9+.-]*:\/\/)([^\s:@/?#]+):([^\s@/?#]+)@/gi,
    replace: (m, scheme, user, password) => (isRedacted(password) ? m : `${scheme}${user}:${token("URL_PASSWORD")}@`),
  },
  // Well-known key formats (order matters: sk-ant- before sk-).
  { pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, replace: literal("AWS_KEY") },
  { pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})/g, replace: literal("GITHUB_TOKEN") },
  { pattern: /AIza[0-9A-Za-z_-]{35}/g, replace: literal("GOOGLE_API_KEY") },
  { pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/g, replace: literal("ANTHROPIC_KEY") },
  { pattern: /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}/g, replace: literal("OPENAI_KEY") },
  { pattern: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/g, replace: literal("STRIPE_KEY") },
  { pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g, replace: literal("SLACK_TOKEN") },
  { pattern: /\bnpm_[A-Za-z0-9]{36}\b/g, replace: literal("NPM_TOKEN") },
  { pattern: /\bxai-[A-Za-z0-9]{20,}/g, replace: literal("XAI_KEY") },
  { pattern: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, replace: literal("JWT") },
  // Secret-looking assignments: DB_PASSWORD=..., "api_key": "...", --token=..., secret: ...
  // ("pwd" and "credentials" are left out: PWD=/path and fetch's credentials: 'include' are common and harmless.)
  {
    pattern:
      /\b([A-Za-z0-9_.-]*?(?:password|passwd|secret|token|api[_-]?key|apikey|access[_-]?key|private[_-]?key|client[_-]?secret)[A-Za-z0-9_.-]*)(["']?\s*[:=]\s*)(["']?)([^\s"',;}]{4,})/gi,
    replace: (m, name, sep, quote, value) =>
      isRedacted(value) || PLACEHOLDER.test(value) || NOT_SECRET_NAME.test(name)
        ? m
        : `${name}${sep}${quote}${token("SECRET")}`,
  },
  // Email addresses (but not ssh remotes like git@github.com, or user@host after ://).
  {
    pattern: /(?<![/\w.%+-])([A-Za-z0-9._%+-]+)@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})\b/g,
    replace: (m, local) => (local.toLowerCase() === "git" ? m : token("EMAIL")),
  },
];

export interface RedactionFinding {
  type: string;
  label: string;
  count: number;
}

export interface RedactionResult {
  text: string;
  findings: RedactionFinding[];
  total: number;
}

/** Count redaction tokens already present in `text`. */
export function countRedactions(text: string): RedactionFinding[] {
  const counts = new Map<string, number>();
  for (const match of text.matchAll(TOKEN_PATTERN)) {
    counts.set(match[1], (counts.get(match[1]) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([type, count]) => ({ type, label: REDACTION_LABELS[type] ?? type.toLowerCase(), count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type));
}

export function redact(input: string): RedactionResult {
  let text = input;
  for (const rule of RULES) {
    text = text.replace(rule.pattern, rule.replace as (substring: string, ...args: string[]) => string);
  }
  const findings = countRedactions(text);
  return { text, findings, total: findings.reduce((sum, f) => sum + f.count, 0) };
}

export function describeFindings(findings: RedactionFinding[]): string {
  const plural = (label: string) => (label.endsWith("s") ? `${label}es` : `${label}s`);
  return findings.map((f) => `${f.count} ${f.count === 1 ? f.label : plural(f.label)}`).join(", ");
}
