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
