# Browser Extension Architecture

This document explains the structure and loading strategy for files in the `browser-extension/src/` directory.

## Manifest Entry Points (12 files)

These files are static entry points loaded directly by the manifest:

### Content Scripts
- `content-script.js` - Main content script that runs in web pages
- `chat-prompt-bootstrap.js` - Bootstraps chat prompt handling  
- `chat-prompt-envelope.js` - Wraps chat prompt messages
- `chat-prompt-routing.js` - Routes chat prompts to appropriate handlers

### Background/Service Workers
- `background.js` - Main service worker
- `attachment-verification.js` - Verifies file attachments

### Popup & UI
- `prompt-router.js` - Routes prompts in UI
- `prompt-catalog.js` - Displays available prompts
- `providers.js` - Provider selection logic
- `chatgpt-page-tools.js` - Tools for ChatGPT pages
- `coding-prompts.js` - Coding-related prompts

## Utility Modules (12 files)

These files are dynamically imported/used by the manifest entry points and should NOT be added to the manifest. They provide shared functionality:

- `agent-workspace.js` - Workspace agent utilities
- `auto-continue-policy.js` - Auto-continue behavior configuration
- `bridge-config.js` - Bridge configuration utilities
- `browser-run-events.js` - Browser run event handling
- `file-exporter.js` - File export functionality
- `job-payload.js` - Job payload utilities
- `popup.js` - Popup UI utilities (used by content script)
- `project-intelligence.js` - Project detection and analysis
- `prompt-library.js` - Prompt library utilities
- `sidepanel.js` - Side panel UI (injected dynamically)
- `skill-registry.js` - Skill registry and management
- `workspace-library.js` - Workspace library utilities

## Loading Strategy

The extension uses a **hybrid loading model**:

1. **Static loading via manifest**: Entry point files are loaded synchronously when the extension initializes
2. **Dynamic loading**: Utility modules are imported dynamically by entry points as needed
3. **Runtime injection**: Some modules like `sidepanel.js` are injected into pages at runtime

This approach minimizes initial bundle size while maintaining functionality.

## Build Process

The build step processes TypeScript files in `src/` and outputs JavaScript to the same directory. All `.js` files in `src/` are included in the package, but only those referenced in `manifest.json` are loaded statically.

## Adding New Files

When adding new files:
- **Entry points**: Add to `manifest.json` content_scripts or background sections
- **Utilities**: Leave out of manifest; they'll be imported by entry points as needed
