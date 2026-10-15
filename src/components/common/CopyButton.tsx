"use client";

import { useEffect, useState } from "react";
import { Check, Copy, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type CopyState = "idle" | "copied" | "failed";

export function CopyButton({
  text,
  label = "Copy",
  className,
  size = "xs",
  variant = "outline",
}: {
  text: string;
  label?: string;
  className?: string;
  size?: "xs" | "sm" | "default";
  variant?: "outline" | "ghost" | "secondary";
}) {
  const [state, setState] = useState<CopyState>("idle");

  useEffect(() => {
    if (state === "idle") return;
    const t = setTimeout(() => setState("idle"), 1800);
    return () => clearTimeout(t);
  }, [state]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("failed");
    }
  }

  const Icon = state === "copied" ? Check : state === "failed" ? X : Copy;
  return (
    <Button
      type="button"
      size={size}
      variant={variant}
      onClick={copy}
      className={cn(state === "copied" && "text-emerald-400", state === "failed" && "text-rose-400", className)}
      aria-label={state === "idle" ? label : state === "copied" ? "Copied" : "Copy failed — select the text manually"}
    >
      <Icon aria-hidden />
      <span>{state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : label}</span>
    </Button>
  );
}
