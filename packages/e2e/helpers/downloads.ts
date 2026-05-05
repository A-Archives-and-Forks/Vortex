import path from "node:path";
import os from "node:os";
import type { Page } from "@playwright/test";

export interface CapturedDownload {
  path: string;
  filename: string;
}

/**
 * Wait for a download triggered by `trigger`, save it to a tmp path, return
 * the absolute path. The auth page is the Chrome instance opened by
 * loginToNexus — `download.saveAs` runs in that browser context.
 */
export async function captureDownload(
  page: Page,
  trigger: () => Promise<void>,
  label: string,
  timeoutMs = 90_000,
): Promise<CapturedDownload> {
  const downloadPromise = page.waitForEvent("download", { timeout: timeoutMs });
  await trigger();
  const download = await downloadPromise;
  const filename = download.suggestedFilename();
  const target = path.join(
    os.tmpdir(),
    `qa-e2e-${label}-${Date.now()}-${filename}`,
  );
  await download.saveAs(target);
  return { path: target, filename };
}
