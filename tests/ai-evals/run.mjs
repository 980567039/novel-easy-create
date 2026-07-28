#!/usr/bin/env node

/**
 * Lightweight AI Eval harness.
 *
 * It deliberately has no test-runner dependency: fixture contracts can run in
 * CI with the Node version already required by Next.js. A model integration can
 * write a JSON result file and pass it with `--results path/to/results.json`.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(root, "fixtures");
const severityRank = { low: 1, medium: 2, high: 3, critical: 4 };
const issueTypes = new Set([
  "canon",
  "timeline",
  "location",
  "character",
  "causality",
  "pacing",
  "style",
  "foreshadowing",
]);

function fail(message) {
  throw new Error(message);
}

function asObject(value, context) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${context} must be an object`);
  }
  return value;
}

function validateFixture(fixture, fileName) {
  asObject(fixture, fileName);
  if (typeof fixture.id !== "string" || !fixture.id.trim()) fail(`${fileName}: id is required`);
  if (typeof fixture.title !== "string" || !fixture.title.trim()) fail(`${fixture.id}: title is required`);
  if (typeof fixture.category !== "string" || !fixture.category.trim()) fail(`${fixture.id}: category is required`);
  const canon = asObject(fixture.canon, `${fixture.id}.canon`);
  if (!Array.isArray(canon.facts) || canon.facts.length === 0) fail(`${fixture.id}: canon.facts must not be empty`);
  canon.facts.forEach((fact, index) => {
    asObject(fact, `${fixture.id}.canon.facts[${index}]`);
    for (const key of ["subject", "predicate", "value"]) {
      if (typeof fact[key] !== "string" || !fact[key].trim()) fail(`${fixture.id}: fact.${key} is required`);
    }
    if (fact.validFromChapter !== undefined && (!Number.isInteger(fact.validFromChapter) || fact.validFromChapter < 1)) {
      fail(`${fixture.id}: fact.validFromChapter must be a positive integer`);
    }
  });
  const chapter = asObject(fixture.chapter, `${fixture.id}.chapter`);
  if (!Number.isInteger(chapter.number) || chapter.number < 1) fail(`${fixture.id}: chapter.number must be positive`);
  if (typeof chapter.text !== "string" || !chapter.text.trim()) fail(`${fixture.id}: chapter.text is required`);
  const expected = asObject(fixture.expected, `${fixture.id}.expected`);
  if (typeof expected.hardContradiction !== "boolean") fail(`${fixture.id}: expected.hardContradiction must be boolean`);
  if (!Array.isArray(expected.issueTypes) || expected.issueTypes.some((type) => !issueTypes.has(type))) {
    fail(`${fixture.id}: expected.issueTypes contains an unknown type`);
  }
  if (expected.hardContradiction && expected.issueTypes.length === 0) {
    fail(`${fixture.id}: a contradiction must declare at least one issue type`);
  }
  if (expected.severityAtLeast !== null && expected.severityAtLeast !== undefined && !severityRank[expected.severityAtLeast]) {
    fail(`${fixture.id}: expected.severityAtLeast is invalid`);
  }
  if (!Array.isArray(expected.evidenceTokens)) fail(`${fixture.id}: expected.evidenceTokens must be an array`);
  const lowerText = chapter.text.toLocaleLowerCase();
  for (const token of expected.evidenceTokens) {
    if (typeof token !== "string" || !token.trim()) fail(`${fixture.id}: evidence tokens must be non-empty strings`);
    if (!lowerText.includes(token.toLocaleLowerCase())) fail(`${fixture.id}: evidence token not found in chapter text: ${token}`);
  }
}

function loadFixtures() {
  const files = fs.readdirSync(fixturesDir).filter((file) => file.endsWith(".json")).sort();
  if (files.length === 0) fail(`No JSON fixtures found in ${fixturesDir}`);
  const seen = new Set();
  const fixtures = files.map((file) => {
    const fixture = JSON.parse(fs.readFileSync(path.join(fixturesDir, file), "utf8"));
    validateFixture(fixture, file);
    if (seen.has(fixture.id)) fail(`Duplicate fixture id: ${fixture.id}`);
    seen.add(fixture.id);
    return fixture;
  });
  return fixtures;
}

function parseResults(resultPath) {
  const parsed = JSON.parse(fs.readFileSync(resultPath, "utf8"));
  const rows = Array.isArray(parsed) ? parsed : parsed.results;
  if (!Array.isArray(rows)) fail("Results file must be an array or an object with a results array");
  const byId = new Map();
  for (const row of rows) {
    asObject(row, "result row");
    if (typeof row.caseId !== "string" || !row.caseId) fail("Each result row needs caseId");
    if (byId.has(row.caseId)) fail(`Duplicate result caseId: ${row.caseId}`);
    if (!Array.isArray(row.issues)) fail(`${row.caseId}: issues must be an array`);
    row.issues.forEach((issue, index) => {
      asObject(issue, `${row.caseId}.issues[${index}]`);
      if (!issueTypes.has(issue.type)) fail(`${row.caseId}.issues[${index}]: unknown issue type`);
      if (!severityRank[issue.severity]) fail(`${row.caseId}.issues[${index}]: invalid severity`);
      if (typeof issue.evidence !== "string" || !issue.evidence.trim()) {
        fail(`${row.caseId}.issues[${index}]: evidence is required`);
      }
    });
    byId.set(row.caseId, row);
  }
  return byId;
}

function issueText(issue) {
  return [issue.evidence, issue.conflict, issue.suggestion].filter((value) => typeof value === "string").join(" ").toLocaleLowerCase();
}

function evaluate(fixtures, results) {
  const contradictions = fixtures.filter((fixture) => fixture.expected.hardContradiction);
  const controls = fixtures.filter((fixture) => !fixture.expected.hardContradiction);
  let detected = 0;
  let falsePositives = 0;
  const details = [];
  for (const fixture of fixtures) {
    const result = results.get(fixture.id) ?? { issues: [] };
    const issues = result.issues.filter((issue) => issue && typeof issue === "object");
    const expected = fixture.expected;
    const evidence = expected.evidenceTokens.map((token) => token.toLocaleLowerCase());
    const matching = issues.some((issue) => {
      const typeMatch = expected.issueTypes.includes(issue.type);
      const severityMatch = expected.severityAtLeast ? severityRank[issue.severity] >= severityRank[expected.severityAtLeast] : true;
      const evidenceMatch = evidence.length === 0 || evidence.some((token) => issueText(issue).includes(token));
      return typeMatch && severityMatch && evidenceMatch;
    });
    if (expected.hardContradiction && matching) detected += 1;
    if (!expected.hardContradiction && issues.length > 0) falsePositives += 1;
    details.push({ id: fixture.id, expected: expected.hardContradiction, detected: matching, issueCount: issues.length });
  }
  const detectionRate = contradictions.length ? detected / contradictions.length : 1;
  const falsePositiveRate = controls.length ? falsePositives / controls.length : 0;
  return { total: fixtures.length, hardContradictions: contradictions.length, detected, detectionRate, controls: controls.length, falsePositives, falsePositiveRate, details };
}

function main() {
  const fixtures = loadFixtures();
  const resultsFlag = process.argv.indexOf("--results");
  const resultPath = resultsFlag >= 0 ? process.argv[resultsFlag + 1] : undefined;
  if (resultsFlag >= 0 && !resultPath) fail("--results requires a JSON file path");
  console.log(`Validated ${fixtures.length} AI Eval fixtures (${fixtures.filter((fixture) => fixture.expected.hardContradiction).length} contradiction cases, ${fixtures.filter((fixture) => !fixture.expected.hardContradiction).length} controls).`);
  if (!resultPath) return;
  const report = evaluate(fixtures, parseResults(path.resolve(resultPath)));
  console.log(JSON.stringify(report, null, 2));
  if (process.argv.includes("--strict") && (report.detectionRate < 0.9 || report.falsePositiveRate > 0.1)) {
    process.exitCode = 1;
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
