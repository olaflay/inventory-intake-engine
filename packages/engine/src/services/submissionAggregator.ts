export interface SubmissionDraftConfig {
  maxFilesPerSubmission: number;
  draftQuietSeconds: number;
}

export const DEFAULT_DRAFT_CONFIG: SubmissionDraftConfig = {
  maxFilesPerSubmission: 10,
  draftQuietSeconds: 90 // 90 seconds quiet window (PRD Appendix C)
};

export interface SubmissionAttachment {
  id: string;
  filename: string;
  sha256: string;
  mime: string;
  mediaGroupId?: string;
  addedAt: string;
}

export interface SubmissionDraft {
  id: string;
  actorRef: string;
  channelRef: string;
  state: "DRAFT" | "PROCESSING" | "CLOSED";
  textMessages: string[];
  attachments: SubmissionAttachment[];
  mediaGroupIds: Set<string>;
  createdAt: string;
  lastActivityAt: string;
  relatedToId?: string;
}

/**
 * Submission Aggregator and Quiet Window Manager (FR-INT-01, FR-TG-05, EC-11, EC-12)
 * Aggregates messages, multi-photo albums, and documents within a quiet window.
 */
export class SubmissionAggregator {
  private drafts = new Map<string, SubmissionDraft>(); // draftId -> draft
  private activeDraftByActor = new Map<string, string>(); // actorRef -> draftId
  private config: SubmissionDraftConfig;

  constructor(config: Partial<SubmissionDraftConfig> = {}) {
    this.config = { ...DEFAULT_DRAFT_CONFIG, ...config };
  }

  /**
   * Appends an item (message or attachment) to an actor's draft.
   * If an open draft exists and is within draftQuietSeconds, appends to it.
   * Otherwise closes previous draft and starts a new one.
   */
  public append(
    actorRef: string,
    channelRef: string,
    item: {
      text?: string;
      attachment?: { id: string; filename: string; sha256: string; mime: string; mediaGroupId?: string };
    },
    currentTime: Date = new Date()
  ): { draft: SubmissionDraft; isNewDraft: boolean } {
    let draftId = this.activeDraftByActor.get(actorRef);
    let draft = draftId ? this.drafts.get(draftId) : undefined;
    let isNewDraft = false;

    // Check if current draft has expired past draftQuietSeconds (EC-12)
    if (draft && draft.state === "DRAFT") {
      const elapsedSeconds = (currentTime.getTime() - new Date(draft.lastActivityAt).getTime()) / 1000;
      if (elapsedSeconds > this.config.draftQuietSeconds) {
        draft.state = "CLOSED";
        draft = undefined;
        isNewDraft = true;
      }
    }

    // If no active open draft, create a new one
    if (!draft || draft.state !== "DRAFT") {
      const newId = `sub-${currentTime.getTime()}-${Math.floor(Math.random() * 1000)}`;
      draft = {
        id: newId,
        actorRef,
        channelRef,
        state: "DRAFT",
        textMessages: [],
        attachments: [],
        mediaGroupIds: new Set<string>(),
        createdAt: currentTime.toISOString(),
        lastActivityAt: currentTime.toISOString()
      };
      this.drafts.set(newId, draft);
      this.activeDraftByActor.set(actorRef, newId);
      isNewDraft = true;
    }

    // Append text if provided
    if (item.text) {
      draft.textMessages.push(item.text);
      draft.lastActivityAt = currentTime.toISOString();
    }

    // Append attachment if provided (FR-INT-01, FR-TG-05)
    if (item.attachment) {
      if (draft.attachments.length >= this.config.maxFilesPerSubmission) {
        throw new Error(
          `Submission limit reached: maximum of ${this.config.maxFilesPerSubmission} files allowed per submission (FR-INT-01).`
        );
      }

      draft.attachments.push({
        ...item.attachment,
        addedAt: currentTime.toISOString()
      });

      if (item.attachment.mediaGroupId) {
        draft.mediaGroupIds.add(item.attachment.mediaGroupId);
      }

      draft.lastActivityAt = currentTime.toISOString();
    }

    return { draft, isNewDraft };
  }

  /**
   * Explicitly close draft (/done command or close timer)
   */
  public closeDraft(draftId: string): SubmissionDraft | undefined {
    const draft = this.drafts.get(draftId);
    if (!draft) return undefined;
    draft.state = "CLOSED";
    this.activeDraftByActor.delete(draft.actorRef);
    return draft;
  }

  public getDraft(draftId: string): SubmissionDraft | undefined {
    return this.drafts.get(draftId);
  }
}
