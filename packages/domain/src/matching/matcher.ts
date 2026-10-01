import type { MatchResult, SerialMatchCandidate, MatchingConfig } from "../types.js";
import { normalizeSerial, isShortNumeric, extractSerialParts } from "./normalization.js";
import { confusionWeightedDistance } from "./confusionDistance.js";

export interface AssetRecord {
  id: string;
  internalRef: string;
  serials: string[];
  description: string;
  locationId: string | null;
  statusCode: string;
  remarks?: string;
}

function checkDescriptionConflict(
  docDesc: string,
  assetDesc: string,
  distinguishingTokens: string[][]
): boolean {
  const upperDoc = docDesc.toUpperCase();
  const upperAsset = assetDesc.toUpperCase();
  for (const group of distinguishingTokens) {
    const docToken = group.find(t => upperDoc.includes(t));
    const assetToken = group.find(t => upperAsset.includes(t));
    if (docToken && assetToken && docToken !== assetToken) {
      return true;
    }
  }
  return false;
}

export function matchLine(
  extractedSerial: string,
  extractedDesc: string,
  allAssets: AssetRecord[],
  config: MatchingConfig,
  destinationLocationId?: string,
  distinguishingTokens?: string[][]
): MatchResult {
  const flags: string[] = [];
  const activeDistinguishingTokens = distinguishingTokens ?? config.distinguishingTokens ?? [];
  const normExtracted = normalizeSerial(extractedSerial, config.ignorableChars);

  const configuredNullTokens = new Set(
    (config.nullSerialTokens || []).map(t =>
      t.toUpperCase().replace(/[^A-Z0-9]/g, "")
    )
  );
  const cleanToken = normExtracted.replace(/[^A-Z0-9]/g, "");
  if (
    !normExtracted ||
    (cleanToken.length > 0 && configuredNullTokens.has(cleanToken)) ||
    (config.nullSerialTokens && config.nullSerialTokens.includes(normExtracted))
  ) {
    return {
      state: "unknown",
      assetId: null,
      candidates: [],
      flags: ["no_serial"]
    };
  }

  // Check composite serial parts (FR-MAT-03, EC-38)
  const compositeParts = extractSerialParts(extractedSerial, config.separators, config.partMinLength);
  if (compositeParts.length > 1) {
    const matchedAssetIds = new Set<string>();
    const partCandidates: SerialMatchCandidate[] = [];

    for (const part of compositeParts) {
      for (const a of allAssets) {
        for (const s of a.serials) {
          if (normalizeSerial(s, config.ignorableChars) === part) {
            matchedAssetIds.add(a.id);
            partCandidates.push({
              assetId: a.id,
              internalRef: a.internalRef,
              serialRaw: s,
              serialNorm: part,
              score: 1.0,
              distance: 0.0,
              description: a.description,
              locationId: a.locationId,
              statusCode: a.statusCode,
              flags: ["composite_part_match"]
            });
          }
        }
      }
    }

    if (matchedAssetIds.size > 1) {
      return {
        state: "ambiguous",
        assetId: null,
        candidates: partCandidates,
        flags: [...flags, "composite_parts_conflict"]
      };
    }
  }

  // 1. Check exact match
  const exactMatches: { asset: AssetRecord; matchedSerial: string }[] = [];
  for (const a of allAssets) {
    for (const s of a.serials) {
      if (normalizeSerial(s, config.ignorableChars) === normExtracted) {
        exactMatches.push({ asset: a, matchedSerial: s });
      }
    }
  }

  if (exactMatches.length === 1) {
    const matched = exactMatches[0].asset;

    if (checkDescriptionConflict(extractedDesc, matched.description, activeDistinguishingTokens)) {
      flags.push("description_conflict");
    }

    if (destinationLocationId && matched.locationId === destinationLocationId) {
      flags.push("already_at_destination");
    }

    const hasNeighbor = allAssets.some(a =>
      a.id !== matched.id &&
      a.serials.some(s => {
        const d = confusionWeightedDistance(normExtracted, normalizeSerial(s, config.ignorableChars), config.confusionPairs);
        return d > 0 && d <= 1.0;
      })
    );

    const state = hasNeighbor ? "exact_with_neighbor" : "exact";
    if (hasNeighbor) flags.push("neighbor_serial_detected");

    return {
      state,
      assetId: matched.id,
      candidates: [{
        assetId: matched.id,
        internalRef: matched.internalRef,
        serialRaw: exactMatches[0].matchedSerial,
        serialNorm: normExtracted,
        score: 1.0,
        distance: 0.0,
        description: matched.description,
        locationId: matched.locationId,
        statusCode: matched.statusCode,
        flags: [...flags]
      }],
      flags
    };
  }

  if (exactMatches.length > 1) {
    return {
      state: "ambiguous",
      assetId: null,
      candidates: exactMatches.map(m => ({
        assetId: m.asset.id,
        internalRef: m.asset.internalRef,
        serialRaw: m.matchedSerial,
        serialNorm: normExtracted,
        score: 1.0,
        distance: 0.0,
        description: m.asset.description,
        locationId: m.asset.locationId,
        statusCode: m.asset.statusCode,
        flags: ["duplicate_serial_on_file"]
      })),
      flags: ["multiple_exact_matches"]
    };
  }

  // 2. Check composite serial parts flag
  if (compositeParts.length > 1) {
    flags.push("composite_serial");
  }

  // 3. Check fuzzy matches if eligible (PRD §18.2: No fuzzy on short numerics)
  if (config.shortNumericExactOnly && isShortNumeric(normExtracted)) {
    return {
      state: "unknown",
      assetId: null,
      candidates: [],
      flags: ["short_numeric_no_fuzzy"]
    };
  }

  if (normExtracted.length < config.fuzzyMinLength) {
    return {
      state: "unknown",
      assetId: null,
      candidates: [],
      flags: ["serial_too_short_for_fuzzy"]
    };
  }

  const fuzzyCandidates: SerialMatchCandidate[] = [];
  for (const a of allAssets) {
    for (const s of a.serials) {
      const normS = normalizeSerial(s, config.ignorableChars);
      const dist = confusionWeightedDistance(normExtracted, normS, config.confusionPairs);
      if (dist <= config.fuzzyMaxDistance) {
        const score = 1.0 - (dist / Math.max(normExtracted.length, normS.length));
        const candFlags = ["fuzzy_matched"];

        if (checkDescriptionConflict(extractedDesc, a.description, activeDistinguishingTokens)) {
          candFlags.push("description_conflict");
          if (!flags.includes("description_conflict")) {
            flags.push("description_conflict");
          }
        }

        fuzzyCandidates.push({
          assetId: a.id,
          internalRef: a.internalRef,
          serialRaw: s,
          serialNorm: normS,
          score,
          distance: dist,
          description: a.description,
          locationId: a.locationId,
          statusCode: a.statusCode,
          flags: candFlags
        });
      }
    }
  }

  if (fuzzyCandidates.length > 0) {
    fuzzyCandidates.sort((a, b) => a.distance - b.distance);
    const top = fuzzyCandidates.slice(0, config.maxCandidates);
    return {
      state: top.length === 1 ? "possible" : "ambiguous",
      assetId: top.length === 1 ? top[0].assetId : null,
      candidates: top,
      flags: [...flags, "possible_match"]
    };
  }

  return {
    state: "unknown",
    assetId: null,
    candidates: [],
    flags
  };
}
