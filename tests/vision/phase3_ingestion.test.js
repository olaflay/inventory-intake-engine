import test from "node:test";
import assert from "node:assert/strict";
import {
  detectMimeFromBytes,
  computeSha256,
  computePerceptualHash,
  computeHammingDistance,
  isDuplicateDocument,
  IngestionPipeline,
  PdfPageRenderer
} from "../../packages/vision/dist/index.js";
import { SubmissionAggregator } from "../../packages/engine/dist/index.js";

test("Magic Bytes (FR-DOC-01, EC-15): Detects real file format and rejects renamed executables", () => {
  // 1. JPEG magic bytes (FF D8 FF E0)
  const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
  const resJpeg = detectMimeFromBytes(jpegBytes);
  assert.equal(resJpeg.mime, "image/jpeg");
  assert.equal(resJpeg.isSupported, true);

  // 2. PNG magic bytes
  const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const resPng = detectMimeFromBytes(pngBytes);
  assert.equal(resPng.mime, "image/png");
  assert.equal(resPng.isSupported, true);

  // 3. PDF magic bytes (%PDF-1.7)
  const pdfBytes = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n<<>>\nendobj");
  const resPdf = detectMimeFromBytes(pdfBytes);
  assert.equal(resPdf.mime, "application/pdf");
  assert.equal(resPdf.isSupported, true);

  // 4. Renamed executable (MZ header disguised as picture) (EC-15)
  const exeDisguised = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
  const resExe = detectMimeFromBytes(exeDisguised);
  assert.equal(resExe.isExecutable, true);
  assert.equal(resExe.isSupported, false);
});

test("Duplicate Detection (FR-DOC-05, EC-05, EC-50): SHA-256 and perceptual dHash near-duplicate matching", () => {
  const bufA = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
  const bufB = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]); // identical
  const bufC = new Uint8Array([12, 22, 32, 42, 52, 62, 72, 82, 92, 102]); // slightly shifted (near-duplicate)
  const bufD = new Uint8Array([200, 10, 150, 2, 88, 12, 99, 4, 33, 1]);  // completely different

  const hashA = { sha256: computeSha256(bufA), perceptualHash: computePerceptualHash(bufA) };
  const hashB = { sha256: computeSha256(bufB), perceptualHash: computePerceptualHash(bufB) };
  const hashC = { sha256: computeSha256(bufC), perceptualHash: computePerceptualHash(bufC) };
  const hashD = { sha256: computeSha256(bufD), perceptualHash: computePerceptualHash(bufD) };

  // Exact duplicate via SHA-256
  const dupExact = isDuplicateDocument(hashA, hashB);
  assert.equal(dupExact.isDuplicate, true);
  assert.equal(dupExact.reason, "exact_sha256");

  // Near duplicate via dHash Hamming distance
  const distAC = computeHammingDistance(hashA.perceptualHash, hashC.perceptualHash);
  assert.ok(distAC <= 10);
  const dupNear = isDuplicateDocument(hashA, hashC, 10);
  assert.equal(dupNear.isDuplicate, true);
  assert.equal(dupNear.reason, "near_perceptual");

  // Different documents
  const distAD = computeHammingDistance(hashA.perceptualHash, hashD.perceptualHash);
  assert.ok(distAD > 10);
  const dupDiff = isDuplicateDocument(hashA, hashD, 10);
  assert.equal(dupDiff.isDuplicate, false);
});

test("Ingestion Pipeline: Blocks decompression bombs, unsupported formats, and executables (EC-13, EC-15)", () => {
  const pipeline = new IngestionPipeline();

  // 1. Executable file rejection
  const exeBuffer = new Uint8Array([0x4d, 0x5a, 0x00, 0x00]);
  const resExe = pipeline.process({ filename: "waybill.jpg", buffer: exeBuffer });
  assert.equal(resExe.success, false);
  assert.ok(resExe.flags.includes("executable_rejected"));

  // 2. Decompression bomb rejection (pixel count > 40MP) (EC-13)
  const validJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x11, 0x22]);
  const resBomb = pipeline.process({
    filename: "huge_manifest.jpg",
    buffer: validJpeg,
    declaredWidth: 10000,
    declaredHeight: 5000 // 50 MP > 40 MP cap
  });
  assert.equal(resBomb.success, false);
  assert.ok(resBomb.flags.includes("decompression_bomb_rejected"));

  // 3. File size limit rejection (> 20MB)
  const hugeBuffer = new Uint8Array(21 * 1024 * 1024);
  hugeBuffer.set([0xff, 0xd8, 0xff]);
  const resLarge = pipeline.process({ filename: "oversized.jpg", buffer: hugeBuffer });
  assert.equal(resLarge.success, false);
  assert.ok(resLarge.flags.includes("file_too_large"));
});

test("Ingestion Pipeline Quality Gate (FR-DOC-02, EC-01): Rejects severely blurred photos without AI spend", () => {
  const pipeline = new IngestionPipeline({ minLaplacianVariance: 100.0 });
  const validJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02, 0x03, 0x04]);

  // Blurred photo (Laplacian variance = 45 < 100)
  const resBlurred = pipeline.process({
    filename: "blurred_waybill.jpg",
    buffer: validJpeg,
    declaredWidth: 1920,
    declaredHeight: 1080,
    estimatedLaplacianVariance: 45.0
  });

  assert.equal(resBlurred.success, false);
  assert.equal(resBlurred.qualityPassed, false);
  assert.ok(resBlurred.flags.includes("needs_retake"));
  assert.ok(resBlurred.reasons[0].includes("severely blurred"));

  // Blurred photo with explicit 'useAnyway' override (FR-DOC-02) -> proceeds with low_quality flag
  const resOverride = pipeline.process({
    filename: "blurred_waybill.jpg",
    buffer: validJpeg,
    declaredWidth: 1920,
    declaredHeight: 1080,
    estimatedLaplacianVariance: 45.0,
    useAnyway: true
  });

  assert.equal(resOverride.success, true);
  assert.ok(resOverride.flags.includes("low_quality"));
  assert.equal(resOverride.pages.length, 1);
});

test("PDF Renderer (FR-DOC-03): Multi-page segmentation and max page cap enforcement", () => {
  const renderer = new PdfPageRenderer({ maxPdfPages: 3 });

  // Synthesize a 5-page PDF structure
  const pdfString = [
    "%PDF-1.4",
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [3 0 R 4 0 R 5 0 R 6 0 R 7 0 R] /Count 5 >> endobj",
    "3 0 obj << /Type /Page >> endobj",
    "4 0 obj << /Type /Page >> endobj",
    "5 0 obj << /Type /Page >> endobj",
    "6 0 obj << /Type /Page >> endobj",
    "7 0 obj << /Type /Page >> endobj",
    "%%EOF"
  ].join("\n");

  const pdfBuf = new TextEncoder().encode(pdfString);
  const result = renderer.renderPdf(pdfBuf);

  assert.equal(result.pageCount, 5);
  assert.equal(result.exceededMaxPages, true);
  // Must be capped at maxPdfPages (3)
  assert.equal(result.pages.length, 3);
  assert.equal(result.pages[0].pageNumber, 1);
  assert.equal(result.pages[2].pageNumber, 3);
});

test("Submission Aggregator (FR-INT-01, FR-TG-05, EC-11, EC-12): Handles media albums and quiet window timeout", () => {
  const aggregator = new SubmissionAggregator({
    maxFilesPerSubmission: 3,
    draftQuietSeconds: 60 // 60s quiet window
  });

  const t0 = new Date("2026-09-21T10:00:00Z");

  // 1. Worker sends Photo 1 of Waybill (part of Telegram album 'album-99') (EC-11)
  const r1 = aggregator.append(
    "telegram:tech_bob",
    "chat_777",
    {
      attachment: {
        id: "att-1",
        filename: "waybill_page1.jpg",
        sha256: "sha-001",
        mime: "image/jpeg",
        mediaGroupId: "album-99"
      }
    },
    t0
  );

  assert.equal(r1.isNewDraft, true);
  const draftId = r1.draft.id;
  assert.equal(r1.draft.attachments.length, 1);

  // 2. 15 seconds later: Worker sends Photo 2 of Manifest (same album) within quiet window
  const t1 = new Date("2026-09-21T10:00:15Z");
  const r2 = aggregator.append(
    "telegram:tech_bob",
    "chat_777",
    {
      text: "going to Onne today",
      attachment: {
        id: "att-2",
        filename: "manifest_page2.jpg",
        sha256: "sha-002",
        mime: "image/jpeg",
        mediaGroupId: "album-99"
      }
    },
    t1
  );

  // Must aggregate into the SAME draft (EC-11)
  assert.equal(r2.isNewDraft, false);
  assert.equal(r2.draft.id, draftId);
  assert.equal(r2.draft.attachments.length, 2);
  assert.equal(r2.draft.textMessages.length, 1);
  assert.ok(r2.draft.mediaGroupIds.has("album-99"));

  // 3. Appending beyond max files per submission throws limit error
  const t2 = new Date("2026-09-21T10:00:20Z");
  aggregator.append("telegram:tech_bob", "chat_777", {
    attachment: { id: "att-3", filename: "doc3.jpg", sha256: "sha-003", mime: "image/jpeg" }
  }, t2);

  assert.throws(
    () => aggregator.append("telegram:tech_bob", "chat_777", {
      attachment: { id: "att-4", filename: "doc4.jpg", sha256: "sha-004", mime: "image/jpeg" }
    }, t2),
    /Submission limit reached: maximum of 3 files allowed/
  );

  // 4. Interaction arriving after quiet window expires (75s > 60s) creates a NEW draft (EC-12)
  const t3 = new Date("2026-09-21T10:01:40Z");
  const r3 = aggregator.append(
    "telegram:tech_bob",
    "chat_777",
    { text: "new dispatch next week" },
    t3
  );

  assert.equal(r3.isNewDraft, true);
  assert.notEqual(r3.draft.id, draftId);
  assert.equal(r3.draft.textMessages[0], "new dispatch next week");
});
