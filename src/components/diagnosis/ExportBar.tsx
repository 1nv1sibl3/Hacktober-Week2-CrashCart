"use client";

import { Download } from "lucide-react";
import { CopyButton } from "@/components/common/CopyButton";
import { Button } from "@/components/ui/button";
import { buildFixText, buildMarkdownReport } from "@/lib/report/markdown";
import type { Diagnosis } from "@/lib/schema/diagnosis";

function downloadReport(d: Diagnosis) {
  const blob = new Blob([buildMarkdownReport(d)], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `crashcart-report-${d.createdAt.slice(0, 16).replace(/[:T]/g, "-")}.md`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ExportBar({ diagnosis }: { diagnosis: Diagnosis }) {
  return (
    <div className="flex flex-wrap gap-2">
      <CopyButton text={buildFixText(diagnosis)} label="Copy fix" size="sm" />
      <CopyButton
        text={`${diagnosis.githubIssue.title}\n\n${diagnosis.githubIssue.body}`}
        label="Copy GitHub issue"
        size="sm"
      />
      <Button type="button" size="sm" variant="outline" onClick={() => downloadReport(diagnosis)}>
        <Download aria-hidden /> Download report (.md)
      </Button>
    </div>
  );
}
