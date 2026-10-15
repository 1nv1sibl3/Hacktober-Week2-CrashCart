/**
 * Headless UI check against a running CrashCart (uses the system Microsoft Edge; no browser download).
 * Makes ONE real analysis call. Saves screenshots to docs/screenshots/.
 *
 *   npm run build && PORT=3123 npm start      # in another terminal
 *   npm run ui:check                           # CRASHCART_URL defaults to http://localhost:3123
 */
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const BASE = process.env.CRASHCART_URL ?? "http://localhost:3123";
const OUT = path.resolve("docs/screenshots");
mkdirSync(OUT, { recursive: true });

const results: { check: string; ok: boolean; detail?: string }[] = [];
const record = (check: string, ok: boolean, detail?: string) => {
  results.push({ check, ok, detail });
  console.log(`${ok ? "✓" : "✗"} ${check}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
const page = await context.newPage();
const consoleErrors: string[] = [];
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
page.on("pageerror", (e) => consoleErrors.push(e.message));

try {
  await page.goto(BASE, { waitUntil: "networkidle" });
  const analyze = page.getByRole("button", { name: /^Analyze with/ });
  await analyze.waitFor();
  record("model picker loads the default open-weight model", (await page.locator("#model-select").inputValue()) === "google::gemma-4-26b-a4b-it");
  record("Analyze is disabled with empty input", await analyze.isDisabled());
  await page.screenshot({ path: path.join(OUT, "01-workspace.png") });

  await page.getByRole("button", { name: "Docker startup failure" }).click();
  await page.getByText(/3 items redacted/).waitFor();
  record("redaction preview counts the Docker sample's secrets", true, await page.getByText(/3 items redacted/).innerText());
  await page.getByRole("button", { name: /View what will be sent/ }).click();
  const sent = await page.locator("pre").filter({ hasText: "[REDACTED:" }).first().innerText();
  record("'what will be sent' hides the password and keeps the host", !sent.includes("SuperSecret123") && sent.includes("@localhost:5432/shop"));
  await page.screenshot({ path: path.join(OUT, "02-redaction-preview.png") });

  await analyze.click();
  await page.getByText(/is analyzing your log/).waitFor({ timeout: 5_000 });
  record("loading state with cancel button appears", await page.getByRole("button", { name: "Cancel" }).isVisible());
  await page.getByRole("heading", { name: "Likely root cause" }).waitFor({ timeout: 130_000 });
  const verified = await page.getByText(/^Found at line/).count();
  record("diagnosis renders with verified evidence", verified >= 1, `${verified} verified quote(s)`);
  record("provenance shows the open-weight model", await page.getByText("Open-weight · Apache-2.0").first().isVisible());
  record("fix is labelled unverified", await page.getByText("Not yet verified — run the checks below.").isVisible());
  await page.screenshot({ path: path.join(OUT, "03-diagnosis.png"), fullPage: true });

  await page.getByRole("button", { name: "Copy fix" }).click();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  record("Copy fix puts the fix on the clipboard", clip.includes("Verify:") || clip.length > 40, `${clip.length} chars`);

  await page.getByRole("button", { name: "Copy GitHub issue" }).click();
  const issue = await page.evaluate(() => navigator.clipboard.readText());
  record("Copy GitHub issue includes title and sections", issue.includes("## Summary") && issue.includes("## Proposed fix"));

  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Download report/ }).click()]);
  const file = path.join(OUT, "..", "..", ".ui-check-report.md");
  await download.saveAs(file);
  const md = readFileSync(file, "utf8");
  record("Markdown report downloads", md.startsWith("# CrashCart debugging report") && !md.includes("SuperSecret123"), download.suggestedFilename());

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  record("no horizontal page scroll at 390px", overflow <= 0, `overflow ${overflow}px`);
  await page.screenshot({ path: path.join(OUT, "04-mobile-diagnosis.png"), fullPage: true });

  record("no browser console errors", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | ") || undefined);
} catch (err) {
  record("UI flow completed", false, err instanceof Error ? err.message.split("\n")[0] : String(err));
  await page.screenshot({ path: path.join(OUT, "error.png"), fullPage: true }).catch(() => {});
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} UI checks passed`);
process.exitCode = failed ? 1 : 0;
