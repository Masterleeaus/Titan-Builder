# Titan Builder Planned Tools

This is the authoritative implementation roadmap for reusable Titan Builder tools.

Status values: `discovered`, `planned`, `in-progress`, `implemented`, `validated`, `deferred`.

Validated foundation reference: GitHub Actions run `30733643082` (Ubuntu and Windows passed).

| Name | Purpose | Category | Dependencies | Priority | Complexity | Implementation | Validation | Related agents | Related skills | Related workflows | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `git.status` | Read concise repository and branch state | Git | Git CLI | P0 | Low | validated | Linux/Windows CI `30733643082` | coding agents | repository inspection | operation preview/apply | Existing command contract preserved |
| `git.diff` | Read working-tree or staged changes | Git | Git CLI | P0 | Low | validated | Linux/Windows CI `30733643082` | coding/review agents | code review | operation preview/apply | Only no args or `--staged` |
| `git.log` | Read bounded commit history | Git | Git CLI | P0 | Low | validated | Linux/Windows CI `30733643082` | coding/review agents | repository inspection | project status | Count constrained to 1-100 |
| `git.branch.current` | Read current branch | Git | Git CLI | P0 | Low | validated | Linux/Windows CI `30733643082` | all repo agents | repository inspection | project status | Existing ID preserved |
| `git.root` | Resolve repository top-level directory | Git | Git CLI | P0 | Low | validated | Linux/Windows CI `30733643082` | workspace agents | repository discovery | project registration | Read-only; no user arguments |
| `git.branch.list` | List local/all branches safely | Git | Git CLI | P0 | Low | validated | Linux/Windows CI `30733643082` | coding/review agents | branch management | project status | Bounded enum argument only |
| `git.remote.list` | Read configured remote names without credentials | Git | Git CLI | P0 | Low | validated | Linux/Windows CI `30733643082` | GitHub agents | repository discovery | project status | Returns names only; never URLs |
| `git.show` | Inspect one constrained commit/ref summary | Git | Git CLI | P1 | Medium | validated | Linux/Windows CI `30733643082` | review agents | history inspection | review workflow | Strict revision grammar and `--` boundary |
| `npm.install` | Perform deterministic npm dependency install | Build | npm | P0 | Medium | validated | Linux/Windows compatibility CI `30733643082` | build agents | dependency management | operation approval | Network write and explicit approval |
| `npm.test` | Run repository npm tests | Testing | npm | P0 | Medium | validated | Linux/Windows compatibility CI `30733643082` | test agents | verification | operation approval | Arbitrary execution and explicit approval |
| `npm.run` | Run allow-listed npm verification scripts | Build | npm | P0 | Medium | validated | Linux/Windows compatibility CI `30733643082` | build/test agents | verification | operation approval | Script-name allow-list retained |
| `pnpm.install` | Perform frozen pnpm dependency install | Build | pnpm | P0 | Medium | validated | Linux/Windows compatibility CI `30733643082` | build agents | dependency management | operation approval | Lifecycle scripts remain disabled |
| `pnpm.test` | Run repository pnpm tests | Testing | pnpm | P0 | Medium | validated | Linux/Windows compatibility CI `30733643082` | test agents | verification | operation approval | Arbitrary execution and explicit approval |
| `pnpm.run` | Run allow-listed pnpm verification scripts | Build | pnpm | P0 | Medium | validated | Linux/Windows compatibility CI `30733643082` | build/test agents | verification | operation approval | Script-name allow-list retained |
| `node.version` | Read active Node.js version | Build | Node.js | P0 | Low | validated | Linux/Windows compatibility CI `30733643082` | environment agents | diagnostics | project status | Read-only |
| `vscode.open` | Open a contained project path in VS Code | Workspace | VS Code CLI | P1 | Low | validated | Linux/Windows compatibility CI `30733643082` | workspace agents | editor integration | operation approval | Containment validation retained |
| Tool manifest schema | Define the versioned tool contract and knowledge metadata | Validation | zod | P0 | Medium | validated | Manifest/unit/typecheck CI `30733643082` | all agents | tool authoring | registry load | Strict schema, canonical identity, deeply immutable output |
| Built-in tool catalog | Register immutable definitions and trusted resolvers | Tool Registry | manifest schema | P0 | Medium | validated | Catalog/invocation CI `30733643082` | all agents | tool discovery | operation planning | Runtime revalidation and resolver-output enforcement |
| Tool catalog API | Expose safe read-only tool metadata to bridge clients | Reporting | server security, registry | P1 | Medium | validated | Auth/security integration CI `30733643082` | browser/workspace agents | tool discovery | side-panel bridge | Shared authenticated scope; no execution bypass |
| Tool knowledge export | Produce normalized Knowledge Engine records | Knowledge | tool registry | P1 | Low | validated | Knowledge/unit CI `30733643082` | knowledge agents | metadata capture | indexing | Database-agnostic and deeply immutable |
| Workspace read tool package | Read/list/search contained workspace files | Workspace | project-path security | P1 | High | planned | not started | coding agents | workspace inspection | context assembly | Reuse context and path-security services |
| SQLite query tool package | Execute parameterized read-only knowledge queries | SQLite | future SQLite service | P1 | High | deferred | blocked | knowledge agents | knowledge retrieval | agent runtime | Do not invent a parallel database layer |
| GitHub read tool package | Read PRs/issues/commits through an injected provider | GitHub | future GitHub runtime interface | P1 | High | deferred | blocked | GitHub agents | repo collaboration | review workflow | Never embed provider credentials |
| Browser inspection tool package | Perform bounded browser reads through the bridge | Browser | browser runtime | P2 | High | planned | not started | browser agents | page inspection | browser jobs | Requires explicit origin/session model |
| Documentation tool package | Generate/update canonical docs from schemas | Documentation | documentation engine | P2 | Medium | planned | not started | documentation agents | docs generation | feature completion | Should consume registry metadata |
| External tool package loader | Load signed/allow-listed installable packages | Tool Registry | package containment, trust policy | P2 | High | deferred | not started | tool writer agents | tool installation | startup | Build only after trust, compatibility, and isolation policies exist |
| Tool SDK generator | Scaffold manifest/resolver/tests/docs/knowledge record | Tooling | tool registry | P2 | High | planned | not started | tool writer agents | tool authoring | feature evolution | Must generate production defaults, not prototypes |

## Roadmap order

1. Preserve and normalize the existing built-in registry. **Completed and validated.**
2. Add strict manifest validation and immutable catalog registration. **Completed and validated.**
3. Add the four missing Git read tools. **Completed and validated.**
4. Add safe catalog and knowledge metadata exports. **Completed and validated.**
5. Integrate read-only catalog discovery into the bridge and browser workspace. **Completed and validated.**
6. Add contained workspace tools using existing project security and context services.
7. Add provider-backed tools only when authoritative runtime interfaces exist.
8. Add signed external package installation after trust and compatibility policies are implemented.
