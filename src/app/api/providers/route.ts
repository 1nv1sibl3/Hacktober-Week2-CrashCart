import { connection } from "next/server";
import type { ProvidersResponse } from "@/lib/schema/diagnosis";
import { getConfig } from "@/server/env";
import { defaultSelection, resolveProviders, toPublicProviders } from "@/server/providers/catalog";

export async function GET(): Promise<Response> {
  // Cache Components would otherwise prerender this at build time with build-time env.
  await connection();
  const config = getConfig();
  const providers = resolveProviders();
  const body: ProvidersResponse = {
    providers: toPublicProviders(providers),
    defaultSelection: defaultSelection(providers, config),
    limits: { maxInputChars: config.maxInputChars },
  };
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}
