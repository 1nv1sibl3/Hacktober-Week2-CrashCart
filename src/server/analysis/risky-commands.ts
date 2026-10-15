import "server-only";

// Deterministic scan of suggested commands and snippets for operations that
// deserve a second look. Prose is not scanned, so "don't use --force" is fine.

const CHECKS: { pattern: RegExp; message: string }[] = [
  { pattern: /\brm\s+-[a-z]*(?:rf|fr)[a-z]*\b/i, message: "`rm -rf` permanently deletes files. Double-check the path before running it." },
  {
    pattern: /\b(?:curl|wget)\b[^|\n]*\|\s*(?:sudo\s+)?(?:ba|z)?sh\b/i,
    message: "Piping a download straight into a shell runs code you haven't reviewed.",
  },
  { pattern: /\bsudo\s+/, message: "`sudo` runs with administrator privileges. Make sure the command really needs them." },
  {
    pattern: /--legacy-peer-deps\b/,
    message: "`--legacy-peer-deps` skips peer-dependency checks and can leave incompatible packages installed.",
  },
  { pattern: /(?:^|\s)--force\b/, message: "`--force` overrides safety checks. Use it only if you understand what it skips." },
  { pattern: /\bchmod\s+(?:-R\s+)?0?777\b/, message: "`chmod 777` makes files writable by every user on the machine." },
  {
    pattern: /\bdocker\s+(?:system|volume)\s+prune\b|\bdocker\s+volume\s+rm\b|\bdocker[- ]compose\s+down\b[^\n]*\s-v\b/i,
    message: "This deletes Docker data. Volumes may hold databases you want to keep.",
  },
  { pattern: /\bgit\s+push\b[^\n]*(?:--force\b|\s-f\b)/, message: "Force-pushing rewrites history on the remote." },
  { pattern: /\bgit\s+(?:reset\s+--hard|clean\s+-[a-z]*f)/i, message: "This discards uncommitted changes permanently." },
  { pattern: /\b(?:DROP\s+(?:TABLE|DATABASE|SCHEMA)|TRUNCATE\s+TABLE)\b/i, message: "This destroys database data." },
  {
    pattern: /--break-system-packages\b/,
    message: "`--break-system-packages` can break the operating system's own Python packages.",
  },
];

export function scanRiskyCommands(commands: string[]): string[] {
  const messages = new Set<string>();
  for (const cmd of commands) {
    for (const check of CHECKS) if (check.pattern.test(cmd)) messages.add(check.message);
  }
  return [...messages];
}
