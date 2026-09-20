import type { UUID } from "@inventory/domain";

export interface LocationEntity {
  id: UUID;
  name: string;
  type: string; // from cfg:location_types (e.g. 'yard', 'vessel', 'site', 'store')
  parentId?: UUID;
  aliases: string[];
  isDestination: boolean;
  unrecorded?: boolean; // LD-9: legal unrecorded location state
}

export interface LocationResolutionResult {
  state: "resolved" | "ambiguous" | "unknown";
  location?: LocationEntity;
  candidates?: LocationEntity[];
  provisionalCandidate?: {
    rawText: string;
    suggestedAliasForId?: UUID;
  };
}

/**
 * Location and Alias Management Service (LD-9, FR-MAT-05, FR-PRO-05)
 * Manages typed location entities, alias mapping, and provisional candidates.
 * Zero domain literals: location types and rules are supplied by config.
 */
export class LocationService {
  private locations = new Map<UUID, LocationEntity>();

  constructor(initialLocations: LocationEntity[] = []) {
    for (const loc of initialLocations) {
      this.locations.set(loc.id, loc);
    }
  }

  public registerLocation(location: LocationEntity): void {
    this.locations.set(location.id, location);
  }

  public getLocation(id: UUID): LocationEntity | undefined {
    return this.locations.get(id);
  }

  public getAllLocations(): LocationEntity[] {
    return Array.from(this.locations.values());
  }

  /**
   * Normalize location text for matching (lowercase, alphanumeric + spaces only)
   */
  private normalize(text: string): string {
    return text.toLowerCase().replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();
  }

  /**
   * Resolve free-text location to a canonical entity (FR-MAT-05).
   * Exact matches on canonical name or aliases resolve immediately.
   * Multiple hits return 'ambiguous'.
   * Zero hits return 'unknown' with a provisional candidate (FR-PRO-05).
   */
  public resolveLocation(rawText: string): LocationResolutionResult {
    const norm = this.normalize(rawText);
    if (!norm) {
      // Empty text maps to unrecorded if present, otherwise unknown
      const unrecorded = Array.from(this.locations.values()).find(l => l.unrecorded);
      if (unrecorded) {
        return { state: "resolved", location: unrecorded };
      }
      return { state: "unknown" };
    }

    const matches: LocationEntity[] = [];

    for (const loc of this.locations.values()) {
      if (loc.unrecorded) continue;

      if (this.normalize(loc.name) === norm) {
        matches.push(loc);
        continue;
      }

      for (const alias of loc.aliases) {
        if (this.normalize(alias) === norm) {
          matches.push(loc);
          break;
        }
      }
    }

    if (matches.length === 1) {
      return { state: "resolved", location: matches[0] };
    }

    if (matches.length > 1) {
      return { state: "ambiguous", candidates: matches };
    }

    // No exact hit: check for substring or partial similarity as a suggestion
    let suggestion: LocationEntity | undefined;
    for (const loc of this.locations.values()) {
      if (loc.unrecorded) continue;
      const locNorm = this.normalize(loc.name);
      if (norm.includes(locNorm) || locNorm.includes(norm)) {
        suggestion = loc;
        break;
      }
    }

    return {
      state: "unknown",
      provisionalCandidate: {
        rawText,
        suggestedAliasForId: suggestion?.id
      }
    };
  }

  /**
   * Adds an alias to an existing location (e.g. after human approver maps a provisional candidate)
   */
  public addAlias(locationId: UUID, newAlias: string): boolean {
    const loc = this.locations.get(locationId);
    if (!loc) return false;
    const trimmed = newAlias.trim();
    if (!loc.aliases.includes(trimmed)) {
      loc.aliases.push(trimmed);
    }
    return true;
  }
}
