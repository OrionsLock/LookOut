import type { Page, Locator } from "playwright";
import type { TargetRef } from "@lookout/types";

export type ResolvedTarget = {
  locator: Locator;
  serialized: string;
};

async function countVisible(locator: Locator): Promise<number> {
  return await locator.count();
}

/**
 * Resolve a semantic target reference to a Playwright locator and serialized locator string.
 */
export async function resolveTarget(page: Page, target: TargetRef): Promise<ResolvedTarget | null> {
  if (target.selectorHint?.startsWith("data-testid=")) {
    const id = target.selectorHint.slice("data-testid=".length);
    const loc = page.getByTestId(id);
    if ((await countVisible(loc)) === 1) {
      return { locator: loc, serialized: `page.getByTestId(${JSON.stringify(id)})` };
    }
  }

  if (target.role && target.name) {
    const loc = page.getByRole(target.role as Parameters<Page["getByRole"]>[0], { name: target.name });
    if ((await countVisible(loc)) === 1) {
      return {
        locator: loc,
        serialized: `page.getByRole(${JSON.stringify(target.role)}, { name: ${JSON.stringify(target.name)} })`,
      };
    }
  }

  if (target.name) {
    const byLabel = page.getByLabel(target.name);
    if ((await countVisible(byLabel)) === 1) {
      return {
        locator: byLabel,
        serialized: `page.getByLabel(${JSON.stringify(target.name)})`,
      };
    }
    const byTextExact = page.getByText(target.name, { exact: true });
    if ((await countVisible(byTextExact)) === 1) {
      return {
        locator: byTextExact,
        serialized: `page.getByText(${JSON.stringify(target.name)}, { exact: true })`,
      };
    }
    const byText = page.getByText(target.name);
    if ((await countVisible(byText)) === 1) {
      return {
        locator: byText,
        serialized: `page.getByText(${JSON.stringify(target.name)})`,
      };
    }
  }

  return null;
}
