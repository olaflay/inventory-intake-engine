import { OpsWorkbookLoader, type OpsWorkbookSheets, type ConfigSnapshot } from "./opsWorkbookLoader.js";
import { EventHub } from "../events/eventHub.js";

export interface ReloadResult {
  success: boolean;
  snapshot: ConfigSnapshot;
  error?: string;
}

/**
 * ConfigManager (FR-CFG-01, FR-CFG-02, EC-53, PRD §45)
 * Manages active immutable configuration snapshots.
 * Enforces atomic reload: on any validation failure, leaves the previous valid
 * snapshot active and emits a `config.invalid` event with the reason.
 */
export class ConfigManager {
  private loader: OpsWorkbookLoader;
  private activeSnapshot: ConfigSnapshot | null = null;
  private eventHub?: EventHub;

  constructor(eventHub?: EventHub) {
    this.loader = new OpsWorkbookLoader();
    this.eventHub = eventHub;
  }

  public getActiveSnapshot(): ConfigSnapshot | null {
    return this.activeSnapshot;
  }

  public loadInitialConfig(sheets: OpsWorkbookSheets): ConfigSnapshot {
    const snapshot = this.loader.validateAndCreateSnapshot(sheets);
    this.activeSnapshot = snapshot;
    return snapshot;
  }

  public reloadConfig(sheets: OpsWorkbookSheets): ReloadResult {
    try {
      const newSnapshot = this.loader.validateAndCreateSnapshot(sheets);
      const isChanged = this.activeSnapshot ? this.activeSnapshot.sha256 !== newSnapshot.sha256 : true;
      this.activeSnapshot = newSnapshot;

      if (this.eventHub && isChanged) {
        this.eventHub.emit({
          type: "config.reloaded",
          entityType: "config",
          entityId: newSnapshot.id,
          audience: ["admin"],
          payload: {
            snapshotId: newSnapshot.id,
            sha256: newSnapshot.sha256,
            orgName: newSnapshot.bundle.meta["org_name"]
          }
        });
      }

      return {
        success: true,
        snapshot: newSnapshot
      };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);

      if (this.eventHub) {
        this.eventHub.emit({
          type: "config.invalid",
          entityType: "config",
          entityId: this.activeSnapshot?.id || "none",
          audience: ["admin"],
          payload: {
            reason: errorMsg,
            lastGoodSnapshotId: this.activeSnapshot?.id ?? null,
            attemptedAt: new Date().toISOString()
          }
        });
      }

      if (!this.activeSnapshot) {
        throw new Error(`Initial config invalid and no last-good snapshot exists: ${errorMsg}`);
      }

      return {
        success: false,
        snapshot: this.activeSnapshot,
        error: errorMsg
      };
    }
  }
}
