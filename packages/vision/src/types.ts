export interface QualityCheckResult {
  passed: boolean;
  blurVariance: number;
  width: number;
  height: number;
  reasons: string[];
  rotationNeeded: 0 | 90 | 180 | 270;
}

export interface Evidenced<T> {
  value: T | null;
  evidence_text: string | null;
  legible: boolean;
}

export interface TextHints {
  operation_key: string | null;
  destination_text: string | null;
  source_text: string | null;
  item_refs: string[];
}

export interface ExtractedLine {
  line_no?: number | null;
  lineNo?: number;
  page?: number;
  description?: Evidenced<string>;
  itemDescription?: string;
  asset_no?: Evidenced<string>;
  serials: Evidenced<string>[] | string[];
  qty?: Evidenced<number>;
  quantity?: number;
  status_text?: Evidenced<string>;
  remark?: Evidenced<string>;
  remarks?: string;
  unread: boolean;
  sourceBox?: {
    ymin: number;
    xmin: number;
    ymax: number;
    xmax: number;
  };
}

export interface ExtractedHeader {
  documentType: "waybill" | "loadout_list" | "demob_list" | "unknown" | string;
  documentNo?: string;
  date?: string;
  fromLocation?: string;
  toLocation?: string;
  vesselName?: string;
  issuerName?: string;
  receiverName?: string;
  fields?: Record<string, Evidenced<string>>;
}

export interface ExtractionResult {
  schema_version?: string;
  doc_type_key?: string;
  header: ExtractedHeader;
  lines: ExtractedLine[];
  rotation_needed?: 0 | 90 | 180 | 270;
  rotationNeeded?: 0 | 90 | 180 | 270;
  text_hints?: TextHints | null;
  warnings?: string[];
  injection_suspected?: boolean;
  rawJson?: Record<string, unknown>;
  tokensIn?: number;
  tokensOut?: number;
  modelUsed?: string;
  costUsdEst: number;
  latencyMs?: number;
}

export interface IVisionProvider {
  readonly providerId: string;
  readonly modelId: string;
  extractDocument(
    imageBuffer: Buffer,
    mimeType: string,
    promptText: string
  ): Promise<ExtractionResult>;
}

export interface IReasoningProvider {
  readonly providerId: string;
  readonly modelId: string;
  repairJson(
    malformedJsonText: string,
    schemaDescription: string
  ): Promise<Record<string, unknown>>;
}
