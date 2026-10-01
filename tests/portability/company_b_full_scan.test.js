import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const FORBIDDEN_LITERALS = [
  "GOSL",
  "Warami 10",
  "WARAMI 10",
  "FOT Jetty",
  "SEPNU",
  "EG PROJECT"
];

function scanDirectory(dir, fileList = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== "dist" && entry.name !== ".git") {
        scanDirectory(fullPath, fileList);
      }
    } else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".js"))) {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

test("Company-B Audit (LD-5 Zero Literals): Scan all packages/ for hardcoded domain literals", () => {
  const packagesDir = path.resolve(process.cwd(), "packages");
  const adaptersDir = path.resolve(process.cwd(), "adapters");

  const sourceFiles = [
    ...scanDirectory(path.join(packagesDir, "domain", "src")),
    ...scanDirectory(path.join(packagesDir, "engine", "src")),
    ...scanDirectory(path.join(packagesDir, "vision", "src")),
    ...scanDirectory(path.join(adaptersDir, "telegram", "src"))
  ];

  assert.ok(sourceFiles.length > 10, "Should have discovered source files to audit");

  const violations = [];

  for (const file of sourceFiles) {
    const content = fs.readFileSync(file, "utf-8");
    for (const literal of FORBIDDEN_LITERALS) {
      if (content.includes(literal)) {
        violations.push({
          file: path.relative(process.cwd(), file),
          literal
        });
      }
    }
  }

  assert.equal(
    violations.length,
    0,
    `Found hardcoded domain literals in engine packages:\n${violations
      .map(v => `  - ${v.file}: contains forbidden literal "${v.literal}"`)
      .join("\n")}`
  );
});
