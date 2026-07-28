import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const schemas = await import(path.resolve(here, "../../src/server/ai/schemas.ts"));
const { OutlineDraftSchema } = schemas;
const fixture = JSON.parse(fs.readFileSync(path.join(here, "outline-contract-fixture.json"), "utf8")) as {
  canonical: unknown;
  aliases: unknown;
  invalid: unknown;
  progressEvents: Array<{ status: string; progress: number; message: string }>;
  detailSummary: Record<string, unknown>;
};

function checkStructuredOutput() {
  const canonical = OutlineDraftSchema.safeParse(fixture.canonical);
  assert.equal(canonical.success, true, "canonical OutlineDraft must satisfy the production schema");
  if (canonical.success) {
    assert.equal(canonical.data.volumes.length, 1);
    assert.equal(canonical.data.volumes[0]?.chapters[0]?.order, 1);
  }

  const aliases = OutlineDraftSchema.safeParse(fixture.aliases);
  assert.equal(aliases.success, true, "compatible model aliases must normalize to OutlineDraft");
  if (aliases.success) {
    assert.equal(aliases.data.ending, "主角打破镜界规则，带着弟弟回到故乡。");
    assert.equal(aliases.data.volumes[0]?.title, "镜门");
    assert.equal(aliases.data.volumes[0]?.chapters[0]?.estimatedWords, 3200);
  }

  const invalid = OutlineDraftSchema.safeParse(fixture.invalid);
  assert.equal(invalid.success, false, "an empty outline must be rejected before persistence");
}

function checkProgressContract() {
  const allowedStatuses = new Set(["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED"]);
  const allowedTransitions: Record<string, Set<string>> = {
    QUEUED: new Set(["QUEUED", "RUNNING", "CANCELLED"]),
    RUNNING: new Set(["RUNNING", "SUCCEEDED", "FAILED", "CANCELLED"]),
    SUCCEEDED: new Set(),
    FAILED: new Set(),
    CANCELLED: new Set(),
  };
  let previous = -1;
  let previousStatus = "QUEUED";
  for (const event of fixture.progressEvents) {
    assert.equal(allowedStatuses.has(event.status), true, `unknown generation status: ${event.status}`);
    assert.equal(allowedTransitions[previousStatus]?.has(event.status), true, `invalid generation transition: ${previousStatus} -> ${event.status}`);
    assert.equal(Number.isInteger(event.progress) && event.progress >= 0 && event.progress <= 100, true, "progress must be 0..100");
    assert.equal(event.progress >= previous, true, "progress must not move backwards");
    assert.ok(event.message.trim(), "progress events need a user-facing message");
    previous = event.progress;
    previousStatus = event.status;
  }
  const last = fixture.progressEvents.at(-1);
  assert.equal(last?.status, "SUCCEEDED", "the happy path must end in SUCCEEDED");
  assert.equal(last?.progress, 100, "SUCCEEDED must report 100% progress");
}

function checkDetailReadContract() {
  const summary = fixture.detailSummary;
  for (const key of ["projectId", "title", "volumes", "chapters", "volumeCount", "chapterCount", "volumeDetails"]) {
    assert.ok(summary[key] !== undefined, `outline detail summary is missing ${key}`);
  }
  assert.equal(summary.volumes, summary.volumeCount, "compact and explicit volume counters must agree");
  assert.equal(summary.chapters, summary.chapterCount, "compact and explicit chapter counters must agree");
  assert.ok(Array.isArray(summary.volumeDetails), "volumeDetails must be an array");
  const detailTotal = (summary.volumeDetails as Array<{ chapterCount: number }>).reduce((sum, item) => sum + item.chapterCount, 0);
  assert.equal(detailTotal, summary.chapterCount, "volume detail counts must add up to chapterCount");
  assert.equal(Number.isNaN(Date.parse(String(summary.generatedAt))), false, "generatedAt must be an ISO date");
}

checkStructuredOutput();
checkProgressContract();
checkDetailReadContract();
console.log("Outline contract checks passed: structured output, progress lifecycle, and detail summary.");
