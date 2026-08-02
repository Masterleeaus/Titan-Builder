# Titan Builder Planned Tools

This is the authoritative implementation roadmap for reusable Titan Builder tools.

Status values: `discovered`, `planned`, `in-progress`, `implemented`, `validated`, `deferred`.

| Name | Purpose | Category | Dependencies | Priority | Complexity | Implementation | Validation | Related agents | Related skills | Related workflows | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `git.status` | Read concise repository and branch state | Git | Git CLI | P0 | Low | discovered | existing tests | coding agents | repository inspection | operation preview/apply | Preserve command compatibility |
| `git.diff` | Read working-tree or staged changes | Git | Git CLI | P0 | Low | discovered | existing tests | coding/review agents | code review | operation preview/apply | Only no args or `--staged` |
| `git.log` | Read bounded commit history | Git | Git CLI | P0 | Low | discovered | existing tests | coding/review agents | repository inspection | project status | Count constrained to 1-100 |
| `git.branch.current` | Read current branch | Git | Git CLI | P0 | Low | discovered | existing tests | all repo agents | repository inspection | project status | Preserve existing ID |
| `git.root` | Resolve repository top-level directory | Git | Git CLI | P0 | Low | in-progress | planned unit tests | workspace agents | repository discovery | project registration | Read-only; no user arguments |
| `git.branch.list` | List local/all branches safely | Git | Git CLI | P0 | Low | in-progress | planned unit/failure tests | coding/review agents | branch management | project status | Bounded enum argument only |
| `git.remote.list` | Read configured remotes without credentials | Git | Git CLI | P0 | Low | in-progress | planned unit/security tests | GitHub agents | repository discovery | project status | Must not emit credential-bearing URLs |
| `git.show` | Inspect one constrained commit/ref summary | Git | Git CLI | P1 | Medium | in-progress | planned unit/failure tests | review agents | history inspection | review workflow | Strict revision grammar and `--` boundary |
| `npm.install` | Perform deterministic npm dependency install | Build | npm | P0 | Medium | discovered | existing tests | build agents | dependency management | operation approval | Network write and explicit approval |
| `npm.test` | Run repository npm tests | Testing | npm | P0 | Medium | discovered | existing tests | test agents | verification | operation approval | Arbitrary execution and explicit approval |
| `npm.run` | Run allow-listed npm verification scripts | Build | npm | P0 | Medium | discovered | existing tests | build/test agents | verification | operation approval | Script-name allow-list retained |
| `pnpm.install` | Perform frozen pnpm dependency install | Build | pnpm | P0 | Medium | discovered | existing tests | build agents | dependency management | operation approval | Ignore lifecycle scripts |
| `pnpm.test` | Run repository pnpm tests | Testing | pnpm | P0 | Medium | discovered | existing tests | test agents | verification | operation approval | Arbitrary execution and explicit approval |
| `pnpm.run` | Run allow-listed pnpm verification scripts | Build | pnpm | P0 | Medium | discovered | existing tests | build/test agents | verification | operation approval | Script-name allow-list retained |
| `node.version` | Read active Node.js version | Build | Node.js | P0 | Low | discovered | existing tests | environment agents | diagnostics | project status | Read-only |
| `vscode.open` | Open a contained project path in VS Code | Workspace | VS Code CLI | P1 | Low | discovered | existing tests | workspace agents | editor integration | operation approval | Containment validation retained |
| Tool manifest schema | Define versioned tool contract and knowledge metadata | Validation | zod | P0 | Medium | in-progress | planned unit tests | all agents | tool authoring | registry load | Foundation for installability |
| Built-in tool catalog | Register immutable definitions and resolvers | Tool Registry | manifest schema | P0 | Medium | in-progress | planned unit/integration tests | all agents | tool discovery | operation planning | Replaces duplicated switch metadata |
| Tool catalog API | Expose safe read-only tool metadata to bridge clients | Reporting | server security, registry | P1 | Medium | planned | planned server tests | browser/workspace agents | tool discovery | side-panel bridge | No executable paths or secrets |
| Tool knowledge export | Produce normalized Knowledge Engine records | Knowledge | tool registry | P1 | Low | planned | planned snapshot tests | knowledge agents | metadata capture | indexing | Database-agnostic output only |
| Workspace read tool package | Read/list/search contained workspace files | Workspace | project-path security | P1 | High | planned | not started | coding agents | workspace inspection | context assembly | Reuse context and path-security services |
| SQLite query tool package | Execute parameterized read-only knowledge queries | SQLite | future SQLite service | P1 | High | deferred | blocked | knowledge agents | knowledge retrieval | agent runtime | Do not invent a parallel DB layer |
| GitHub read tool package | Read PRs/issues/commits through an injected provider | GitHub | future GitHub runtime interface | P1 | High | deferred | blocked | GitHub agents | repo collaboration | review workflow | Never embed provider credentials |
| Browser inspection tool package | Perform bounded browser reads through bridge | Browser | browser runtime | P2 | High | planned | not started | browser agents | page inspection | browser jobs | Requires explicit origin/session model |
| Documentation tool package | Generate/update canonical docs from schemas | Documentation | documentation engine | P2 | Medium | planned | not started | documentation agents | docs generation | feature completion | Should consume registry metadata |
| External tool package loader | Load signed/allow-listed installable packages | Tool Registry | package containment, trust policy | P2 | High | deferred | not started | tool writer agents | tool installation | startup | Build only after built-in registry stabilizes |
| Tool SDK generator | Scaffold manifest/resolver/tests/docs/knowledge record | Tooling | tool registry | P2 | High | planned | not started | tool writer agents | tool authoring | feature evolution | Must generate production defaults, not prototypes |

## Roadmap order

1. Preserve and normalize the existing built-in registry.
2. Add strict manifest validation and immutable catalog registration.
3. Add the four missing Git read tools.
4. Add safe catalog and knowledge metadata exports.
5. Integrate read-only catalog discovery into the bridge and browser workspace.
6. Add contained workspace tools using existing project security and context services.
7. Add provider-backed tools only when authoritative runtime interfaces exist.
8. Add signed external package installation after trust and compatibility policies are implemented.
