import test from "node:test";
import assert from "node:assert/strict";
import { renderIntent } from "../../adapters/telegram/dist/index.js";

test("Telegram Renderer (FR-TG-07, EC-06): formats intent into text with numbered fallbacks", () => {
  const intent = {
    intentId: "int-dest-1",
    type: "needs_input",
    messageKey: "ask_destination",
    fallbackText: "Where should these items be recorded?",
    actions: [
      { id: "1", label: "Warami 10 (vessel), via FOT Jetty" },
      { id: "2", label: "FOT Jetty, Onne" },
      { id: "3", label: "Cancel" }
    ],
    audience: ["telegram:123"]
  };

  const rendered = renderIntent(intent);

  // Check buttons
  assert.equal(rendered.inlineKeyboard.length, 1);
  assert.equal(rendered.inlineKeyboard[0].length, 3);
  assert.equal(rendered.inlineKeyboard[0][0].text, "1. Warami 10 (vessel), via FOT Jetty");

  // Check numbered fallback text in message body
  assert.match(rendered.text, /Where should these items be recorded\?/);
  assert.match(rendered.text, /1\. Warami 10 \(vessel\), via FOT Jetty/);
  assert.match(rendered.text, /2\. FOT Jetty, Onne/);
  assert.match(rendered.text, /3\. Cancel/);
  assert.match(rendered.text, /\(Tap a button or reply with a number\)/);
});
