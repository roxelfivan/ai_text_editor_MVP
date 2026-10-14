# Settings

Open **Settings** from the gear in the top bar, or press `Ctrl+.` / `⌘.` when you are not typing in a field. On first launch, Settings may open by itself if the current provider needs a key.

Drag the edges of the window to resize it. **Cancel** discards unsaved edits; **Save** applies them.

## Provider

| Option | API key | Typical use |
| --- | --- | --- |
| **Minimax** | Required | Default. Streaming Chat in the panel |
| **OpenAI** | Required | Streaming Chat with OpenAI models |
| **Google AI Mode (no key)** | None | Opens Google in a new tab; you paste the answer back |

Changing provider updates the default endpoint and model list. You can still type a custom model name.

## API key

Paste the key from your provider. **Show** / **Hide** toggles visibility.

The key is stored only in this browser’s local storage. It is sent as a Bearer token to the HTTPS endpoint you set — not to an ApEditor backend. Do not leave a key on a shared computer; clear site data when you are done.

For Google AI Mode the field is unused.

## API endpoint and model

**API endpoint** is the base URL for Minimax or OpenAI. You usually keep the preset (`https://api.minimax.io/v1` or `https://api.openai.com/v1`).

**Model** offers presets you can pick or type over:

- Minimax: `MiniMax-M3`, `MiniMax-M3-fast`, `MiniMax-M2.7`, `MiniMax-M2.7-highspeed` (default `MiniMax-M2.7`)
- OpenAI: `gpt-4o-mini`, `gpt-4o`, `gpt-4-turbo`, `o1-mini`, `o1`, `gpt-3.5-turbo` (default `gpt-4o-mini`)

Google AI Mode does not use these fields for requests.

## System message

This is the standing instruction for the assistant (voice, how it should propose edits, and so on).

Edit the box, then **Save**. **Reset** restores the built-in default. Changes apply to the **next** send; existing Chat history is unchanged.

## Rationale rules

These rules shape the **rationale** on each proposed edit (what you read on the comment badge after **Apply**). The default is a long, structured style in Markdown, with numbered points and important terms **bold and underlined**.

Leave the field as the default, customize it, or **Reset**. An empty field after save uses the built-in default.

## Temperature

Default **0.7**. Lower values make replies more repeatable; higher values more varied. Drag the slider and **Save**.

## Debug Mode

When on, the editor toolbar shows inline-completion status (`thinking` / `ready · tab` / `idle`) and request/accept counters. Click the counters to reset them. Most people can leave this off.

## UI font size

Slider from 12 to 20 pixels (default 14). **Reset** returns to 14. Editor body size stays on the editor toolbar.
