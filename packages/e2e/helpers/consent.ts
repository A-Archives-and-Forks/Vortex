import type { Page } from "@playwright/test";

import { CookieConsent } from "../selectors/cookieConsent";

/**
 * Click whichever cookie-consent acceptance button is on screen — Nexus Mods
 * shows different CMPs depending on geo / A-B (Quantcast Choice and Cookiebot
 * have both been observed). Some download-flow JS is gated on consent state,
 * so we accept rather than remove the dialog. Silently no-ops if no banner.
 */
export async function acceptConsent(page: Page): Promise<void> {
  const consent = new CookieConsent(page);
  const candidates = [
    consent.quantcastAccept,
    consent.cookiebotAllowAll,
    consent.cookiebotAcceptId,
  ];
  for (const locator of candidates) {
    if (
      await locator
        .first()
        .isVisible({ timeout: 1_000 })
        .catch(() => false)
    ) {
      await locator
        .first()
        .click({ timeout: 5_000 })
        .catch(() => undefined);
      return;
    }
  }
  // Quantcast renders inside an iframe; check frames as a fallback.
  for (const frame of page.frames()) {
    const acceptInFrame = frame
      .locator("button#accept-btn, button:has-text('Allow all')")
      .first();
    if (await acceptInFrame.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await acceptInFrame.click({ timeout: 5_000 }).catch(() => undefined);
      return;
    }
  }
}
