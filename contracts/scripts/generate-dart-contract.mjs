#!/usr/bin/env node
/**
 * Generates the Dart contract fixture from the canonical OpenAPI document.
 *
 * The Flutter app must not hand-copy the Web fixtures. This script reads
 * `contracts/openapi.json` plus the canonical fixtures, validates that they
 * agree, and writes a generated Dart file used by the App contract test.
 *
 * Usage (from the Web repo root):
 *   node contracts/scripts/generate-dart-contract.mjs
 *   node contracts/scripts/generate-dart-contract.mjs --check
 *   node contracts/scripts/generate-dart-contract.mjs --output ../SLNews-App/test/contracts/mobile_contract.g.dart
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(scriptDir, "..", "..");
const contractsDir = path.join(webRoot, "contracts");
const defaultOutput = path.resolve(
  webRoot,
  "..",
  "SLNews-App",
  "test",
  "contracts",
  "mobile_contract.g.dart"
);

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? null : (process.argv[index + 1] ?? null);
}

const output = path.resolve(arg("output") ?? defaultOutput);
const checkOnly = process.argv.includes("--check");

const spec = JSON.parse(
  readFileSync(path.join(contractsDir, "openapi.json"), "utf8")
);
const adFixture = JSON.parse(
  readFileSync(path.join(contractsDir, "fixtures", "ad-unit.json"), "utf8")
);
const eventFixture = JSON.parse(
  readFileSync(
    path.join(contractsDir, "fixtures", "event-request.json"),
    "utf8"
  )
);

function componentSchema(name) {
  const schema = spec.components?.schemas?.[name];
  if (!schema) throw new Error(`Missing component schema: ${name}`);
  return schema;
}

function sortedKeys(value) {
  return Object.keys(value).sort();
}

function assertSameKeys(label, actual, expected) {
  const a = sortedKeys(actual).join(",");
  const expectedKeys = Array.isArray(expected)
    ? expected
    : Object.keys(expected ?? {});
  const e = [...expectedKeys].sort().join(",");
  if (a !== e) {
    throw new Error(
      `${label} drifted from the OpenAPI schema. Fixture: [${a}] schema: [${e}]`
    );
  }
}

const adSchema = componentSchema("AdUnit");
const eventSchema = componentSchema("EventRequest");
assertSameKeys("AdUnit fixture", adFixture, adSchema.properties);
assertSameKeys("EventRequest fixture", eventFixture, eventSchema.properties);
if (!adSchema.required?.includes("id")) {
  throw new Error("AdUnit schema must require id");
}

const requiredAdFields = [...(adSchema.required ?? [])].sort();
const fixtureEntries = Object.entries(adFixture)
  .map(([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)},`)
  .join("\n");
const eventEntries = Object.entries(eventFixture)
  .map(([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)},`)
  .join("\n");

const dart = `// ignore_for_file: prefer_single_quotes\n// GENERATED FILE — do not edit by hand.
// Source: SLNews-Web/contracts/openapi.json and contracts/fixtures/.
// Regenerate from the Web repo with:
//   node contracts/scripts/generate-dart-contract.mjs
//
// The App contract test imports these values so the fixture cannot silently
// drift when the Web OpenAPI contract changes.

const Set<String> adUnitContractFields = <String>{
${sortedKeys(adFixture)
  .map((key) => `  ${JSON.stringify(key)},`)
  .join("\n")}
};

const Set<String> adUnitRequiredFields = <String>{
${requiredAdFields.map((key) => `  ${JSON.stringify(key)},`).join("\n")}
};

const Map<String, dynamic> adUnitContractFixture = <String, dynamic>{
${fixtureEntries}
};

const Set<String> eventRequestContractFields = <String>{
${sortedKeys(eventFixture)
  .map((key) => `  ${JSON.stringify(key)},`)
  .join("\n")}
};

const Map<String, dynamic> eventRequestContractFixture = <String, dynamic>{
${eventEntries}
};
`;

if (checkOnly) {
  let current = "";
  try {
    current = readFileSync(output, "utf8");
  } catch {
    console.error(`Generated contract is missing: ${output}`);
    process.exit(1);
  }
  if (current !== dart) {
    console.error(`Generated contract is stale: ${output}`);
    console.error("Run: node contracts/scripts/generate-dart-contract.mjs");
    process.exit(1);
  }
  process.stdout.write(`Generated contract is up to date: ${output}\n`);
  process.exit(0);
}

writeFileSync(output, dart, "utf8");
process.stdout.write(`Wrote ${output}\n`);
