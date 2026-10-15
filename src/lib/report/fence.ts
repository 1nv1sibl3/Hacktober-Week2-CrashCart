/**
 * Wrap content in a Markdown code fence that is longer than any backtick run
 * inside it, so quoted log text can never close the fence early.
 */
export function fence(content: string, language = ""): string {
  const longestRun = Math.max(0, ...Array.from(content.matchAll(/`+/g), (m) => m[0].length));
  const ticks = "`".repeat(Math.max(3, longestRun + 1));
  return `${ticks}${language}\n${content}\n${ticks}`;
}

/** Inline code span that survives backticks inside the content. */
export function inlineCode(content: string): string {
  const longestRun = Math.max(0, ...Array.from(content.matchAll(/`+/g), (m) => m[0].length));
  const ticks = "`".repeat(longestRun + 1);
  const pad = content.startsWith("`") || content.endsWith("`") ? " " : "";
  return `${ticks}${pad}${content}${pad}${ticks}`;
}
