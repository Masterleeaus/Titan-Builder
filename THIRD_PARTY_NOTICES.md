# Third-Party Design References

OpenBrowser v0.3.0 includes original implementation work informed by the following open-source projects:

## Ember Browser Agent

- Project: `ember-browser`
- Author: Wayne Renbjor
- Licence: MIT
- Referenced concept: lightweight Manifest V3 side-panel structure.

## prompts.chat Extension

- Project: `prompts-chat-extension`
- Author: Fatih Solhan
- Licence: MIT, as stated in the project's README.
- Referenced concepts: searchable prompt cards, prompt template variables, provider-oriented prompt launching, and side-panel prompt browsing.

The v0.3.0 OpenBrowser implementation was adapted to its existing vanilla JavaScript architecture and security model. React, WXT, remote prompt APIs, analytics, broad host access, and unrelated product features were not imported.

## Evaluated but not incorporated

- AI Side Panel Extension: not incorporated because its licence and security-header modification approach were unsuitable for this product.
- ChromeCode: not incorporated because its `<all_urls>` and Chrome Debugger control model exceeded the permissions required for this focused coding panel.
