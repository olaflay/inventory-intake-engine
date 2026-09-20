import type { EngineIntent, RenderedMessage } from "./types.js";

/**
 * Renders channel-neutral Engine intents into user-friendly Telegram messages.
 * Mandates numbered fallbacks for every inline button (FR-TG-07, EC-06).
 */
export function renderIntent(intent: EngineIntent): RenderedMessage {
  let body = intent.fallbackText;

  if (!intent.actions || intent.actions.length === 0) {
    return { text: body };
  }

  // Build inline keyboard rows and numbered text fallbacks
  const keyboardRow: { text: string; callbackData: string }[] = [];
  const fallbacks: string[] = [];

  intent.actions.forEach((act, idx) => {
    const num = idx + 1;
    keyboardRow.push({
      text: `${num}. ${act.label}`,
      callbackData: JSON.stringify({ actId: act.id, intentId: intent.intentId })
    });
    fallbacks.push(`${num}. ${act.label}`);
  });

  const fullText = `${body}\n\n${fallbacks.join("\n")}\n\n(Tap a button or reply with a number)`;

  return {
    text: fullText,
    inlineKeyboard: [keyboardRow]
  };
}
