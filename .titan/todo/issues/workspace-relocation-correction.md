# Workspace Tools Relocation Correction

The OpenBrowser workspace feature files were initially added under `tools/openbrowser-workspace/`.

They must be relocated directly into `browser-extension/`, which is the actual browser extension root containing `manifest.json`.

Required correction:

- move all workspace package, bridge, database, analysis, PowerShell, GitHub CLI, hook, test, VS Code, and documentation files into `browser-extension/`;
- remove `tools/openbrowser-workspace/`;
- update CI and documentation paths;
- verify Linux, Windows, and the existing OpenBrowser application before merging the corrective PR.
