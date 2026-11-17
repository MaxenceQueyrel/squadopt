import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import {
  addSkillRequirement,
  createPerson,
  createProject,
  pickPerson,
  uniqueSuffix,
} from "./helpers";

const PROJECT_CSV_HEADER = "id,name,description,priority,skill_requirements,date_ranges,phases";

const PEOPLE_CSV_HEADER =
  "id,name,role,seniority,working_days_per_week,manager_id,skills,vacations,availability_windows,preferences,growth_targets,affinities";

const quote = (value: unknown) => `"${JSON.stringify(value).replace(/"/g, '""')}"`;

function projectRow(page: Page, name: string): Locator {
  return page.getByRole("listitem").filter({ has: page.getByRole("link", { name, exact: true }) });
}

test("creating a project adds it to the list", async ({ page }) => {
  const name = `Website Revamp ${uniqueSuffix()}`;

  await createProject(page, name);

  const row = projectRow(page, name);
  await expect(row).toContainText("0 / 1");
  await expect(row).toContainText("Nobody assigned");
  await expect(row).toContainText("Unstaffed");
});

test("the project form sums per-skill FTE and keeps max people in range", async ({ page }) => {
  const name = `Skill Split ${uniqueSuffix()}`;

  await page.goto("/projects");
  await page.getByRole("button", { name: "New project" }).click();
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Add at least one skill requirement to every phase.",
  );

  await addSkillRequirement(page, { id: "python", minLevel: 3, fte: 2 });
  const maxPeople = page.getByLabel("Max people", { exact: true });
  await expect(maxPeople.first()).toHaveValue("2");
  // Two FTE splits across two full-timers up to ten people at one day per week.
  await expect(maxPeople.first().locator("option")).toHaveText(
    Array.from({ length: 9 }, (_, i) => String(i + 2)),
  );
  await maxPeople.first().selectOption("4");
  await page.getByLabel("FTE", { exact: true }).first().selectOption("1.2");
  await expect(maxPeople.first()).toHaveValue("4");
  await page.getByLabel("FTE", { exact: true }).first().selectOption("0.4");
  await expect(maxPeople.first()).toHaveValue("2");
  await page.getByLabel("FTE", { exact: true }).first().selectOption("2");

  await addSkillRequirement(page, { id: "react", minLevel: 2, fte: 0.8 });
  await expect(maxPeople.last()).toHaveValue("1");
  await expect(page.getByText("Total 2.8 FTE")).toBeVisible();
  await page.getByRole("button", { name: "Save" }).click();

  await expect(projectRow(page, name)).toContainText("0 / 2.8");
  await page.getByRole("link", { name }).click();
  const lane = page.getByRole("region", { name: "Staffing" });
  await expect(lane).toContainText("0 of 2.8 FTE");
  await expect(lane).toContainText("python ≥ 3 · 2 FTE");
  await expect(lane).toContainText("react ≥ 2 · 0.8 FTE");
});

test("a new project starts with one phase and adding a phase keeps the first one", async ({
  page,
}) => {
  const name = `Two Stages ${uniqueSuffix()}`;

  await page.goto("/projects");
  await page.getByRole("button", { name: "New project" }).click();
  await page.getByLabel("Name", { exact: true }).fill(name);
  await expect(page.getByLabel("Phase id", { exact: true })).toHaveValue("main");
  await addSkillRequirement(page, { id: "python", minLevel: 3, fte: 2 });
  // Like "+ Add requirement", these buttons take their form field's label.
  await page.getByRole("button").filter({ hasText: "+ Add date range" }).click();
  await page.getByLabel("Start", { exact: true }).fill("2027-01-01");
  await page.getByLabel("End", { exact: true }).fill("2027-01-31");

  await page.getByRole("button").filter({ hasText: "+ Add phase" }).click();
  const phaseIds = page.getByLabel("Phase id", { exact: true });
  await expect(phaseIds).toHaveCount(2);
  await expect(page.getByPlaceholder("skill id")).toHaveCount(1);
  await expect(page.getByPlaceholder("skill id")).toHaveValue("python");
  await expect(page.getByLabel("Minimum level", { exact: true })).toHaveValue("3");
  await expect(page.getByLabel("FTE", { exact: true })).toHaveValue("2");
  await expect(page.getByLabel("Start", { exact: true })).toHaveValue("2027-01-01");
  await expect(page.getByLabel("End", { exact: true })).toHaveValue("2027-01-31");

  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Add at least one skill requirement to every phase.",
  );
  await addSkillRequirement(page, { id: "general" });
  await page.getByRole("button").filter({ hasText: "+ Add date range" }).click();
  await page.getByLabel("Start", { exact: true }).last().fill("2027-02-01");
  await page.getByLabel("End", { exact: true }).last().fill("2027-02-28");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("alert")).toHaveText("Give every phase an id.");
  await phaseIds.first().fill("design");
  await phaseIds.last().fill("design");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("alert")).toHaveText("Give every phase a different id.");
  await phaseIds.last().fill("build");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(projectRow(page, name)).toContainText("0 / 3");
  await page.getByRole("link", { name }).click();
  const design = page.getByRole("region", { name: "design" });
  await expect(design).toContainText("0 of 2 FTE");
  await expect(design).toContainText("python ≥ 3 · 2 FTE");
  await expect(page.getByTitle("design: 2027-01-01 → 2027-01-31")).toBeVisible();
  const build = page.getByRole("region", { name: "build" });
  await expect(build).toContainText("0 of 1 FTE");
  await expect(build).toContainText("general ≥ 0 · 1 FTE");
  await expect(page.getByTitle("build: 2027-02-01 → 2027-02-28")).toBeVisible();
});

test("a skill picked in a phase is hidden from its other rows but offered in other phases", async ({
  page,
}) => {
  const suffix = uniqueSuffix();
  const alpha = `alpha-${suffix}`;
  const beta = `beta-${suffix}`;
  const suggestion = (skill: string) => page.getByRole("button", { name: skill, exact: true });

  // A saved project puts both skills in the catalog the pickers suggest from.
  await page.goto("/projects");
  await page.getByRole("button", { name: "New project" }).click();
  await page.getByLabel("Name", { exact: true }).fill(`Skill Catalog ${suffix}`);
  await addSkillRequirement(page, { id: alpha });
  await addSkillRequirement(page, { id: beta });
  await page.getByRole("button", { name: "Save" }).click();
  await page.getByRole("heading", { name: `Skill Catalog ${suffix}` }).waitFor();

  await page.getByRole("button", { name: "New project" }).click();
  await page.getByLabel("Name", { exact: true }).fill(`No Duplicates ${suffix}`);
  await addSkillRequirement(page, { id: alpha });
  await page.getByRole("button").filter({ hasText: "+ Add requirement" }).last().click();
  const skillIds = page.getByPlaceholder("skill id");
  await skillIds.last().fill(suffix);
  await expect(suggestion(beta)).toBeVisible();
  await expect(suggestion(alpha)).toHaveCount(0);
  await skillIds.first().click();
  await expect(suggestion(alpha)).toBeVisible();

  await skillIds.last().fill(alpha);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    `Phase "main" requires skill "${alpha}" more than once.`,
  );
  await skillIds.last().fill(beta);

  await page.getByRole("button").filter({ hasText: "+ Add phase" }).click();
  await page.getByRole("button").filter({ hasText: "+ Add requirement" }).last().click();
  await skillIds.last().fill(suffix);
  await expect(suggestion(alpha)).toBeVisible();
  await expect(suggestion(beta)).toBeVisible();
});

test("assigning a person from the project workspace shows the roster entry", async ({ page }) => {
  const suffix = uniqueSuffix();
  const projectName = `Platform Rewrite ${suffix}`;
  const personName = `Katherine Johnson ${suffix}`;

  await createPerson(page, personName, `platform-${suffix}`);
  await createProject(page, projectName);

  await page.getByRole("link", { name: projectName }).click();
  await expect(page.getByRole("heading", { level: 1, name: projectName })).toBeVisible();

  const lane = page.getByRole("region", { name: "Staffing" });
  await lane.getByRole("button", { name: "Assign person to Whole project" }).click();
  await pickPerson(lane, personName);
  // Allocations come in whole days per week only.
  await expect(lane.getByLabel("Commitment").locator("option")).toHaveText([
    "Full-time (5 days/week)",
    "4 days/week (80%)",
    "3 days/week (60%)",
    "2 days/week (40%)",
    "1 day/week (20%)",
  ]);
  await lane.getByLabel("Commitment").selectOption("0.6");
  await lane.getByLabel("Start date", { exact: true }).fill("2026-01-01");
  await lane.getByLabel("End date", { exact: true }).fill("2026-01-31");
  await lane.getByRole("button", { name: "Assign", exact: true }).click();

  const rosterEntry = lane.getByRole("listitem").filter({ hasText: personName });
  await expect(rosterEntry).toContainText("0.6 FTE");
  // Three days a week on a 1-FTE project leaves two days of it unstaffed.
  await expect(lane).toContainText("0.6 of 1 FTE");
  await expect(lane.getByText("0.4 FTE still open")).toBeVisible();
  await expect(lane.getByRole("listitem")).toHaveCount(1);

  await page
    .getByRole("navigation", { name: "Breadcrumb" })
    .getByRole("link", { name: "Projects" })
    .click();
  const row = projectRow(page, projectName);
  await expect(row).toContainText("0.6 / 1");
  await expect(row).toContainText(personName.split(" ")[0]);
  await expect(row).toContainText("Running");
});

test("assigning to a phase uses the phase dates and updates its fill", async ({ page }) => {
  const suffix = uniqueSuffix();
  const projectId = `phased-${suffix}`;
  const projectName = `Phased Project ${suffix}`;
  const personName = `Mary Jackson ${suffix}`;
  await createPerson(page, personName, `phased-${suffix}`);

  // Overlapping phases: build starts before design ends.
  const phases = [
    {
      id: "design",
      skill_requirements: [{ id: "general", min_level: 0, fte: 1 }],
      date_range: { start: "2026-01-01", end: "2026-01-31" },
    },
    {
      id: "build",
      skill_requirements: [{ id: "python", min_level: 3, fte: 2 }],
      date_range: { start: "2026-01-15", end: "2026-02-28" },
    },
  ];
  const csv = [PROJECT_CSV_HEADER, `${projectId},${projectName},,high,[],[],${quote(phases)}`].join(
    "\n",
  );
  await page.goto("/projects");
  await page.locator('input[type="file"]').setInputFiles({
    name: "projects.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
  await page.getByRole("link", { name: projectName }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}$`));

  await expect(page.getByTitle("design: 2026-01-01 → 2026-01-31")).toContainText("0 / 1 FTE");
  await expect(page.getByTitle("build: 2026-01-15 → 2026-02-28")).toContainText("0 / 2 FTE");

  const design = page.getByRole("region", { name: "design" });
  await design.getByRole("button", { name: "Assign person to design" }).click();
  await pickPerson(design, personName);
  await expect(design.getByLabel("Start date", { exact: true })).toHaveValue("2026-01-01");
  await expect(design.getByLabel("End date", { exact: true })).toHaveValue("2026-01-31");
  await design.getByRole("button", { name: "Assign", exact: true }).click();
  await expect(design).toContainText("1 of 1 FTE");
  await expect(design.getByText("Fully staffed")).toBeVisible();
  await expect(page.getByTitle("design: 2026-01-01 → 2026-01-31")).toContainText("1 / 1 FTE");

  // Full-time on both overlapping phases exceeds 1.0 FTE; the error stays in the lane.
  const build = page.getByRole("region", { name: "build" });
  await build.getByRole("button", { name: "Assign person to build" }).click();
  await pickPerson(build, personName);
  await build.getByRole("button", { name: "Assign", exact: true }).click();
  await expect(build.getByRole("alert")).toContainText("exceed 1.0 FTE");

  await build.getByLabel("Start date", { exact: true }).fill("2026-02-01");
  await build.getByRole("button", { name: "Assign", exact: true }).click();
  await expect(build).toContainText("1 of 2 FTE");
  await expect(build.getByText("Needs python ≥ 3")).toBeVisible();
  await expect(page.getByTitle("build: 2026-01-15 → 2026-02-28")).toContainText("1 / 2 FTE");
});

test("three people at 40% leave a 3-FTE project incomplete", async ({ page }) => {
  const suffix = uniqueSuffix();
  const projectId = `part-time-${suffix}`;
  const projectName = `Part-time Project ${suffix}`;
  const personNames = ["Ada", "Grace", "Hedy"].map((first) => `${first} ${suffix}`);
  for (const [i, personName] of personNames.entries()) {
    await createPerson(page, personName, `part-time-${i}-${suffix}`);
  }

  const requirements = [{ id: "general", min_level: 0, fte: 3 }];
  const csv = [
    PROJECT_CSV_HEADER,
    `${projectId},${projectName},,high,${quote(requirements)},[],[]`,
  ].join("\n");
  await page.goto("/projects");
  await page.locator('input[type="file"]').setInputFiles({
    name: "projects.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
  await page.getByRole("link", { name: projectName }).click();
  await expect(page.getByRole("heading", { level: 1, name: projectName })).toBeVisible();

  const lane = page.getByRole("region", { name: "Staffing" });
  for (const personName of personNames) {
    await lane.getByRole("button", { name: "Assign person to Whole project" }).click();
    await pickPerson(lane, personName);
    await lane.getByLabel("Commitment").selectOption("0.4");
    await lane.getByLabel("Start date", { exact: true }).fill("2026-01-01");
    await lane.getByLabel("End date", { exact: true }).fill("2026-01-31");
    await lane.getByRole("button", { name: "Assign", exact: true }).click();
    await expect(lane.getByRole("listitem").filter({ hasText: personName })).toBeVisible();
  }

  await expect(lane).toContainText("1.2 of 3 FTE");
  await expect(lane.getByRole("listitem")).toHaveCount(3);

  await page
    .getByRole("navigation", { name: "Breadcrumb" })
    .getByRole("link", { name: "Projects" })
    .click();
  const row = projectRow(page, projectName);
  await expect(row).toContainText("1.2 / 3");
  await expect(row).toContainText("Running");
});

test("the person picker flags skill and availability fit but lets anyone be assigned", async ({
  page,
}) => {
  const suffix = uniqueSuffix();
  const projectId = `picker-${suffix}`;
  const projectName = `Picker Project ${suffix}`;
  const role = `picker-dev-${suffix}`;
  const march = { start: "2027-03-01", end: "2027-03-31" };
  const fullMatch = `Fiona Full ${suffix}`;
  const halfAway = `Paula Partial ${suffix}`;
  const away = `Vera Vacation ${suffix}`;
  const noMatch = `Nate None ${suffix}`;
  const personRow = (
    i: number,
    name: string,
    seniority: string,
    skills: { id: string; level: number }[],
    vacations: { start: string; end: string }[],
  ) =>
    `picker-${i}-${suffix},${name},${role},${seniority},5,,${quote(skills)},${quote(vacations)},[],[],[],{}`;
  const rows = [
    personRow(
      0,
      fullMatch,
      "senior",
      [
        { id: "python", level: 4 },
        { id: "react", level: 3 },
      ],
      [],
    ),
    // Off for 16 of March's 31 days: 15/31 ≈ 0.48 FTE free on average.
    personRow(
      1,
      halfAway,
      "mid",
      [{ id: "python", level: 4 }],
      [{ start: "2027-03-01", end: "2027-03-16" }],
    ),
    personRow(
      2,
      away,
      "lead",
      [
        { id: "python", level: 5 },
        { id: "react", level: 4 },
      ],
      [march],
    ),
    personRow(3, noMatch, "junior", [{ id: "python", level: 1 }], []),
  ];
  await page.goto("/people");
  await page.locator('input[type="file"]').setInputFiles({
    name: "people.csv",
    mimeType: "text/csv",
    buffer: Buffer.from([PEOPLE_CSV_HEADER, ...rows].join("\n")),
  });
  await expect(page.getByText(/Import complete — created 4\./)).toBeVisible();

  const requirements = [
    { id: "python", min_level: 3, fte: 1 },
    { id: "react", min_level: 2, fte: 1 },
  ];
  const csv = [
    PROJECT_CSV_HEADER,
    `${projectId},${projectName},,high,${quote(requirements)},${quote([march])},[]`,
  ].join("\n");
  await page.goto("/projects");
  await page.locator('input[type="file"]').setInputFiles({
    name: "projects.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
  await page.getByRole("link", { name: projectName }).click();
  await expect(page.getByRole("heading", { level: 1, name: projectName })).toBeVisible();

  const lane = page.getByRole("region", { name: "Staffing" });
  await lane.getByRole("button", { name: "Assign person to Whole project" }).click();
  await lane.getByLabel("Person", { exact: true }).fill(suffix);
  const options = lane.getByRole("listbox", { name: "People" }).getByRole("option");
  const option = (name: string) => options.filter({ hasText: name });

  // Skill tier first, then free FTE, then name.
  await expect(options).toHaveCount(4);
  await expect(options.nth(0)).toContainText(fullMatch);
  await expect(options.nth(1)).toContainText(away);
  await expect(options.nth(2)).toContainText(halfAway);
  await expect(options.nth(3)).toContainText(noMatch);

  await expect(option(fullMatch)).toContainText(`${role} · Senior`);
  await expect(option(fullMatch)).toHaveAttribute("data-tier", "full");
  await expect(option(fullMatch)).toContainText("python 4");
  await expect(option(fullMatch)).toContainText("react 3");
  await expect(option(fullMatch)).toContainText("Available");
  await expect(option(away)).toHaveAttribute("data-tier", "full");
  await expect(option(away)).toContainText("Unavailable");
  await expect(option(halfAway)).toHaveAttribute("data-tier", "partial");
  await expect(option(halfAway)).toContainText("no react");
  await expect(option(halfAway)).toContainText("0.48 FTE free");
  await expect(option(noMatch)).toHaveAttribute("data-tier", "none");
  await expect(option(noMatch)).toContainText("python 1");
  await expect(option(noMatch)).toContainText("Available");

  // A lighter commitment re-rates the badges without leaving the form.
  await lane.getByLabel("Commitment").selectOption("0.4");
  await lane.getByLabel("Person", { exact: true }).fill(suffix);
  await expect(option(halfAway)).toContainText("Available");
  await expect(option(away)).toContainText("Unavailable");

  // Neither a skill mismatch nor a vacation blocks the assignment.
  await option(noMatch).click();
  await expect(lane.getByLabel("Person", { exact: true })).toHaveValue(noMatch);
  await lane.getByRole("button", { name: "Assign", exact: true }).click();
  await expect(lane.getByRole("listitem").filter({ hasText: noMatch })).toContainText("0.4 FTE");

  await lane.getByRole("button", { name: "Assign person to Whole project" }).click();
  await lane.getByLabel("Person", { exact: true }).fill(suffix);
  await expect(option(noMatch)).toContainText("Already on this phase");
  await expect(option(fullMatch)).not.toContainText("Already on this phase");
  await option(away).click();
  await lane.getByRole("button", { name: "Assign", exact: true }).click();
  await expect(lane.getByRole("listitem").filter({ hasText: away })).toContainText("1 FTE");
  await expect(lane).toContainText("1.4 of 2 FTE");
});

test("an unknown project id shows a not-found state", async ({ page }) => {
  await page.goto(`/projects/does-not-exist-${uniqueSuffix()}`);

  await expect(page.getByRole("heading", { name: "Project not found" })).toBeVisible();
  await page.getByRole("link", { name: "← Back to Projects" }).click();
  await expect(page).toHaveURL(/\/projects$/);
});

test("exporting projects downloads a CSV file", async ({ page }) => {
  const name = `Data Warehouse ${uniqueSuffix()}`;

  await createProject(page, name);

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export" }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toBe("projects.csv");
});

test("importing a CSV adds new projects and reports the result", async ({ page }) => {
  const suffix = uniqueSuffix();
  const projectId = `imported-${suffix}`;
  const name = `Imported Project ${suffix}`;

  await page.goto("/projects");

  const requirements = [{ id: "python", min_level: 3, fte: 2, max_people: 3 }];
  const csv = [
    PROJECT_CSV_HEADER,
    `${projectId},${name},Imported from CSV,high,${quote(requirements)},[],[]`,
  ].join("\n");

  await page.locator('input[type="file"]').setInputFiles({
    name: "projects.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });

  await expect(page.getByText(/Import complete — created 1\./)).toBeVisible();
  await expect(page.getByRole("heading", { name })).toBeVisible();
});

// Seven projects covering every sort key and filter bucket, searchable by `suffix`
// (`staffed` only when `staff` is set):
//   name     priority  span                     FTE  staffed
//   Alpha    medium    2027-02-01 → 2027-02-28  1    1 (100%)
//   Bravo    critical  2027-03-01 → 2027-06-30  2    1 (50%)
//   Charlie  critical  2027-01-01 → 2027-12-31  1    0
//   Delta    low       unscheduled              1    0
//   Echo     high      2026-12-01 → 2027-01-15  1    0
//   Foxtrot  low       2027-01-01 → 2027-01-31  1    0
//   Golf     low       unscheduled              1    0
async function seedSortableProjects(page: Page, { staff }: { staff: boolean }): Promise<string> {
  const suffix = uniqueSuffix();
  const needs = (fte: number) => quote([{ id: "general", min_level: 0, fte }]);
  const dates = (start: string, end: string) => quote([{ start, end }]);
  const projects = [
    ["alpha", "Alpha", "medium", needs(1), dates("2027-02-01", "2027-02-28")],
    ["bravo", "Bravo", "critical", needs(2), dates("2027-03-01", "2027-06-30")],
    ["charlie", "Charlie", "critical", needs(1), dates("2027-01-01", "2027-12-31")],
    ["delta", "Delta", "low", needs(1), "[]"],
    ["echo", "Echo", "high", needs(1), dates("2026-12-01", "2027-01-15")],
    ["foxtrot", "Foxtrot", "low", needs(1), dates("2027-01-01", "2027-01-31")],
    ["golf", "Golf", "low", needs(1), "[]"],
  ];
  const csv = [
    PROJECT_CSV_HEADER,
    ...projects.map(
      ([id, name, priority, requirements, dateRanges]) =>
        `${id}-${suffix},${name} ${suffix},,${priority},${requirements},${dateRanges},[]`,
    ),
  ].join("\n");
  await page.goto("/projects");
  await page.locator('input[type="file"]').setInputFiles({
    name: "projects.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
  await expect(page.getByText(/Import complete — created 7\./)).toBeVisible();

  if (staff) {
    const personName = `Dorothy Vaughan ${suffix}`;
    await createPerson(page, personName, `sortable-${suffix}`);
    for (const [id, start, end, fill] of [
      ["alpha", "2027-02-01", "2027-02-28", "1 of 1 FTE"],
      ["bravo", "2027-03-01", "2027-03-31", "1 of 2 FTE"],
    ]) {
      await page.goto(`/projects/${id}-${suffix}`);
      const lane = page.getByRole("region", { name: "Staffing" });
      await lane.getByRole("button", { name: "Assign person to Whole project" }).click();
      await pickPerson(lane, personName);
      await lane.getByLabel("Start date", { exact: true }).fill(start);
      await lane.getByLabel("End date", { exact: true }).fill(end);
      await lane.getByRole("button", { name: "Assign", exact: true }).click();
      await expect(lane).toContainText(fill);
    }
  }
  return suffix;
}

async function expectOrder(page: Page, suffix: string, names: string[]): Promise<void> {
  await expect(page.getByRole("listitem").getByRole("heading", { level: 3 })).toHaveText(
    names.map((name) => `${name} ${suffix}`),
  );
}

async function pickFilters(page: Page, menu: string, options: string[]): Promise<void> {
  await page.getByRole("button", { name: new RegExp(`^${menu}`) }).click();
  for (const option of options) {
    await page.getByRole("checkbox", { name: option, exact: true }).click();
  }
  await page.keyboard.press("Escape");
}

async function setDateRange(page: Page, from: string, to: string): Promise<void> {
  await page.getByRole("button", { name: /^Dates/ }).click();
  await page.getByLabel("From", { exact: true }).fill(from);
  await page.getByLabel("To", { exact: true }).fill(to);
  await page.keyboard.press("Escape");
}

test("the project list sorts by priority, dates and staffing in both directions", async ({
  page,
}) => {
  const suffix = await seedSortableProjects(page, { staff: true });
  await page.goto(`/projects?q=${suffix}`);
  const sortBy = page.getByLabel("Sort by");

  // Priority, highest first; ties by soonest start (unscheduled last), then by name.
  await expect(sortBy).toHaveValue("priority");
  await expectOrder(page, suffix, [
    "Charlie",
    "Bravo",
    "Echo",
    "Alpha",
    "Foxtrot",
    "Delta",
    "Golf",
  ]);
  await page.getByRole("button", { name: "Sort descending" }).click();
  await expectOrder(page, suffix, [
    "Foxtrot",
    "Delta",
    "Golf",
    "Alpha",
    "Echo",
    "Charlie",
    "Bravo",
  ]);

  // Switching key resets the direction to the key's own default: soonest first.
  await sortBy.selectOption("start");
  await expect(page.getByRole("button", { name: "Sort ascending" })).toBeVisible();
  await expectOrder(page, suffix, [
    "Echo",
    "Charlie",
    "Foxtrot",
    "Alpha",
    "Bravo",
    "Delta",
    "Golf",
  ]);
  await page.getByRole("button", { name: "Sort ascending" }).click();
  await expectOrder(page, suffix, [
    "Bravo",
    "Alpha",
    "Charlie",
    "Foxtrot",
    "Echo",
    "Delta",
    "Golf",
  ]);

  await sortBy.selectOption("end");
  await expectOrder(page, suffix, [
    "Echo",
    "Foxtrot",
    "Alpha",
    "Bravo",
    "Charlie",
    "Delta",
    "Golf",
  ]);
  await page.getByRole("button", { name: "Sort ascending" }).click();
  await expectOrder(page, suffix, [
    "Charlie",
    "Bravo",
    "Alpha",
    "Foxtrot",
    "Echo",
    "Delta",
    "Golf",
  ]);

  // Fullest first; equally staffed projects by highest priority, then name, both ways.
  await sortBy.selectOption("staffing");
  await expect(page.getByRole("button", { name: "Sort descending" })).toBeVisible();
  await expectOrder(page, suffix, [
    "Alpha",
    "Bravo",
    "Charlie",
    "Echo",
    "Delta",
    "Foxtrot",
    "Golf",
  ]);
  await page.getByRole("button", { name: "Sort descending" }).click();
  await expectOrder(page, suffix, [
    "Charlie",
    "Echo",
    "Delta",
    "Foxtrot",
    "Golf",
    "Bravo",
    "Alpha",
  ]);
});

test("a project requesting no FTE stays last on the staffing sort", async ({ page }) => {
  const suffix = await seedSortableProjects(page, { staff: false });
  // The API rejects projects without skill requirements, so only legacy data has 0 FTE.
  await page.route("**/api/v1/projects/", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    const projects = await response.json();
    projects.push({
      ...projects[0],
      id: `hotel-${suffix}`,
      name: `Hotel ${suffix}`,
      description: "",
      priority: "critical",
      phases: [
        {
          id: "main",
          skill_requirements: [],
          date_range: { start: "2026-12-01", end: "2026-12-31" },
        },
      ],
      completed_at: null,
      start_window: null,
    });
    await route.fulfill({ response, json: projects });
  });
  await page.goto(`/projects?q=${suffix}&sort=staffing`);

  // All other projects are at 0%, so they keep the same tie-break order both ways.
  const unstaffed = ["Bravo", "Charlie", "Echo", "Alpha", "Delta", "Foxtrot", "Golf"];
  await expectOrder(page, suffix, [...unstaffed, "Hotel"]);
  await page.getByRole("button", { name: "Sort descending" }).click();
  await expectOrder(page, suffix, [...unstaffed, "Hotel"]);

  // Its fill bar reads as full, and so does the staffing filter.
  await pickFilters(page, "Staffing", ["Fully staffed"]);
  await expectOrder(page, suffix, ["Hotel"]);
});

test("the project list filters by priority, staffing and dates", async ({ page }) => {
  const suffix = await seedSortableProjects(page, { staff: true });
  await page.goto(`/projects?q=${suffix}`);

  await pickFilters(page, "Priority", ["Critical", "High"]);
  await expectOrder(page, suffix, ["Charlie", "Bravo", "Echo"]);
  await pickFilters(page, "Priority", ["Critical", "High"]);

  await pickFilters(page, "Staffing", ["Unstaffed"]);
  await expectOrder(page, suffix, ["Charlie", "Echo", "Foxtrot", "Delta", "Golf"]);
  await pickFilters(page, "Staffing", ["Unstaffed", "Fully staffed"]);
  await expectOrder(page, suffix, ["Alpha"]);
  await pickFilters(page, "Staffing", ["Fully staffed", "Partially staffed"]);
  await expectOrder(page, suffix, ["Bravo"]);
  await pickFilters(page, "Staffing", ["Partially staffed"]);

  // Only a "To" bound: projects starting on or before it; unscheduled ones are hidden.
  await setDateRange(page, "", "2027-01-10");
  await expectOrder(page, suffix, ["Charlie", "Echo", "Foxtrot"]);
  // Only a "From" bound: projects ending on or after it.
  await setDateRange(page, "2027-03-01", "");
  await expectOrder(page, suffix, ["Charlie", "Bravo"]);
  // Both bounds: projects active at some point in the window.
  await setDateRange(page, "2027-02-10", "2027-02-20");
  await expectOrder(page, suffix, ["Charlie", "Alpha"]);
  await page.getByRole("button", { name: /^Dates/ }).click();
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await page.keyboard.press("Escape");
  await expectOrder(page, suffix, [
    "Charlie",
    "Bravo",
    "Echo",
    "Alpha",
    "Foxtrot",
    "Delta",
    "Golf",
  ]);

  // Filters combine with each other, the status tab and the search.
  await pickFilters(page, "Priority", ["Low"]);
  await pickFilters(page, "Staffing", ["Unstaffed"]);
  await setDateRange(page, "", "2027-06-30");
  await expectOrder(page, suffix, ["Foxtrot"]);
  await page.getByRole("button", { name: /^Dates/ }).click();
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await page.keyboard.press("Escape");
  await expectOrder(page, suffix, ["Foxtrot", "Delta", "Golf"]);
  await page.getByPlaceholder("Search projects").fill(`Golf ${suffix}`);
  await expectOrder(page, suffix, ["Golf"]);

  await page.goto(`/projects?q=${suffix}&priority=critical,medium`);
  await page.getByRole("tab", { name: /^Running/ }).click();
  await expectOrder(page, suffix, ["Bravo", "Alpha"]);
});

test("project list filters and sort survive a reload", async ({ page }) => {
  const suffix = await seedSortableProjects(page, { staff: false });
  await page.goto(`/projects?q=${suffix}`);

  await pickFilters(page, "Priority", ["Low", "Critical"]);
  await setDateRange(page, "2027-01-01", "");
  await page.getByLabel("Sort by").selectOption("end");
  await page.getByRole("button", { name: "Sort ascending" }).click();
  await expect(page).toHaveURL(
    new RegExp(`\\?q=${suffix}&priority=low%2Ccritical&from=2027-01-01&sort=end&dir=desc$`),
  );

  await page.reload();
  await expect(page.getByLabel("Sort by")).toHaveValue("end");
  await expect(page.getByRole("button", { name: "Sort descending" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Priority/ })).toHaveText(/^Priority\s*2/);
  await expectOrder(page, suffix, ["Charlie", "Bravo", "Foxtrot"]);

  // Invalid values fall back to the defaults: every project, highest priority first.
  await page.goto(
    `/projects?q=${suffix}&priority=urgent&staffing=some&from=soon&to=2027-13&sort=name&dir=up`,
  );
  await expect(page.getByLabel("Sort by")).toHaveValue("priority");
  await expect(page.getByRole("button", { name: "Sort descending" })).toBeVisible();
  await expectOrder(page, suffix, [
    "Charlie",
    "Bravo",
    "Echo",
    "Alpha",
    "Foxtrot",
    "Delta",
    "Golf",
  ]);
  await expect(page).toHaveURL(new RegExp(`\\?q=${suffix}$`));
});
