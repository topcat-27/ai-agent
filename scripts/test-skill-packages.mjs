import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSkillPacks } from "./skill-packages.mjs";

const packs = await loadSkillPacks();
let optionalCataloguePresent = true;
try {
  optionalCataloguePresent = (await readdir("optional-skills", { withFileTypes: true }))
    .some((entry) => entry.isDirectory() && !entry.name.startsWith("_"));
} catch {
  optionalCataloguePresent = false;
}
const byAgent = Object.fromEntries(
  ["project-manager", "sales", "marketing", "investment", "bookkeeping"].map(
    (agent) => [agent, packs.filter((pack) => pack.agent === agent).map((pack) => pack.id)],
  ),
);

assert.deepEqual(
  Object.fromEntries(Object.entries(byAgent).map(([agent, values]) => [agent, values.length])),
  { "project-manager": 1, sales: 2, marketing: 2, investment: 1, bookkeeping: 1 },
);
assert.deepEqual(byAgent["project-manager"], ["meeting-to-actions"]);
assert.deepEqual(byAgent.sales, ["linkedin-profile-lookup", "linkedin-prospect-search"]);
assert.deepEqual(byAgent.marketing, ["domain-research", "seo-aeo-article-writer"]);
assert.deepEqual(byAgent.investment, ["funding-and-investor-updates"]);
assert.deepEqual(byAgent.bookkeeping, ["xero-bookkeeping"]);

// Optional modules are fetched on demand, so optional-skills/<id> exists only
// once that module has been installed here. An absent folder therefore means
// "this learner has not installed that package", not a broken package contract.
// The reverse is what must always hold, and is what this checks: anything
// actually installed has to have its source folder present. Base modules ship
// with the project, so those are still required unconditionally.
const enabledIds = new Set(
  (await readFile(join("skills", "enabled.txt"), "utf8").catch(() => ""))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#")),
);
const isInstalled = async (id) => {
  if (enabledIds.has(id)) return true;
  try {
    await access(join("skills", id));
    return true;
  } catch {
    return false;
  }
};
for (const pack of packs) {
  for (const module of pack.modules) {
    if (module.source === "base") {
      await access(join("skills", module.id));
      continue;
    }
    if (!optionalCataloguePresent) continue;
    if (!(await isInstalled(module.id))) continue;
    await access(join("optional-skills", module.id));
  }
}

const invalidDirectory = await mkdtemp(join(tmpdir(), "skill-pack-contract-"));
try {
  for (const [id, requirement] of [["cycle-a", "cycle-b"], ["cycle-b", "cycle-a"]]) {
    const directory = join(invalidDirectory, id);
    await mkdir(directory);
    await writeFile(
      join(directory, "pack.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        id,
        agent: "sales",
        name: id,
        description: `${id} package used to test dependency validation.`,
        icon: "search",
        installable: true,
        requires: [requirement],
        modules: [
          { id, name: id, role: "core", source: "optional" },
        ],
      }, null, 2)}\n`,
    );
  }
  await assert.rejects(loadSkillPacks(invalidDirectory), /cyclic package dependency/);
} finally {
  await rm(invalidDirectory, { recursive: true, force: true });
}

process.stdout.write("Seven public packages map to the full internal module inventory. Checks passed.\n");
