import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { createPerson, createProject, pickPerson, uniqueSuffix } from "./helpers";

/** A person on a 0.6 FTE assignment from 1 to 10 Jan 2026, off on Thu 8 Jan. */
async function staffedPerson(page: Page): Promise<{ name: string; projectName: string }> {
  const suffix = uniqueSuffix();
  const name = `Barbara Liskov ${suffix}`;
  const projectName = `Substitution ${suffix}`;
  await createPerson(page, name, `breakdown-qa-${suffix}`);

  await createProject(page, projectName);
  await page.getByRole("link", { name: projectName }).click();
  await page.getByRole("button", { name: "Assign person to Whole project" }).click();
  await pickPerson(page, name);
  await page.getByLabel("Commitment").selectOption("0.6");
  await page.getByLabel("Start date", { exact: true }).fill("2026-01-01");
  await page.getByLabel("End date", { exact: true }).fill("2026-01-10");
  await page.getByRole("button", { name: "Assign", exact: true }).click();
  await expect(page.getByRole("region", { name: "Staffing" })).toContainText("0.6 of 1 FTE");

  await page.goto("/people");
  await page.getByRole("link", { name }).click();
  await page.getByRole("tab", { name: "Availability" }).click();
  await page.getByRole("button", { name: "Add time off" }).click();
  await page.getByLabel("Vacation month").fill("2026-01");
  await page.getByRole("button", { name: "2026-01-08", exact: true }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page
      .getByRole("region", { name: "Time off & exceptions" })
      .getByText("Time off", { exact: true }),
  ).toBeVisible();

  return { name, projectName };
}

test("clicking a day on the capacity timeline shows what the person is staffed on", async ({
  page,
}) => {
  const { name, projectName } = await staffedPerson(page);

  await page.goto("/people/capacity?from=2026-01-01&to=2026-01-14");
  const breakdown = page.getByRole("region", { name: "Commitment breakdown" });

  // Sun 11 Jan is past the assignment, so the person is fully free and the day can't be opened.
  await expect(page.getByRole("button", { name: `${name}, 2026-01-11` })).toHaveCount(0);

  const partlyBooked = page.getByRole("button", { name: `${name}, 2026-01-05: 40%` });
  await partlyBooked.click();
  await expect(partlyBooked).toHaveAttribute("aria-pressed", "true");
  await expect(breakdown).toContainText(name);
  await expect(breakdown).toContainText(/Mon 5 Jan( 2026)? · 0\.4 of 1 FTE free/);
  const projectLink = breakdown.getByRole("link", { name: projectName });
  await expect(projectLink).toHaveAttribute("href", /^\/projects\/[^/]+$/);
  await expect(breakdown).toContainText("0.6 FTE");
  // Spans only carry their year once it differs from the current one.
  await expect(breakdown.getByText(/^1 Jan( 2026)? → 10 Jan( 2026)?$/)).toBeVisible();
  await expect(breakdown).not.toContainText("Time off");

  await partlyBooked.click();
  await expect(breakdown).toBeHidden();

  await page.getByRole("button", { name: `${name}, 2026-01-08: 0%` }).click();
  await expect(breakdown).toContainText(/Thu 8 Jan( 2026)? · 0 of 1 FTE free/);
  await expect(breakdown.getByText("Time off", { exact: true })).toBeVisible();
  await expect(breakdown.getByText(/^8 Jan( 2026)? → 8 Jan( 2026)?$/)).toBeVisible();
  await breakdown.getByRole("button", { name: "Close breakdown" }).click();
  await expect(breakdown).toBeHidden();

  await partlyBooked.click();
  await expect(breakdown).toBeVisible();
  await page.getByLabel("To", { exact: true }).fill("2026-01-15");
  await expect(breakdown).toBeHidden();

  // Ticking the person's own seniority keeps them on the grid but still clears the selection.
  await partlyBooked.click();
  await expect(breakdown).toBeVisible();
  await page.getByRole("checkbox", { name: "mid", exact: true }).check();
  await expect(partlyBooked).toBeVisible();
  await expect(breakdown).toBeHidden();
});

test("clicking a week on the person page lists everything overlapping it", async ({ page }) => {
  const { projectName } = await staffedPerson(page);

  await page.getByRole("tab", { name: "Custom" }).click();
  await page.getByLabel("From", { exact: true }).fill("2026-01-05");
  await page.getByLabel("To", { exact: true }).fill("2026-01-18");
  const breakdown = page.getByRole("region", { name: "Commitment breakdown" });

  await expect(page.getByTitle("Week of 2026-01-12: free", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Week of 2026-01-12/ })).toHaveCount(0);

  // Five days at 0.4, the day off at 0 and the free Sunday at 1: (5 × 0.4 + 1) / 7.
  const week = page.getByRole("button", { name: "Week of 2026-01-05: partly booked, 43% free" });
  await week.click();
  await expect(breakdown).toContainText(
    /Mon 5 Jan( 2026)? → Sun 11 Jan( 2026)? · 0\.43 of 1 FTE free on average/,
  );
  await expect(breakdown.getByText("Time off", { exact: true })).toBeVisible();
  await expect(breakdown.getByText(/^8 Jan( 2026)? → 8 Jan( 2026)?$/)).toBeVisible();
  await expect(breakdown.getByRole("link", { name: projectName })).toBeVisible();
  await expect(breakdown.getByText(/^1 Jan( 2026)? → 10 Jan( 2026)?$/)).toBeVisible();

  await week.click();
  await expect(breakdown).toBeHidden();

  await week.click();
  await expect(breakdown).toBeVisible();
  await page.getByLabel("To", { exact: true }).fill("2026-01-25");
  await expect(breakdown).toBeHidden();

  await week.click();
  await expect(breakdown).toBeVisible();
  await page.getByRole("tab", { name: "3 months" }).click();
  await expect(breakdown).toBeHidden();
});
