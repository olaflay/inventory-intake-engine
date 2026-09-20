import type { UUID } from "@inventory/domain";

export interface CanonicalAsset {
  id: UUID;
  internalRef: string;
  companyAssetNo?: string;
  categoryCode: string;
  description: string;
  serials: string[];
  locationId: UUID;
  movementState: "at_location" | "in_transit";
  statusCode: string;
  remarks?: string;
  version: number;
  updatedAt: string;
}

export interface AssetUpdatePayload {
  locationId?: UUID;
  movementState?: "at_location" | "in_transit";
  statusCode?: string;
  remarks?: string;
}

/**
 * Canonical Asset Registry (PRD §17, §41, LD-11)
 * Manages inventory equipment records, composite serial mappings, and optimistic versioning.
 */
export class AssetRegistry {
  private assets = new Map<UUID, CanonicalAsset>();
  private serialIndex = new Map<string, UUID>(); // normalized serial -> assetId
  private internalRefIndex = new Map<string, UUID>();

  constructor(initialAssets: CanonicalAsset[] = []) {
    for (const asset of initialAssets) {
      this.registerAsset(asset);
    }
  }

  private normalizeSerial(s: string): string {
    return s.toUpperCase().replace(/[- /.]/g, "").trim();
  }

  public registerAsset(asset: CanonicalAsset): void {
    this.assets.set(asset.id, { ...asset });
    this.internalRefIndex.set(asset.internalRef, asset.id);

    for (const s of asset.serials) {
      const norm = this.normalizeSerial(s);
      if (norm) {
        this.serialIndex.set(norm, asset.id);
      }
    }
  }

  public getById(id: UUID): CanonicalAsset | undefined {
    const asset = this.assets.get(id);
    return asset ? { ...asset } : undefined;
  }

  public findBySerial(serial: string): CanonicalAsset | undefined {
    const norm = this.normalizeSerial(serial);
    const id = this.serialIndex.get(norm);
    return id ? this.getById(id) : undefined;
  }

  public findByInternalRef(ref: string): CanonicalAsset | undefined {
    const id = this.internalRefIndex.get(ref);
    return id ? this.getById(id) : undefined;
  }

  public getAll(): CanonicalAsset[] {
    return Array.from(this.assets.values()).map(a => ({ ...a }));
  }

  public count(): number {
    return this.assets.size;
  }

  /**
   * LD-11 Optimistic update: Requires exact match on expectedVersion.
   * Increments version on success. Returns updated asset, or null if version mismatch.
   */
  public updateWithVersion(
    id: UUID,
    expectedVersion: number,
    updates: AssetUpdatePayload
  ): { success: boolean; asset?: CanonicalAsset; error?: string } {
    const existing = this.assets.get(id);
    if (!existing) {
      return { success: false, error: "Asset not found" };
    }

    if (existing.version !== expectedVersion) {
      return {
        success: false,
        error: `Stale version conflict (LD-11): expected ${expectedVersion}, current ${existing.version}`
      };
    }

    const updated: CanonicalAsset = {
      ...existing,
      ...updates,
      version: existing.version + 1,
      updatedAt: new Date().toISOString()
    };

    this.assets.set(id, updated);
    return { success: true, asset: { ...updated } };
  }

  /**
   * Batch commit for Importer Stage 3 (Commit)
   */
  public batchCommit(assets: CanonicalAsset[]): { committedCount: number } {
    for (const asset of assets) {
      this.registerAsset(asset);
    }
    return { committedCount: assets.length };
  }
}
