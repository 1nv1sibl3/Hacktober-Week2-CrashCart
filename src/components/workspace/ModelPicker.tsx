"use client";

import { Info, Server, Cpu } from "lucide-react";
import { WeightBadge } from "@/components/common/badges";
import type { PublicProvider } from "@/lib/schema/diagnosis";

export interface Selection {
  providerId: string;
  modelId: string;
}

const key = (s: Selection) => `${s.providerId}::${s.modelId}`;

export function ModelPicker({
  providers,
  selection,
  onChange,
  disabled,
}: {
  providers: PublicProvider[];
  selection: Selection | null;
  onChange: (s: Selection) => void;
  disabled: boolean;
}) {
  const provider = providers.find((p) => p.id === selection?.providerId);
  const model = provider?.models.find((m) => m.id === selection?.modelId);

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="model-select" className="text-xs font-medium text-muted-foreground">
        Model
      </label>
      <select
        id="model-select"
        value={selection ? key(selection) : ""}
        disabled={disabled}
        onChange={(e) => {
          const [providerId, modelId] = e.target.value.split("::");
          onChange({ providerId, modelId });
        }}
        className="h-9 w-full rounded-lg border border-input bg-input/30 px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
      >
        {providers.map((p) => (
          <optgroup key={p.id} label={`${p.label}${p.hosting === "local" ? " — local" : ""}`}>
            {p.models.map((m) => (
              <option key={m.id} value={key({ providerId: p.id, modelId: m.id })} className="bg-neutral-900">
                {m.label} — {m.openWeight ? "open-weight" : "proprietary"}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      {provider && model && (
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
            <WeightBadge openWeight={model.openWeight} license={model.license} />
            <span className="inline-flex items-center gap-1">
              {provider.hosting === "local" ? <Cpu className="size-3" aria-hidden /> : <Server className="size-3" aria-hidden />}
              {provider.hosting === "local" ? "Local inference" : `Hosted by ${provider.label}`}
            </span>
          </div>
          <p className="flex gap-1.5 text-[11px] leading-snug text-muted-foreground/80">
            <Info className="mt-0.5 size-3 shrink-0" aria-hidden />
            {provider.dataNotice}
          </p>
        </div>
      )}
    </div>
  );
}
