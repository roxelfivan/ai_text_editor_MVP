# Prompt library

The prompt library stores reusable Chat instructions. Open it from the **bookmark** in the top bar, or press `Ctrl+,` / `⌘,` when you are not typing in a field.

## Built-in prompts

ApEditor includes four starters:

| Name | What it asks the AI to do |
| --- | --- |
| **Improve writing** | Rewrite the selection to be clearer and more concise |
| **Summarize** | Summarize the selection in 3–5 bullets |
| **Explain like I'm 5** | Explain the selection in simple language |
| **Continue writing** | Continue from the cursor or selection in the same voice |

You can edit or delete these, or add your own.

## Use a prompt

1. Highlight text in the editor if the prompt should apply to a passage.
2. Open the library and click **Use**.
3. The Chat input fills. Check **include selection** if you want the highlight sent as well.
4. Send from Chat as usual.

If the prompt body contains `{{selection}}`, that placeholder is replaced with the current highlight. If it does not, ApEditor can still attach the selection in a quoted block.

## Add or edit

- **Name** — short label in the list
- **Prompt body** — the instruction. You may include `{{selection}}`.
- **Add prompt** or **Save changes**
- **Cancel** while editing

An empty library shows **No prompts yet.**

## Delete

Click **Delete** and confirm **Delete prompt "{name}"?**

Prompts are stored in this browser with the rest of your ApEditor data.
