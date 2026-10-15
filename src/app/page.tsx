import { HeartPulse } from "lucide-react";
import { Workspace } from "@/components/workspace/Workspace";

export default function Home() {
  return (
    <div className="mx-auto flex min-h-full w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:py-8">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="flex size-9 items-center justify-center rounded-lg bg-orange-500/15 text-orange-400">
              <HeartPulse className="size-5" aria-hidden />
            </span>
            <h1 className="text-2xl font-semibold tracking-tight">CrashCart</h1>
          </div>
          <p className="mt-1.5 text-sm font-medium text-orange-300/90">From chaotic logs to actionable fixes.</p>
        </div>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Paste an error log. CrashCart redacts secrets in your browser, has an open-weight model diagnose it, and checks
          every quoted line against your log, so you can tell what was <span className="text-sky-300">observed</span>, what
          was <span className="text-violet-300">inferred</span>, and what is still{" "}
          <span className="text-amber-300">uncertain</span>.
        </p>
      </header>

      <main className="flex-1">
        <Workspace />
      </main>

      <footer className="border-t border-white/10 pt-4 text-xs leading-relaxed text-muted-foreground">
        CrashCart is open source (MIT). The default model is Gemma 4 26B A4B, an open-weight model (Apache-2.0).
        Diagnoses are AI-generated and can be wrong: CrashCart never runs commands or edits your code, and it doesn&apos;t
        store your logs.
      </footer>
    </div>
  );
}
