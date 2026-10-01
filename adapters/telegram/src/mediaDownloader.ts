import type { DownloadedMedia, TelegramDocument, TelegramPhotoSize } from "./types.js";

export type FileDownloadFetcher = (fileUrl: string) => Promise<Buffer>;

/**
 * Downloads media immediately via Telegram Bot API and prepares raw buffers for engine ingestion (FR-TG-04, FR-TG-05).
 * The engine never sees Telegram URLs.
 */
export class MediaDownloader {
  private botToken: string;
  private customFetcher?: FileDownloadFetcher;

  constructor(botToken: string, customFetcher?: FileDownloadFetcher) {
    this.botToken = botToken;
    this.customFetcher = customFetcher;
  }

  /**
   * Downloads a photo (selecting highest available resolution) and tags `sent_as: 'photo'`.
   */
  public async downloadPhoto(
    photos: TelegramPhotoSize[],
    mediaGroupId?: string
  ): Promise<DownloadedMedia> {
    if (!photos || photos.length === 0) {
      throw new Error("No photo sizes provided");
    }

    // Largest photo is last in the array according to Telegram Bot API
    const largest = photos[photos.length - 1];
    const buffer = await this.fetchFileBytes(largest.file_id);

    return {
      fileId: largest.file_id,
      sentAs: "photo",
      mimeType: "image/jpeg",
      buffer,
      mediaGroupId
    };
  }

  /**
   * Downloads a document file and tags `sent_as: 'file'`.
   */
  public async downloadDocument(
    doc: TelegramDocument,
    mediaGroupId?: string
  ): Promise<DownloadedMedia> {
    const buffer = await this.fetchFileBytes(doc.file_id);

    return {
      fileId: doc.file_id,
      fileName: doc.file_name,
      sentAs: "file",
      mimeType: doc.mime_type || "application/octet-stream",
      buffer,
      mediaGroupId
    };
  }

  /**
   * Coaching message for users who send hard documents as photos (FR-TG-04).
   */
  public getCoachingTip(sentAs: "photo" | "file"): string | null {
    if (sentAs === "photo") {
      return "Tip: For documents and waybills, sending as a file (uncompressed) avoids image compression and improves reading accuracy.";
    }
    return null;
  }

  private async fetchFileBytes(fileId: string): Promise<Buffer> {
    if (this.customFetcher) {
      return this.customFetcher(fileId);
    }

    // Default fetch using Telegram Bot API
    const getFileUrl = `https://api.telegram.org/bot${this.botToken}/getFile?file_id=${fileId}`;
    const res = await fetch(getFileUrl);
    if (!res.ok) {
      throw new Error(`Telegram getFile failed with status ${res.status}`);
    }
    const data = await res.json() as { ok: boolean; result?: { file_path: string } };
    if (!data.ok || !data.result?.file_path) {
      throw new Error(`Failed to resolve file_path for file_id ${fileId}`);
    }

    const fileDownloadUrl = `https://api.telegram.org/file/bot${this.botToken}/${data.result.file_path}`;
    const fileRes = await fetch(fileDownloadUrl);
    if (!fileRes.ok) {
      throw new Error(`Failed to download file bytes from Telegram: ${fileRes.status}`);
    }
    const arrayBuffer = await fileRes.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
}
