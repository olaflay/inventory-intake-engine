import { randomUUID } from "node:crypto";
import {
  type UUID,
  type Proposal,
  type ProposalHeader,
  type ProposalLine,
  type ProposalQuestion,
  type MatchingConfig,
  type ApprovalRule,
  matchLine,
  runValidationPipeline,
  IntentResolver,
  ManifestReconciler,
  determineApprovalTier
} from "@inventory/domain";
import { LocationService } from "./locationService.js";

export interface ExtractedInputDocument {
  documentType: string;
  documentNo?: string;
  fromLocation?: string;
  toLocation?: string;
  vesselName?: string;
  lines: {
    lineNo: number;
    description: string;
    serials: string[];
    quantity: number;
    unread?: boolean;
    remarks?: string;
  }[];
  textHints?: {
    operation_key?: string | null;
    destination_text?: string | null;
    source_text?: string | null;
    item_refs?: string[];
  } | null;
  receiverFieldsPresent?: boolean;
}

export interface ProposalAssemblyContext {
  submissionId: UUID;
  actorRole: string;
  actorRef: string;
  documents: ExtractedInputDocument[];
  assets: {
    id: UUID;
    internalRef: string;
    serials: string[];
    description: string;
    locationId: UUID | null;
    statusCode: string;
  }[];
  locationService: LocationService;
  matchingConfig: MatchingConfig;
  approvalRules: ApprovalRule[];
  terminalStatuses?: string[];
  configSnapshotId?: string;
}

export class ProposalService {
  /**
   * Implements FR-PRO-03 Proposal Assembly.
   * Runs intent resolution, location resolution, line matching, validation pipeline,
   * manifest reconciliation, surplus quantity placeholders, and approval tier derivation.
   */
  static assembleProposal(ctx: ProposalAssemblyContext): Proposal {
    const questions: ProposalQuestion[] = [];
    const proposalLines: ProposalLine[] = [];
    const submissionSerialsSeen = new Set<string>();

    // 1. Intent Resolution (FR-PRO-01)
    const docTypes = ctx.documents.map(d => d.documentType);
    const combinedHints = ctx.documents.find(d => d.textHints)?.textHints || null;
    const hasReceiver = ctx.documents.some(d => d.receiverFieldsPresent);

    const intentResult = IntentResolver.resolveIntent({
      documentTypes: docTypes,
      textHints: combinedHints,
      receiverFieldsPresent: hasReceiver
    });

    if (intentResult.requiresQuestion && intentResult.question) {
      questions.push(intentResult.question);
    }

    // 2. Destination and Source Resolution (FR-PRO-02, FR-PRO-05)
    const waybillDoc = ctx.documents.find(d => d.documentType.toLowerCase().includes("waybill"));
    const manifestDoc = ctx.documents.find(d => !d.documentType.toLowerCase().includes("waybill"));

    const destContext = {
      waybillTo: waybillDoc?.toLocation,
      manifestVessel: manifestDoc?.vesselName || manifestDoc?.toLocation,
      manifestLocation: manifestDoc?.toLocation,
      textDestination: combinedHints?.destination_text
    };

    const destResolution = IntentResolver.resolveDestination(destContext);
    if (destResolution.requiresQuestion && destResolution.question) {
      questions.push(destResolution.question);
    }

    // Resolve Location Entities via LocationService
    const rawDestText = destResolution.resolvedDestination || "";
    let destinationLocationId: UUID | null = null;

    if (rawDestText) {
      const destRes = ctx.locationService.resolveLocation(rawDestText);
      if (destRes.state === "resolved" && destRes.location) {
        destinationLocationId = destRes.location.id;
      } else if (destRes.state === "ambiguous") {
        questions.push({
          id: `q-dest-ambiguous-${randomUUID().slice(0, 8)}`,
          questionKey: "ambiguous_destination",
          type: "choice",
          prompt: `Multiple locations match '${rawDestText}'. Please specify:`,
          options: destRes.candidates?.map(c => ({ id: c.id, label: c.name })) || []
        });
      } else {
        // FR-PRO-05, EC-33: Unknown location becomes provisional candidate
        questions.push({
          id: `q-dest-provisional-${randomUUID().slice(0, 8)}`,
          questionKey: "provisional_location",
          type: "choice",
          prompt: `Location '${rawDestText}' is not recorded. Choose an action:`,
          options: [
            { id: "1", label: `Create new location '${rawDestText}'` },
            { id: "2", label: "Select existing location" },
            { id: "3", label: "Reject" }
          ]
        });
      }
    }

    const rawSourceText = waybillDoc?.fromLocation || combinedHints?.source_text || "";
    let sourceLocationId: UUID | null = null;
    if (rawSourceText) {
      const srcRes = ctx.locationService.resolveLocation(rawSourceText);
      if (srcRes.state === "resolved" && srcRes.location) {
        sourceLocationId = srcRes.location.id;
      }
    }

    // 3. FR-PRO-06: Dispatch Without Itemization (EC-22)
    if (intentResult.kind === "dispatch_unitemized") {
      const header: ProposalHeader = {
        proposalId: randomUUID(),
        submissionId: ctx.submissionId,
        kind: "dispatch_unitemized",
        sourceLocationId,
        sourceLocationText: rawSourceText || null,
        destinationLocationId,
        destinationLocationText: rawDestText || null,
        documentReferences: ctx.documents.map(d => d.documentNo).filter((n): n is string => Boolean(n)),
        waybillNo: waybillDoc?.documentNo,
        notes: "Open dispatch awaiting itemization (manifest attachment)"
      };

      return {
        id: randomUUID(),
        submissionId: ctx.submissionId,
        version: 1,
        state: "READY",
        header,
        lines: [],
        questions,
        tier: 1,
        configSnapshotId: ctx.configSnapshotId,
        createdAt: new Date().toISOString()
      };
    }

    // 4. Line Matching & Validation (FR-MAT-01..04, FR-VAL-01, EC-36)
    const allInputLines = ctx.documents.flatMap(d => d.lines);
    const reconcileInputLines: any[] = [];

    for (const inLine of allInputLines) {
      const primarySerial = inLine.serials[0] || "";
      const matchRes = matchLine(
        primarySerial,
        inLine.description,
        ctx.assets,
        ctx.matchingConfig,
        destinationLocationId || undefined
      );

      const matchedAsset = matchRes.assetId
        ? ctx.assets.find(a => a.id === matchRes.assetId) || null
        : null;

      // Run FR-VAL-01 Validation Pipeline
      const valResult = runValidationPipeline(
        {
          lineNo: inLine.lineNo,
          extractedDescription: inLine.description,
          extractedSerials: inLine.serials,
          quantity: inLine.quantity,
          unread: inLine.unread || false,
          remarks: inLine.remarks,
          matchedAsset,
          matchState: matchRes.state,
          existingFlags: matchRes.flags
        },
        {
          sourceLocationId,
          destinationLocationId,
          submissionSerialsSeen,
          config: {
            terminalStatuses: ctx.terminalStatuses,
            unrecordedLocationId: ctx.locationService.getAllLocations().find(l => l.unrecorded)?.id
          }
        }
      );

      const combinedFlags = Array.from(new Set([...matchRes.flags, ...valResult.flags]));

      // Determine Line Action
      let lineAction: "move" | "verify" | "placeholder" | "create_unknown" | "skip" = "move";
      if (intentResult.kind === "assertion") {
        lineAction = "verify";
      }

      // Record line for state assertion reconciler
      reconcileInputLines.push({
        lineNo: inLine.lineNo,
        matchResult: { ...matchRes, flags: combinedFlags },
        matchedAsset
      });

      // Add main identified line
      proposalLines.push({
        lineNo: inLine.lineNo,
        extractedDescription: inLine.description,
        extractedSerials: inLine.serials,
        quantity: 1,
        matchState: matchRes.state,
        assetId: matchRes.assetId,
        candidates: matchRes.candidates,
        flags: combinedFlags,
        action: lineAction,
        targetLocationId: destinationLocationId,
        remarks: inLine.remarks
      });

      // FR-MAT-03, EC-36: Quantity surplus placeholders (e.g. qty 3 with 1 serial)
      if (inLine.quantity > 1 && inLine.serials.length < inLine.quantity) {
        const surplusCount = inLine.quantity - Math.max(1, inLine.serials.length);
        for (let p = 1; p <= surplusCount; p++) {
          proposalLines.push({
            lineNo: inLine.lineNo,
            extractedDescription: `${inLine.description} (Surplus unit ${p})`,
            extractedSerials: [],
            quantity: 1,
            matchState: "unknown",
            assetId: null,
            candidates: [],
            flags: ["unidentified_placeholder"],
            action: "placeholder",
            isPlaceholder: true,
            targetLocationId: destinationLocationId
          });
        }

        questions.push({
          id: `q-placeholder-${inLine.lineNo}`,
          questionKey: "surplus_placeholder",
          type: "choice",
          prompt: `Line ${inLine.lineNo} has quantity ${inLine.quantity} but only ${inLine.serials.length || 0} serial(s) recorded. How should the surplus ${surplusCount} unit(s) be handled?`,
          options: [
            { id: "1", label: "Accept as placeholders for review (Tier 2)" },
            { id: "2", label: "Provide serial numbers" },
            { id: "3", label: "Drop surplus units" }
          ]
        });
      }
    }

    // 5. FR-PRO-04: State Assertion Reconciliation (EC-40)
    let missingFromList: { assetId: UUID; description: string; serials: string[] }[] | undefined;
    if (intentResult.kind === "assertion" && destinationLocationId) {
      const recon = ManifestReconciler.reconcile(
        reconcileInputLines,
        destinationLocationId,
        ctx.assets
      );

      // Re-tag conflicting lines
      for (const conf of recon.conflictingLines) {
        const pLine = proposalLines.find(p => p.lineNo === conf.lineNo);
        if (pLine) {
          pLine.action = "move";
          if (!pLine.flags.includes("location_conflict")) {
            pLine.flags.push("location_conflict");
          }
        }
      }

      // EC-40: Add informational missing items from location
      missingFromList = recon.missingFromList;
    }

    // 6. Policy Evaluation (FR-APR-01)
    const allFlags = proposalLines.flatMap(l => l.flags);
    const lineStates = proposalLines.map(l => l.matchState);
    const isTerminalStatus = allFlags.includes("terminal_status");
    const isCreateAsset = lineStates.includes("new_asset_candidate");

    const derivedTier = determineApprovalTier(ctx.approvalRules, {
      submitterRole: ctx.actorRole,
      submitterRef: ctx.actorRef,
      lineCount: proposalLines.length,
      flags: allFlags,
      lineStates,
      statusChanges: [],
      isTerminalStatus,
      isCreateAsset
    });

    const header: ProposalHeader = {
      proposalId: randomUUID(),
      submissionId: ctx.submissionId,
      kind: intentResult.kind,
      sourceLocationId,
      sourceLocationText: rawSourceText || null,
      destinationLocationId,
      destinationLocationText: rawDestText || null,
      documentReferences: ctx.documents.map(d => d.documentNo).filter((n): n is string => Boolean(n)),
      waybillNo: waybillDoc?.documentNo,
      manifestNo: manifestDoc?.documentNo
    };

    return {
      id: randomUUID(),
      submissionId: ctx.submissionId,
      version: 1,
      state: "READY",
      header,
      lines: proposalLines,
      missingFromList,
      questions,
      tier: derivedTier,
      configSnapshotId: ctx.configSnapshotId,
      createdAt: new Date().toISOString()
    };
  }
}
