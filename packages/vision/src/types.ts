export interface QualityCheckResult {
  passed: boolean;
  blurVariance: number;
  width: number;
  height: number;
  reasons: string[];
  rotationNeeded: 0 | 90 | 180 | 270;
}

export interface ExtractedLine {
  lineNo: number;
  itemDescription: string;
  quantity: number;
  serials: string[];
  unread: boolean;
  remarks?: string;
  sourceBox?: {
    ymin: number;
    xmin: number;
    ymax: number;
    xmax: number;
  };
}

export interface ExtractedHeader {
  documentType: "waybill" | "loadout_list" | "demob_list" | "unknown";
  documentNo?: string;
  date?: string;
  fromLocation?: string;
  toLocation?: string;
  vesselName?: string;
  issuerName?: string;
  receiverName?: string;
}

export interface ExtractionResult {
  header: ExtractedHeader;
  lines: ExtractedLine[];
  rotationNeeded: 0 | 90 | 180 | 270;
  rawJson: Record<string, unknown>;
  tokensIn: number;
  tokensOut: number;
  modelUsed: string;
  costUsdEst: number;
}
