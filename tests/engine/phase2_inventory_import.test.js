import test from "node:test";
import assert from "node:assert/strict";
import {
  LocationService,
  AssetRegistry,
  LegacyExcelImporter,
  Reconciler
} from "../../packages/engine/dist/index.js";

test("LocationService: Resolves canonical locations, aliases, and unrecorded state (LD-9, FR-MAT-05)", () => {
  const service = new LocationService([
    {
      id: "loc-yard-1",
      name: "Base Yard Onne",
      type: "yard",
      aliases: ["Onne Yard", "FOT Yard"],
      isDestination: true
    },
    {
      id: "loc-vessel-warami",
      name: "Warami 10",
      type: "vessel",
      aliases: ["W-10", "Barge Warami 10"],
      isDestination: true
    },
    {
      id: "loc-unrecorded",
      name: "Unrecorded",
      type: "unrecorded",
      aliases: [],
      isDestination: false,
      unrecorded: true
    }
  ]);

  // 1. Exact name match
  const r1 = service.resolveLocation("Base Yard Onne");
  assert.equal(r1.state, "resolved");
  assert.equal(r1.location?.id, "loc-yard-1");

  // 2. Alias match
  const r2 = service.resolveLocation("w-10");
  assert.equal(r2.state, "resolved");
  assert.equal(r2.location?.id, "loc-vessel-warami");

  // 3. Unrecorded resolution
  const r3 = service.resolveLocation("");
  assert.equal(r3.state, "resolved");
  assert.equal(r3.location?.id, "loc-unrecorded");

  // 4. Unknown location with provisional candidate
  const r4 = service.resolveLocation("Warami 10 Jetty Berth 4");
  assert.equal(r4.state, "unknown");
  assert.ok(r4.provisionalCandidate);
  assert.equal(r4.provisionalCandidate.suggestedAliasForId, "loc-vessel-warami");

  // 5. Add alias dynamically
  service.addAlias("loc-vessel-warami", "Warami 10 Jetty Berth 4");
  const r5 = service.resolveLocation("Warami 10 Jetty Berth 4");
  assert.equal(r5.state, "resolved");
  assert.equal(r5.location?.id, "loc-vessel-warami");
});

test("AssetRegistry: Enforces composite serial lookup and LD-11 optimistic versioning", () => {
  const registry = new AssetRegistry();

  registry.registerAsset({
    id: "ast-100",
    internalRef: "GOSL/SE/045",
    categoryCode: "NAV",
    description: "Meridian Gyro",
    serials: ["8709", "GYRO-SUB-87"],
    locationId: "loc-yard-1",
    movementState: "at_location",
    statusCode: "AVAILABLE",
    version: 1,
    updatedAt: new Date().toISOString()
  });

  // Lookup by composite serial
  const found1 = registry.findBySerial("8709");
  assert.equal(found1?.id, "ast-100");
  const found2 = registry.findBySerial("gyro-sub-87");
  assert.equal(found2?.id, "ast-100");

  // Lookup by internalRef
  const foundRef = registry.findByInternalRef("GOSL/SE/045");
  assert.equal(foundRef?.id, "ast-100");

  // Optimistic update with correct version
  const updateRes = registry.updateWithVersion("ast-100", 1, {
    movementState: "in_transit",
    locationId: "loc-vessel-warami"
  });
  assert.equal(updateRes.success, true);
  assert.equal(updateRes.asset?.version, 2);
  assert.equal(updateRes.asset?.movementState, "in_transit");

  // Stale version update rejected (LD-11)
  const staleRes = registry.updateWithVersion("ast-100", 1, {
    statusCode: "MAINTENANCE"
  });
  assert.equal(staleRes.success, false);
  assert.ok(staleRes.error?.includes("Stale version conflict (LD-11)"));
});

test("Phase 2 Importer Gate (Appendix D-1): 3-Stage legacy import reproduces conflicts and enforces commit gate", () => {
  const importer = new LegacyExcelImporter();
  const registry = new AssetRegistry();

  // Synthesize July sample workbook characteristics (Appendix D-1):
  // ~452 rows, 18 multi-sheet duplicate serials, 6 repeated asset numbers, 223 unrecorded locations, 46 lacking both
  const sampleRows = [];

  // 1. Add 18 duplicate serials appearing across Sheet 1 and Sheet 2
  for (let i = 1; i <= 18; i++) {
    const sn = `SN-DUP-${String(i).padStart(3, "0")}`;
    sampleRows.push({
      sheetName: "Category_A",
      rowIndex: i,
      categoryCode: "SURVEY",
      itemDescription: `Echo Sensor ${i}`,
      serialRaw: sn,
      assetNo: `AST-${i}`,
      locationMarker: "1"
    });
    sampleRows.push({
      sheetName: "Purchased_Items",
      rowIndex: 100 + i,
      categoryCode: "PURCHASED",
      itemDescription: `Echo Sensor ${i} Purchased`,
      serialRaw: sn,
      assetNo: `AST-PUR-${i}`,
      locationMarker: "1"
    });
  }

  // 2. Add 6 repeated asset numbers
  for (let i = 1; i <= 6; i++) {
    const an = `REPEAT-AN-${i}`;
    sampleRows.push({
      sheetName: "Category_B",
      rowIndex: 200 + i,
      categoryCode: "DRILL",
      itemDescription: `Bit Item ${i}`,
      serialRaw: `SN-UNIQUE-B-${i}`,
      assetNo: an,
      locationMarker: "1"
    });
    sampleRows.push({
      sheetName: "Category_C",
      rowIndex: 300 + i,
      categoryCode: "DRILL",
      itemDescription: `Bit Item Duplicate ${i}`,
      serialRaw: `SN-UNIQUE-C-${i}`,
      assetNo: an,
      locationMarker: "1"
    });
  }

  // 3. Add 223 unrecorded location rows
  for (let i = 1; i <= 223; i++) {
    sampleRows.push({
      sheetName: "Category_D",
      rowIndex: 400 + i,
      categoryCode: "CABLE",
      itemDescription: `Power Cable ${i}`,
      serialRaw: `CBL-${i}`,
      assetNo: `GOSL/CBL/${i}`,
      locationMarker: "" // unrecorded
    });
  }

  // 4. Add 46 rows lacking both serial and asset number
  for (let i = 1; i <= 46; i++) {
    sampleRows.push({
      sheetName: "Category_E",
      rowIndex: 700 + i,
      categoryCode: "CONSUMABLE",
      itemDescription: `Cleaning Kit ${i}`,
      serialRaw: "",
      assetNo: "",
      locationMarker: "1"
    });
  }

  // 5. Add totals rows that must be ignored
  sampleRows.push(
    { sheetName: "Category_A", rowIndex: 999, categoryCode: "SURVEY", itemDescription: "Total Survey Items", isTotalRow: true },
    { sheetName: "Summary", rowIndex: 1000, categoryCode: "SUMMARY", itemDescription: "COUNT(A1:A500)", isTotalRow: true }
  );

  // Stage 1 & 2: Dry Run
  const dryRunReport = importer.dryRun(sampleRows);

  assert.equal(dryRunReport.totalIgnoredTotalsRows, 2);
  assert.equal(dryRunReport.unrecordedLocationCount, 223);
  assert.equal(dryRunReport.itemsLackingBothSerialAndAssetNo, 46);

  // Confirms 18 duplicate serials and 6 repeated asset numbers detected
  const dupSerials = dryRunReport.conflicts.filter(c => c.kind === "duplicate_serial");
  const dupAssets = dryRunReport.conflicts.filter(c => c.kind === "duplicate_asset_no");
  assert.equal(dupSerials.length, 18);
  assert.equal(dupAssets.length, 6);

  // Commit is blocked until conflicts are resolved
  assert.equal(dryRunReport.canCommit, false);
  assert.throws(
    () => importer.commit(sampleRows, registry, "loc-yard-1", "admin:lead"),
    /Commit Blocked \(PRD §20\.2\)/
  );

  // Stage 2: Resolve all conflicts
  for (const c of dryRunReport.conflicts) {
    importer.resolveConflict(c.id, { action: "merge", resolvedBy: "admin:lead" });
  }

  const updatedReport = importer.dryRun(sampleRows);
  assert.equal(updatedReport.canCommit, true);

  // Stage 3: Commit passes and populates registry
  const commitResult = importer.commit(sampleRows, registry, "loc-yard-1", "admin:lead");
  assert.ok(commitResult.committedCount > 0);
  assert.equal(commitResult.summary.mergedAssetsCount, 18);
  assert.equal(registry.count(), commitResult.committedCount);
});

test("Reconciler (FR-IMP-02): Detects 4-way discrepancy diff against hand-edited spreadsheet without database mutation", () => {
  const registry = new AssetRegistry();
  const reconciler = new Reconciler();

  // Seed canonical registry
  registry.registerAsset({
    id: "ast-01",
    internalRef: "GOSL/SE/001",
    categoryCode: "MONITOR",
    description: "Dell 24in Monitor",
    serials: ["SN-DELL-001"],
    locationId: "loc-yard-1",
    movementState: "at_location",
    statusCode: "AVAILABLE",
    version: 1,
    updatedAt: new Date().toISOString()
  });

  registry.registerAsset({
    id: "ast-02",
    internalRef: "GOSL/SE/002",
    categoryCode: "NAV",
    description: "Meridian Gyro",
    serials: ["SN-GYRO-8709"],
    locationId: "loc-yard-1",
    movementState: "at_location",
    statusCode: "AVAILABLE",
    version: 1,
    updatedAt: new Date().toISOString()
  });

  registry.registerAsset({
    id: "ast-03",
    internalRef: "GOSL/SE/003",
    categoryCode: "TOOL",
    description: "Calibration Rig",
    serials: ["SN-RIG-55"],
    locationId: "loc-yard-1",
    movementState: "at_location",
    statusCode: "AVAILABLE",
    version: 1,
    updatedAt: new Date().toISOString()
  });

  // Hand-edited sheet where:
  // 1. ast-01 is identical (matched_consistent)
  // 2. ast-02 has location changed to 'loc-vessel-warami' and status changed to 'FAULTY' (matched_different)
  // 3. ast-04 is a new row typed by hand in Excel (only_in_workbook)
  // 4. ast-03 is omitted from the sheet (only_in_database)
  const incomingRows = [
    {
      sheetName: "Monitors",
      rowIndex: 1,
      categoryCode: "MONITOR",
      itemDescription: "Dell 24in Monitor",
      serialRaw: "SN-DELL-001",
      locationMarker: "loc-yard-1",
      statusRaw: "AVAILABLE"
    },
    {
      sheetName: "Navigation",
      rowIndex: 2,
      categoryCode: "NAV",
      itemDescription: "Meridian Gyro",
      serialRaw: "SN-GYRO-8709",
      locationMarker: "loc-vessel-warami", // location discrepancy
      statusRaw: "FAULTY" // status discrepancy
    },
    {
      sheetName: "Tools",
      rowIndex: 3,
      categoryCode: "TOOL",
      itemDescription: "Hand-added Multimeter",
      serialRaw: "SN-METER-999", // not in database
      locationMarker: "loc-yard-1",
      statusRaw: "AVAILABLE"
    }
  ];

  const diffReport = reconciler.diff(incomingRows, registry);

  assert.equal(diffReport.matchedConsistentCount, 1);
  assert.equal(diffReport.matchedDifferent.length, 1);
  assert.equal(diffReport.onlyInWorkbook.length, 1);
  assert.equal(diffReport.onlyInDatabase.length, 1);

  // Check matched_different field details
  const diffAsset = diffReport.matchedDifferent[0];
  assert.equal(diffAsset.internalRef, "GOSL/SE/002");
  assert.equal(diffAsset.differences.length, 2);
  assert.ok(diffAsset.differences.some(d => d.field === "status" && d.workbookValue === "FAULTY"));
  assert.ok(diffAsset.differences.some(d => d.field === "location" && d.workbookValue === "loc-vessel-warami"));

  // Check only_in_workbook
  assert.equal(diffReport.onlyInWorkbook[0].serialRaw, "SN-METER-999");

  // Check only_in_database
  assert.equal(diffReport.onlyInDatabase[0].id, "ast-03");

  assert.equal(diffReport.summary.requiresReview, true);
  // Canonical registry must remain untouched
  assert.equal(registry.getById("ast-02")?.statusCode, "AVAILABLE");
  assert.equal(registry.getById("ast-02")?.locationId, "loc-yard-1");
});

test("Company-B Phase 2 Portability (LD-5): Verifies location service and importer against alternative schema with zero domain literals", () => {
  // Company-B has foreign vocabulary: Rig locations and German/alternate status codes
  const cbLocationService = new LocationService([
    {
      id: "cb-loc-1",
      name: "Bohrinsel Nordsee Alpha",
      type: "offshore_platform",
      aliases: ["Plattform Alpha", "Rig Alpha"],
      isDestination: true
    }
  ]);

  const res = cbLocationService.resolveLocation("Rig Alpha");
  assert.equal(res.state, "resolved");
  assert.equal(res.location?.id, "cb-loc-1");

  const cbRegistry = new AssetRegistry();
  const cbImporter = new LegacyExcelImporter();

  const cbRows = [
    {
      sheetName: "Tiefbohrwerkzeuge",
      rowIndex: 1,
      categoryCode: "BOHRER",
      itemDescription: "Diamantbohrkopf 500mm",
      serialRaw: "SN-DE-8899",
      assetNo: "CO-B/EQ/777",
      locationMarker: "cb-loc-1",
      statusRaw: "IN_BETRIEB"
    }
  ];

  const dryReport = cbImporter.dryRun(cbRows);
  assert.equal(dryReport.canCommit, true);

  const commitRes = cbImporter.commit(cbRows, cbRegistry, "cb-loc-1", "user:admin_cb");
  assert.equal(commitRes.committedCount, 1);

  const saved = cbRegistry.findBySerial("SN-DE-8899");
  assert.equal(saved?.statusCode, "IN_BETRIEB");
  assert.equal(saved?.internalRef, "CO-B/EQ/777");
});
