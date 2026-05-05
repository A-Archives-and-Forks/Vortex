import type { Locator, Page } from "@playwright/test";

/**
 * Selectors for the cookie-consent banners that Nexus Mods shows. Geo / A-B
 * decides which CMP appears, so we model them all and let the helper pick
 * the first one visible. Quantcast can also render inside an iframe — the
 * helper handles that out-of-band.
 */
export class CookieConsent {
  readonly page: Page;
  readonly quantcastAccept: Locator;
  readonly cookiebotAllowAll: Locator;
  readonly cookiebotAcceptId: Locator;

  constructor(page: Page) {
    this.page = page;
    this.quantcastAccept = page.locator("button#accept-btn");
    this.cookiebotAllowAll = page.getByRole("button", { name: /^allow all$/i });
    this.cookiebotAcceptId = page.locator(
      "#CybotCookiebotDialogBodyButtonAccept",
    );
  }
}
