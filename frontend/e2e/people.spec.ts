import { expect, test } from "./fixtures";
import { createPerson, createProject, pickPerson, uniqueSuffix } from "./helpers";

test("creating a person adds them to the roster", async ({ page }) => {
  const suffix = uniqueSuffix();
  const name = `Ada Lovelace ${suffix}`;

  await createPerson(page, name, `qa-engineer-${suffix}`);

  await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
});

test("exporting people downloads a CSV file", async ({ page }) => {
  const suffix = uniqueSuffix();
  const name = `Grace Hopper ${suffix}`;
  await createPerson(page, name, `qa-engineer-${suffix}`);

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toBe("people.csv");
});

test("importing a CSV adds new people and reports the result", async ({ page }) => {
  const suffix = uniqueSuffix();
  const roleId = `qa-engineer-${suffix}`;
  const personId = `imported-${suffix}`;
  const name = `Imported Person ${suffix}`;

  await page.goto("/people");
  await page.getByRole("button", { name: "Add role", exact: true }).click();
  await page.getByLabel("Role id").fill(roleId);
  await page.getByRole("button", { name: "Save" }).click();

  const csv = [
    "id,name,role,seniority,working_days_per_week,manager_id,skills,vacations,availability_windows,preferences,growth_targets,affinities",
    `${personId},${name},${roleId},mid,5,,[],[],[],[],[],{}`,
  ].join("\n");

  await page.locator('input[type="file"]').setInputFiles({
    name: "people.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });

  await expect(page.getByText(/Import complete — created 1\./)).toBeVisible();
  await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
});

test("importing a CSV with unknown roles/skills adds them to the catalog", async ({ page }) => {
  const suffix = uniqueSuffix();
  const roleId = `new-role-${suffix}`;
  const skillId = `new-skill-${suffix}`;
  const personId = `imported-${suffix}`;
  const name = `Catalog Import ${suffix}`;

  await page.goto("/people");

  const csv = [
    "id,name,role,seniority,working_days_per_week,manager_id,skills,vacations,availability_windows,preferences,growth_targets,affinities",
    `${personId},${name},${roleId},mid,5,,"[{""id"": ""${skillId}"", ""level"": 3}]",[],[],[],[],{}`,
  ].join("\n");

  await page.locator('input[type="file"]').setInputFiles({
    name: "people.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });

  // Neither role nor skill existed beforehand, so the import must have created both
  // catalog entries on the fly instead of failing with "Unknown role".
  await expect(
    page.getByText(/Also added 1 new role and 1 new skill to the catalog\./),
  ).toBeVisible();
  const row = page.getByRole("row", { name });
  await expect(row.getByText(roleId, { exact: true })).toBeVisible();
  await expect(row.getByText(skillId)).toHaveText(`${skillId}3`);
});

test("filtering the directory narrows the roster and survives a reload", async ({ page }) => {
  const suffix = uniqueSuffix();
  const ada = `Ada Filter ${suffix}`;
  const bob = `Bob Filter ${suffix}`;
  const adaRole = `filter-a-${suffix}`;
  await createPerson(page, ada, adaRole);
  await createPerson(page, bob, `filter-b-${suffix}`);

  await page.getByRole("button", { name: "Role", exact: true }).click();
  await page.getByRole("checkbox", { name: adaRole }).check();
  await expect(page.getByRole("link", { name: ada })).toBeVisible();
  await expect(page.getByRole("link", { name: bob })).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`role=${adaRole}`));

  await page.reload();
  await expect(page.getByRole("link", { name: ada })).toBeVisible();
  await expect(page.getByRole("link", { name: bob })).toHaveCount(0);

  await page.getByRole("searchbox", { name: "Search by name, role or skill" }).fill(bob);
  await expect(page.getByText("No one matches these filters.")).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.getByRole("link", { name: bob })).toBeVisible();
});

test("a skill nobody has shows as a coverage gap and is described on the Roles & skills tab", async ({
  page,
}) => {
  const skillId = `gap-skill-${uniqueSuffix()}`;

  await page.goto("/people");
  await page.getByRole("button", { name: "Add skill", exact: true }).click();
  await page.getByLabel("Skill id").fill(skillId);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(skillId, { exact: true }).locator("..")).toContainText("Nobody yet");

  await page.getByRole("link", { name: "Roles & skills" }).click();
  await expect(page).toHaveURL(/\/people\/catalog$/);
  await page.getByRole("button", { name: `Actions for skill ${skillId}` }).click();
  await page.getByRole("menuitem", { name: "Edit description" }).click();
  await page.getByLabel("Description").fill("Spotting staffing gaps");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("row", { name: skillId })).toContainText("Spotting staffing gaps");
});

test("a skill picked for a person is hidden from their other skill rows", async ({ page }) => {
  const suffix = uniqueSuffix();
  const alpha = `alpha-${suffix}`;
  const beta = `beta-${suffix}`;
  const roleId = `qa-engineer-${suffix}`;
  const suggestion = (skill: string) => page.getByRole("button", { name: skill, exact: true });

  await page.goto("/people");
  await page.getByRole("button", { name: "Add role", exact: true }).click();
  await page.getByLabel("Role id").fill(roleId);
  await page.getByRole("button", { name: "Save" }).click();
  for (const skillId of [alpha, beta]) {
    await page.getByRole("button", { name: "Add skill", exact: true }).click();
    await page.getByLabel("Skill id").fill(skillId);
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(skillId, { exact: true })).toBeVisible();
  }

  await page.getByRole("button", { name: "Add person", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill(`No Duplicates ${suffix}`);
  await page.getByRole("combobox", { name: /^Role/ }).selectOption(roleId);
  const addSkillRow = page.getByRole("button").filter({ hasText: "+ Add skill" });
  const skillIds = page.getByPlaceholder("skill id", { exact: true });
  await addSkillRow.click();
  await skillIds.last().fill(alpha);
  // Clicking outside the skill combobox closes its suggestion list, which would cover the button.
  await page.getByTitle("Proficiency level (0–5)").click();
  await addSkillRow.click();
  await skillIds.last().fill(suffix);
  await expect(suggestion(beta)).toBeVisible();
  await expect(suggestion(alpha)).toHaveCount(0);
  await skillIds.first().click();
  await expect(suggestion(alpha)).toBeVisible();

  await skillIds.last().fill(alpha);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("alert")).toHaveText(`Skill "${alpha}" is listed more than once.`);
});

test("searching the Roles and Skill coverage cards narrows their rows", async ({ page }) => {
  const suffix = uniqueSuffix();
  const roleA = `search-role-a-${suffix}`;
  const roleB = `search-role-b-${suffix}`;
  const skillA = `search-skill-a-${suffix}`;
  const skillB = `search-skill-b-${suffix}`;

  await page.goto("/people");
  for (const [kind, id] of [
    ["role", roleA],
    ["role", roleB],
    ["skill", skillA],
    ["skill", skillB],
  ]) {
    await page.getByRole("button", { name: `Add ${kind}`, exact: true }).click();
    await page.getByLabel(kind === "role" ? "Role id" : "Skill id").fill(id);
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(id, { exact: true })).toBeVisible();
  }

  const roleSearch = page.getByRole("searchbox", { name: "Search roles" });
  await roleSearch.fill(`ROLE-A-${suffix}`);
  await expect(page.getByText(roleA, { exact: true })).toBeVisible();
  await expect(page.getByText(roleB, { exact: true })).toHaveCount(0);
  await expect(page.getByText(skillB, { exact: true })).toBeVisible();

  const skillSearch = page.getByRole("searchbox", { name: "Search skills" });
  await skillSearch.fill(`skill-b-${suffix}`);
  await expect(page.getByText(skillB, { exact: true })).toBeVisible();
  await expect(page.getByText(skillA, { exact: true })).toHaveCount(0);

  await roleSearch.fill(`no-such-role-${suffix}`);
  await expect(page.getByText(`No roles match "no-such-role-${suffix}".`)).toBeVisible();
  await skillSearch.fill(`no-such-skill-${suffix}`);
  await expect(page.getByText(`No skills match "no-such-skill-${suffix}".`)).toBeVisible();

  await roleSearch.fill("");
  await expect(page.getByText(roleA, { exact: true })).toBeVisible();
  await expect(page.getByText(roleB, { exact: true })).toBeVisible();
});

test("searching the Roles & skills tables matches ids and descriptions", async ({ page }) => {
  const suffix = uniqueSuffix();
  const described = `catalog-search-a-${suffix}`;
  const other = `catalog-search-b-${suffix}`;

  await page.goto("/people/catalog");
  for (const [kind, id, description] of [
    ["role", `catalog-search-role-${suffix}`, ""],
    ["skill", described, `Kubernetes wrangling ${suffix}`],
    ["skill", other, ""],
  ]) {
    await page.getByRole("button", { name: `Add ${kind}`, exact: true }).click();
    await page.getByLabel(kind === "role" ? "Role id" : "Skill id").fill(id);
    await page.getByLabel("Description").fill(description);
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("row", { name: id })).toBeVisible();
  }

  const search = page.getByRole("searchbox", { name: "Search skills" });
  await search.fill(`kubernetes WRANGLING ${suffix}`);
  await expect(page.getByRole("row", { name: described })).toBeVisible();
  await expect(page.getByRole("row", { name: other })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /^Skills 1 of \d+$/ })).toBeVisible();

  await search.fill(`search-b-${suffix}`);
  await expect(page.getByRole("row", { name: other })).toBeVisible();
  await expect(page.getByRole("row", { name: described })).toHaveCount(0);

  await page.getByRole("button", { name: `Actions for skill ${other}` }).click();
  await page.getByRole("menuitem", { name: "Edit description" }).click();
  await page.getByLabel("Description").fill("Edited while filtered");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("row", { name: other })).toContainText("Edited while filtered");

  await page.getByRole("searchbox", { name: "Search roles" }).fill(`no-such-role-${suffix}`);
  await expect(page.getByText(`No roles match "no-such-role-${suffix}".`)).toBeVisible();
  await expect(page.getByRole("row", { name: other })).toBeVisible();
});

test("editing an availability window on the detail page updates the weekly strip", async ({
  page,
}) => {
  const suffix = uniqueSuffix();
  const name = `Katherine Johnson ${suffix}`;
  await createPerson(page, name, `qa-engineer-${suffix}`);

  await page.getByRole("link", { name }).click();
  await expect(page).toHaveURL(/\/people\/[^/]+$/);
  await expect(page.getByRole("heading", { name })).toBeVisible();

  await page.getByRole("tab", { name: "Availability" }).click();
  await page.getByRole("tab", { name: "Custom" }).click();
  await page.getByLabel("From", { exact: true }).fill("2026-01-05");
  await page.getByLabel("To", { exact: true }).fill("2026-01-18");
  await expect(page.getByTitle("Week of 2026-01-05: free", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Add time off" }).click();
  await page.getByRole("button", { name: "+ Add window" }).click();
  await page.getByLabel("Window start").fill("2026-01-05");
  await page.getByLabel("Window end").fill("2026-01-11");
  await page.getByLabel("Window ratio").fill("0.25");
  await page.getByRole("button", { name: "Save", exact: true }).click();

  await expect(page.getByTitle("Week of 2026-01-05: partly booked, 25% free")).toBeVisible();
  await expect(page.getByTitle("Week of 2026-01-12: free", { exact: true })).toBeVisible();
  const timeOff = page.getByRole("region", { name: "Time off & exceptions" });
  // Spans only carry their year once it differs from the current one.
  await expect(timeOff.getByText(/^5 Jan( 2026)? → 11 Jan( 2026)?$/)).toBeVisible();
  await expect(timeOff.getByText("0.25 FTE")).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/\/people$/);
});

test("working days per week derives the FTE shown on the roster and detail page", async ({
  page,
}) => {
  const suffix = uniqueSuffix();
  const name = `Hedy Lamarr ${suffix}`;
  await createPerson(page, name, `qa-engineer-${suffix}`);

  const row = page.getByRole("row", { name });
  const fteCell = row.getByRole("cell").nth(3);
  await expect(fteCell).toHaveText("1");

  await row.getByRole("button", { name: `Actions for ${name}` }).click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  await page.getByLabel("Working days per week").selectOption("4");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(fteCell).toHaveText("0.8");
  await page.getByRole("link", { name }).click();
  const contracted = page.getByText("Contracted", { exact: true }).locator("..");
  await expect(contracted).toContainText("0.8");
  await expect(contracted).toContainText("4 days/week");
});

test("marking a week of vacation on the detail page books that week", async ({ page }) => {
  const suffix = uniqueSuffix();
  const name = `Mary Jackson ${suffix}`;
  await createPerson(page, name, `qa-engineer-${suffix}`);

  await page.getByRole("link", { name }).click();
  await page.getByRole("tab", { name: "Availability" }).click();
  await page.getByRole("tab", { name: "Custom" }).click();
  await page.getByLabel("From", { exact: true }).fill("2026-01-05");
  await page.getByLabel("To", { exact: true }).fill("2026-01-18");
  await expect(page.getByTitle("Week of 2026-01-05: free", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Add time off" }).click();
  await page.getByLabel("Vacation month").fill("2026-01");
  await page.getByRole("button", { name: "2026-01-05", exact: true }).click();
  await page
    .getByRole("button", { name: "2026-01-11", exact: true })
    .click({ modifiers: ["Shift"] });
  await expect(page.getByText("2026-01-05 → 2026-01-11 (7 days)")).toBeVisible();
  await page.getByRole("button", { name: "Save", exact: true }).click();

  await expect(page.getByTitle("Week of 2026-01-05: booked", { exact: true })).toBeVisible();
  await expect(page.getByTitle("Week of 2026-01-12: free", { exact: true })).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "Add time off" }).click();
  await page.getByLabel("Vacation month").fill("2026-01");
  await expect(page.getByRole("button", { name: "2026-01-06", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("an assigned person shows reduced availability on their detail page", async ({ page }) => {
  const suffix = uniqueSuffix();
  const name = `Dorothy Vaughan ${suffix}`;
  const projectName = `Fortran ${suffix}`;
  await createPerson(page, name, `qa-engineer-${suffix}`);

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
  await page.getByRole("tab", { name: "Custom" }).click();
  await page.getByLabel("From", { exact: true }).fill("2026-01-05");
  await page.getByLabel("To", { exact: true }).fill("2026-01-11");
  // Booked 3 days/week from the 5th to the 10th, free on the 11th: (6 × 0.4 + 1) / 7.
  await expect(page.getByTitle("Week of 2026-01-05: partly booked, 49% free")).toBeVisible();

  await page.getByRole("tab", { name: "Overview" }).click();
  await expect(
    page.getByRole("region", { name: "Assignments" }).getByText("Not on any project right now"),
  ).toBeVisible();

  await page.getByRole("tab", { name: /^History/ }).click();
  const past = page.getByRole("region", { name: "Past assignments" });
  await expect(past.getByText(/^1 Jan( 2026)? → 10 Jan( 2026)? · 10 days$/)).toBeVisible();
  await past.getByRole("link", { name: projectName }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+$/);
  await expect(page.getByRole("heading", { level: 1, name: projectName })).toBeVisible();
});

test("an unknown person id shows a not-found state", async ({ page }) => {
  await page.goto(`/people/does-not-exist-${uniqueSuffix()}`);

  await expect(page.getByRole("heading", { name: "Person not found" })).toBeVisible();
  await page.getByRole("link", { name: "← Back to People" }).click();
  await expect(page).toHaveURL(/\/people$/);
});
