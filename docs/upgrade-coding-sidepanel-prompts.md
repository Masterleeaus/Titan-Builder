# OpenBrowser v0.3.0 — Coding Side Panel and Prompt Library

## Purpose

This pass adds a focused coding side panel to OpenBrowser. It is designed to complement productivity extensions such as Superpower for ChatGPT without recreating chat folders, prompt queues, notes, or general ChatGPT workspace features.

## Added capabilities

- Native Chrome side panel opened from the OpenBrowser popup.
- Searchable built-in coding prompt library.
- Categories for audit, debugging, implementation, review, testing, security, architecture, extension work, Git, documentation, and performance.
- `${variable:default}` template variables with editable values and live preview.
- One-click **Insert only** and **Insert & send** actions.
- Provider targeting for ChatGPT, Claude, Gemini, DeepSeek, Perplexity, GLM, and Grok.
- Custom prompt create, edit, delete, import, and export.
- Local bridge, Git project, and open-provider status views.
- Superpower compatibility remains enabled through the existing native-composer filtering.

## Security boundaries

The side panel does not introduce:

- `<all_urls>` host access
- Chrome Debugger permission
- remote prompt APIs
- API key storage
- security-header removal
- arbitrary JavaScript execution in webpages
- arbitrary shell commands

Prompts are delivered only to AI hosts already approved in the OpenBrowser manifest. Custom prompts are stored in `chrome.storage.local` and exported only when the user explicitly clicks Export.

## Usage

1. Reload the unpacked OpenBrowser extension after upgrading.
2. Open the OpenBrowser toolbar popup.
3. Click **Open Coding Side Panel**.
4. Select a provider or leave routing on **Auto**.
5. Choose a coding prompt, fill any variables, and select **Insert only** or **Insert & send**.
6. Create reusable project-specific prompts in the **Custom** tab.
7. Start `openbrowser server` inside a project to populate the Git project status card.

## Donor evaluation

The implementation uses a lightweight native side-panel approach inspired by Ember Browser and prompt-library interaction concepts inspired by prompts.chat. It does not import ChromeCode's debugger-based control plane or AI Side Panel's network-header modification behaviour.
