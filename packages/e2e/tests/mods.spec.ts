/**
 * Mod download tests.
 * Covers Linear ticket: QA-108 (Mods: [9.1] - I can successfully download a mod
 * via mod manager).
 *
 * Both free- and premium-user variants:
 *   - Free users hit a "Slow download" interstitial with a countdown before
 *     the nxm:// URL fires.
 *   - Premium users skip the interstitial — the URL is wired into the page
 *     immediately after the requirements modal.
 *
 * The test downloads SMAPI (https://www.nexusmods.com/stardewvalley/mods/2400)
 * because it has no further prerequisites — the install completes cleanly.
 */
import type { Browser } from "@playwright/test";
import { test, expect } from "../fixtures/vortex-app";
import { cleanupFakeGame } from "../fixtures/game-setup/fake-game";
import { acceptConsent } from "../helpers/consent";
import { manageGame, type ManagedGame } from "../helpers/games";
import { loginToNexus } from "../helpers/login";
import { installNxmCapture, waitForNxmUrl } from "../helpers/nxmCapture";
import { freeUser, premiumUser } from "../helpers/users";
import { NavBar } from "../selectors/navbar";

const SDV_MOD_URL = "https://www.nexusmods.com/stardewvalley/mods/2400";

const TIERS = [
  { tier: "free", user: freeUser },
  { tier: "premium", user: premiumUser },
] as const;

test.describe("Mods - Downloads", () => {
  // Each tier gets its own worker — fresh Vortex per test so login state
  // and managed game don't bleed between users.
  test.describe.configure({ mode: "parallel" });

  for (const { tier, user } of TIERS) {
    test(`[QA-108] ${tier} user can download SMAPI via the Mod Manager link`, async ({
      vortexApp,
      vortexWindow,
    }) => {
      // Login + manage + website nav + (free) countdown adds up.
      test.setTimeout(180_000);

      let managed: ManagedGame | null = null;
      let authBrowser: Browser | null = null;

      try {
        // Login first (Vortex still in clean state — login UI's selectors
        // match reliably), then manage SDV so downloads have a destination.
        const auth = await loginToNexus(vortexApp, vortexWindow, user, {
          keepBrowser: true,
          headless: false,
        });
        if (auth === null) {
          throw new Error("loginToNexus did not return a browser handle");
        }
        authBrowser = auth.browser;

        managed = await manageGame(vortexWindow, "stardewvalley");

        await test.step("Open the SMAPI mod page", async () => {
          await auth.page.goto(SDV_MOD_URL, {
            waitUntil: "domcontentloaded",
            timeout: 60_000,
          });
          await expect(auth.page).toHaveURL(/stardewvalley\/mods\/2400/);

          const cloudflareHeading = auth.page.getByRole("heading", {
            name: /Performing security verification/i,
          });
          if (await cloudflareHeading.isVisible().catch(() => false)) {
            await expect(cloudflareHeading).toBeHidden({ timeout: 30_000 });
          }

          await acceptConsent(auth.page);
        });

        let nxmUrl: string | null = null;

        await test.step("Open the Mod Manager Download requirements modal", async () => {
          // The "Vortex" link on the mod page has class `popup-btn-ajax` and
          // points at /Core/Libs/Common/Widgets/ModRequirementsPopUp; clicking
          // opens an AJAX modal listing required mods (e.g. SMAPI). Mods
          // without dependencies skip the modal.
          const modManagerLink = auth.page
            .getByRole("link", { name: /mod manager download|vortex/i })
            .first();
          await expect(modManagerLink).toBeVisible({ timeout: 30_000 });
          await modManagerLink.click({ timeout: 15_000 });

          const modal = auth.page
            .locator('.popup, .modal, [role="dialog"], #popup-content')
            .first();
          const modalAppeared = await modal
            .waitFor({ state: "visible", timeout: 5_000 })
            .then(() => true)
            .catch(() => false);

          if (modalAppeared) {
            // The modal IS the requirements popup for mods that have deps.
            // For mods without deps (or for premium users who bypass it)
            // there's no "Download" link inside — the nxm:// URL fires
            // directly. Proceed if the inner button is missing.
            const modalDownloadButton = modal
              .getByRole("link", { name: /^download$/i })
              .first();
            if (
              await modalDownloadButton
                .isVisible({ timeout: 3_000 })
                .catch(() => false)
            ) {
              await modalDownloadButton.click({ timeout: 15_000 });
            }
          }
        });

        await test.step("Capture the nxm:// URL", async () => {
          // Free users land on a Slow download interstitial with a countdown;
          // premium users skip it and the nxm:// link is wired into the page
          // directly. Click the Slow download button only if it appears.
          await auth.page
            .waitForLoadState("load", { timeout: 30_000 })
            .catch(() => undefined);
          await acceptConsent(auth.page);
          await installNxmCapture(auth.page);

          const slowDownloadButton = auth.page.getByRole("button", {
            name: "Slow download",
          });
          if (
            await slowDownloadButton
              .first()
              .isVisible({ timeout: 5_000 })
              .catch(() => false)
          ) {
            await slowDownloadButton
              .first()
              .click({ timeout: 15_000 })
              .catch(() => undefined);
          }

          nxmUrl = await waitForNxmUrl(auth.page, 60_000);
          if (nxmUrl === null) {
            throw new Error(
              "No nxm:// URL appeared in the page after the download click",
            );
          }
        });

        await test.step("Forward the nxm:// URL to Vortex via IPC", async () => {
          if (nxmUrl === null) {
            throw new Error("nxmUrl was not captured");
          }
          await vortexApp.evaluate(({ BrowserWindow }, url) => {
            const target = BrowserWindow.getAllWindows().find((win) =>
              win.webContents.getURL().includes("index.html"),
            );
            if (target === undefined) {
              throw new Error("Vortex main window not found");
            }
            target.webContents.send("external-url", url, undefined, false);
          }, nxmUrl);
        });

        await test.step("Verify SMAPI is installed in Vortex", async () => {
          // Give Vortex time to download and install before checking Mods.
          await vortexWindow.waitForTimeout(5_000);

          const navbar = new NavBar(vortexWindow);
          await navbar.modsLink.click();

          const modRow = vortexWindow.getByText(/SMAPI/i).first();
          await expect(modRow).toBeVisible({ timeout: 60_000 });
        });
      } finally {
        if (authBrowser !== null) {
          await authBrowser.close().catch(() => undefined);
        }
        if (managed !== null) {
          cleanupFakeGame(managed.basePath);
        }
      }
    });
  }
});
