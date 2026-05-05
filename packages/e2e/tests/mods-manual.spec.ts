/**
 * QA-109: free + premium user can manually download a mod from the Nexus
 * website and install it into Vortex via "Install From File".
 *
 * Counterpart to QA-108 (mod-manager link). The native file picker is
 * bypassed via globalThis.__VORTEX_TEST_INSTALL_FILE_PATH__ — the test
 * downloads SMAPI in the auth browser, then preloads the saved path so
 * Vortex's selectFile() returns it instead of opening the dialog.
 */
import type { Browser } from "@playwright/test";
import { test, expect } from "../fixtures/vortex-app";
import { cleanupFakeGame } from "../fixtures/game-setup/fake-game";
import { acceptConsent } from "../helpers/consent";
import { captureDownload } from "../helpers/downloads";
import { manageGame, type ManagedGame } from "../helpers/games";
import { loginToNexus } from "../helpers/login";
import { freeUser, premiumUser } from "../helpers/users";
import { NavBar } from "../selectors/navbar";

const SDV_MOD_URL = "https://www.nexusmods.com/stardewvalley/mods/2400";

const TIERS = [
  { tier: "free", user: freeUser },
  { tier: "premium", user: premiumUser },
] as const;

test.describe("Mods - Manual Downloads", () => {
  test.describe.configure({ mode: "parallel" });

  for (const { tier, user } of TIERS) {
    test(`[QA-109] ${tier} user can manually download SMAPI and Install From File`, async ({
      vortexApp,
      vortexWindow,
    }) => {
      test.setTimeout(180_000);

      let managed: ManagedGame | null = null;
      let authBrowser: Browser | null = null;

      try {
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

        let downloadedFilePath: string | null = null;

        await test.step("Click Manual Download", async () => {
          const manualLink = auth.page
            .getByRole("link", { name: /manual download/i })
            .first();
          await expect(manualLink).toBeVisible({ timeout: 30_000 });
          await manualLink.click({ timeout: 15_000 });
          await auth.page
            .waitForLoadState("load", { timeout: 30_000 })
            .catch(() => undefined);
          await acceptConsent(auth.page);
        });

        await test.step("Capture the file download", async () => {
          const captured = await captureDownload(
            auth.page,
            async () => {
              // Free users hit a "Slow download" interstitial; premium users
              // get the file directly. Either path resolves into a download.
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
            },
            tier,
          );
          downloadedFilePath = captured.path;
        });

        await test.step("Preload the install path test hook", async () => {
          if (downloadedFilePath === null) {
            throw new Error("File path was not captured");
          }
          await vortexWindow.evaluate((filePath) => {
            const slot = globalThis as {
              __VORTEX_TEST_INSTALL_FILE_PATH__?: string;
              global?: { __VORTEX_TEST_INSTALL_FILE_PATH__?: string };
            };
            slot.__VORTEX_TEST_INSTALL_FILE_PATH__ = filePath;
            if (slot.global !== undefined) {
              slot.global.__VORTEX_TEST_INSTALL_FILE_PATH__ = filePath;
            }
          }, downloadedFilePath);
        });

        await test.step("Click Install From File in Vortex", async () => {
          const navbar = new NavBar(vortexWindow);
          await navbar.modsLink.click();

          const installFromFile = vortexWindow.locator("#install-from-archive");
          await expect(installFromFile).toBeVisible({ timeout: 30_000 });
          await installFromFile.click({ timeout: 15_000 });
        });

        await test.step("Verify SMAPI is installed in Vortex", async () => {
          const modRow = vortexWindow.getByText(/SMAPI/i).first();
          await expect(modRow).toBeVisible({ timeout: 90_000 });
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
