export interface IntentAction {
  id: string;
  label: string;
}

export interface EngineIntent {
  intentId: string;
  type: "ack" | "needs_input" | "proposal" | "notice" | "result" | "error";
  messageKey: string;
  params?: Record<string, string>;
  fallbackText: string;
  actions?: IntentAction[];
  audience: string[];
}

export interface RenderedMessage {
  text: string;
  inlineKeyboard?: { text: string; callbackData: string }[][];
}

export interface TelegramChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
  username?: string;
  first_name?: string;
  last_name?: string;
}

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
}

export interface TelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

export interface TelegramDocument {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  caption?: string;
  photo?: TelegramPhotoSize[];
  document?: TelegramDocument;
  media_group_id?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface CallbackTokenRecord {
  token: string;
  proposalId: string;
  version: number;
  action: string;
  actor: string;
  expiresAt: number;
}

export interface RegisteredActor {
  actorId: string;
  telegramId: number;
  name?: string;
  role: string;
  assurance: "channel_verified" | "none" | "strong";
}

export interface DownloadedMedia {
  fileId: string;
  fileName?: string;
  mimeType: string;
  sentAs: "photo" | "file";
  buffer: Buffer;
  mediaGroupId?: string;
}

export interface TelegramAdapterConfig {
  port: number;
  webhookSecret: string;
  botToken: string;
  engineBaseUrl?: string;
  engineAdapterKey?: string;
  defaultTtlMs?: number;
}

export interface OutboundMessage {
  chatId: number;
  text: string;
  inlineKeyboard?: { text: string; callbackData: string }[][];
  intentId?: string;
}
