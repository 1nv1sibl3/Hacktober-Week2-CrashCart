import { CopyButton } from "./CopyButton";

/** Plain-text code display. Content is rendered as text (React escapes it); never as HTML. */
export function CodeBlock({ content, language, copyLabel = "Copy" }: { content: string; language?: string; copyLabel?: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-white/10 bg-black/40">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-1">
        <span className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">{language || "text"}</span>
        <CopyButton text={content} label={copyLabel} variant="ghost" />
      </div>
      <pre className="overflow-x-auto p-3 text-xs leading-relaxed">
        <code className="font-mono whitespace-pre">{content}</code>
      </pre>
    </div>
  );
}
