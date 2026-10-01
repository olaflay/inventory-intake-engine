import type { ProposalKind, ProposalQuestion } from "../types.js";

export interface IntentContext {
  documentTypes: string[];
  textHints?: {
    operation_key?: string | null;
    destination_text?: string | null;
    source_text?: string | null;
    item_refs?: string[];
  } | null;
  receiverFieldsPresent?: boolean;
}

export interface IntentResolutionResult {
  kind: ProposalKind;
  requiresQuestion: boolean;
  question?: ProposalQuestion;
}

export interface DestinationContext {
  waybillTo?: string | null;
  manifestVessel?: string | null;
  manifestLocation?: string | null;
  textDestination?: string | null;
}

export interface DestinationResolutionResult {
  resolvedDestination: string | null;
  transitContext?: string | null;
  requiresQuestion: boolean;
  question?: ProposalQuestion;
}

export class IntentResolver {
  /**
   * Implements FR-PRO-01 Intent Resolution.
   * Maps document types and text hints to ProposalKind.
   */
  static resolveIntent(ctx: IntentContext): IntentResolutionResult {
    const docTypes = new Set(ctx.documentTypes.map(d => d.toLowerCase()));
    const opHint = ctx.textHints?.operation_key?.toLowerCase();

    // 1. Explicit receipt signal
    if (ctx.receiverFieldsPresent || opHint === "receive" || opHint === "received") {
      return { kind: "receive", requiresQuestion: false };
    }

    // 2. Reversal signal
    if (opHint === "reversal" || opHint === "reverse" || opHint === "undo") {
      return { kind: "reversal", requiresQuestion: false };
    }

    const hasWaybill = docTypes.has("waybill");
    const hasManifest = docTypes.has("loadout_list") || docTypes.has("manifest") || docTypes.has("demob_list");

    // 3. Waybill + Manifest => Dispatch (J1)
    if (hasWaybill && hasManifest) {
      return { kind: "dispatch", requiresQuestion: false };
    }

    // 4. Waybill only => Dispatch Unitemized (FR-PRO-06, EC-22)
    if (hasWaybill && !hasManifest) {
      return { kind: "dispatch_unitemized", requiresQuestion: false };
    }

    // 5. Manifest only => State Assertion (FR-PRO-01, EC-23)
    if (!hasWaybill && hasManifest) {
      // If user text explicitly requested a dispatch/movement, propose dispatch
      if (opHint === "dispatch" || opHint === "move") {
        return { kind: "dispatch", requiresQuestion: false };
      }

      // Default: assertion with optional clarifying question
      return {
        kind: "assertion",
        requiresQuestion: true,
        question: {
          id: "q-intent-assertion",
          questionKey: "manifest_intent",
          type: "choice",
          prompt: "You sent a loadout list without a waybill. Is this a location audit/reconciliation, or equipment moving?",
          options: [
            { id: "1", label: "Reconcile only (audit current location)" },
            { id: "2", label: "Also a move (dispatch to vessel/site)" }
          ]
        }
      };
    }

    // 6. Fallback / unmapped document combination => question
    return {
      kind: "assertion",
      requiresQuestion: true,
      question: {
        id: "q-intent-unmapped",
        questionKey: "unmapped_intent",
        type: "choice",
        prompt: "How would you like to process these documents?",
        options: [
          { id: "1", label: "Dispatch equipment" },
          { id: "2", label: "Reconcile inventory count" }
        ]
      }
    };
  }

  /**
   * Implements FR-PRO-02 Destination Resolution.
   * Decides precedence between waybill To and manifest vessel/location.
   */
  static resolveDestination(ctx: DestinationContext): DestinationResolutionResult {
    const waybillTo = ctx.waybillTo?.trim();
    const manifestVessel = ctx.manifestVessel?.trim();
    const manifestLoc = ctx.manifestLocation?.trim();
    const textDest = ctx.textDestination?.trim();

    // If text hint explicitly sets destination and matches either, use text hint
    if (textDest && (textDest === waybillTo || textDest === manifestVessel || textDest === manifestLoc)) {
      return { resolvedDestination: textDest, requiresQuestion: false };
    }

    // Case 1: Manifest location equals waybill To, and manifest vessel is provided.
    // Default precedence: vessel is primary destination; waybill place is transit context.
    if (waybillTo && manifestLoc && waybillTo.toLowerCase() === manifestLoc.toLowerCase() && manifestVessel) {
      return {
        resolvedDestination: manifestVessel,
        transitContext: waybillTo,
        requiresQuestion: false
      };
    }

    // Case 2: Waybill To and manifest vessel exist but differ
    if (waybillTo && manifestVessel && waybillTo.toLowerCase() !== manifestVessel.toLowerCase()) {
      return {
        resolvedDestination: manifestVessel, // default candidate
        transitContext: waybillTo,
        requiresQuestion: true,
        question: {
          id: "q-dest-conflict",
          questionKey: "destination_choice",
          type: "choice",
          prompt: `Waybill specifies destination '${waybillTo}', but manifest lists '${manifestVessel}'. Where should items be recorded?`,
          options: [
            { id: "1", label: manifestVessel },
            { id: "2", label: waybillTo }
          ]
        }
      };
    }

    // Case 3: Only vessel is provided
    if (manifestVessel) {
      return { resolvedDestination: manifestVessel, requiresQuestion: false };
    }

    // Case 4: Only waybill To is provided
    if (waybillTo) {
      return { resolvedDestination: waybillTo, requiresQuestion: false };
    }

    // Case 5: Only manifest location is provided
    if (manifestLoc) {
      return { resolvedDestination: manifestLoc, requiresQuestion: false };
    }

    // Case 6: Fallback to text destination
    if (textDest) {
      return { resolvedDestination: textDest, requiresQuestion: false };
    }

    return { resolvedDestination: null, requiresQuestion: false };
  }
}
