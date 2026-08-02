export const BUILTIN_CODING_PROMPTS = Object.freeze([
  {
    id: 'deep-extension-audit',
    title: 'Deep Extension Audit',
    description: 'Trace the full browser-extension runtime and classify evidence-based defects.',
    category: 'Audit',
    tags: ['security', 'manifest-v3', 'runtime'],
    routingIntents: ['deep audit browser extension', 'scan extension runtime for defects', 'audit extension architecture and security'],
    negativeRoutingIntents: ['operate live business', 'create customer job'],
    workModes: ['ask', 'agent'],
    routingRisk: 'standard',
    content: `Perform an evidence-based deep audit of this browser extension.

Scope: ${'${scope:the full extension runtime}'}
Priority: ${'${priority:extension-breaking defects, security, and data loss}'}

Trace manifest loading, service-worker startup, content scripts, injected scripts, storage, messaging, permissions, provider adapters, and tests. Separate confirmed defects from probable defects, risks, dead code candidates, and test gaps. Cite exact files and functions. Do not propose a rewrite unless the current architecture cannot be repaired. End with a phased repair plan and the smallest safe first patch.`,
  },
  {
    id: 'systematic-debug',
    title: 'Systematic Bug Debugger',
    description: 'Reproduce a bug, identify the root cause, and define a minimal tested fix.',
    category: 'Debugging',
    tags: ['root-cause', 'tests', 'regression'],
    routingIntents: ['debug failing code', 'find root cause', 'investigate a reproducible bug', 'fix regression systematically'],
    negativeRoutingIntents: ['general architecture audit', 'operate live business'],
    workModes: ['ask', 'agent'],
    routingRisk: 'standard',
    content: `Debug this problem systematically:

Observed behaviour: ${'${behaviour}'}
Expected behaviour: ${'${expected}'}
Relevant area: ${'${area:unknown — inspect before assuming}'}

First identify the reproduction path and evidence. Trace the complete call and state flow before editing. Distinguish root cause from symptoms. Propose the smallest coherent fix, the regression tests required, and any compatibility risks. Do not claim success without real test or build output.`,
  },
  {
    id: 'implement-feature-tdd',
    title: 'Implement Feature with TDD',
    description: 'Turn one focused requirement into a test-first implementation plan.',
    category: 'Implementation',
    tags: ['tdd', 'feature', 'minimal'],
    routingIntents: ['implement feature with tests', 'build focused feature using tdd', 'add functionality test first'],
    negativeRoutingIntents: ['audit only', 'documentation only', 'operate live business'],
    workModes: ['agent'],
    routingRisk: 'elevated',
    content: `Implement this focused feature using test-driven development:

Feature: ${'${feature}'}
Primary user outcome: ${'${outcome}'}
Constraints: ${'${constraints:preserve the existing architecture and avoid unrelated refactors}'}

Inspect the current implementation first. Define the smallest public interface. Write a failing behavioural test, verify the failure, implement only enough code to pass, then refactor while keeping tests green. Run the smallest relevant test set followed by the applicable build. Report files changed and exact verification evidence.`,
  },
  {
    id: 'review-diff',
    title: 'Review Current Diff',
    description: 'Review a change for defects, security, regressions, and missing tests.',
    category: 'Review',
    tags: ['diff', 'security', 'quality'],
    routingIntents: ['review current diff', 'review code changes', 'find defects in this change set', 'perform pull request review'],
    negativeRoutingIntents: ['implement new feature', 'operate live business'],
    workModes: ['ask', 'agent'],
    routingRisk: 'standard',
    content: `Review the current change set as a strict senior engineer.

Focus: ${'${focus:correctness, security, architecture, compatibility, and tests}'}

Inspect the actual diff and surrounding code. Prioritise actionable defects over style preferences. For every finding include severity, file, evidence, impact, and a concrete repair. Check for incomplete wiring, unsafe permissions, missing cleanup, race conditions, error handling, test gaps, and documentation drift. State clearly when no issue is found.`,
  },
  {
    id: 'repair-tests',
    title: 'Repair Failing Tests',
    description: 'Use failing test output to locate the real defect instead of weakening tests.',
    category: 'Testing',
    tags: ['vitest', 'playwright', 'ci'],
    routingIntents: ['repair failing tests', 'fix ci test failure', 'diagnose broken test suite', 'make tests pass without weakening assertions'],
    negativeRoutingIntents: ['write new feature from scratch', 'operate live business'],
    workModes: ['agent'],
    routingRisk: 'elevated',
    content: `Repair the failing tests without weakening valid assertions.

Failing command: ${'${command}'}
Failure output: ${'${failure}'}

Classify each failure as product defect, test defect, environment issue, or flaky timing. Trace the production path first. Fix the root cause, add or refine regression coverage, and rerun the focused test before broader verification. Do not delete tests merely to obtain a green build.`,
  },
  {
    id: 'security-boundary-review',
    title: 'Browser Security Boundary Review',
    description: 'Audit extension permissions, messaging, content injection, and local bridges.',
    category: 'Security',
    tags: ['cors', 'csp', 'messaging', 'localhost'],
    routingIntents: ['audit browser extension security', 'review local bridge trust boundaries', 'check permissions cors csp and messaging', 'find path traversal or command injection'],
    negativeRoutingIntents: ['general performance audit', 'operate live business'],
    workModes: ['ask', 'agent'],
    routingRisk: 'standard',
    content: `Perform a security review of the extension and local bridge.

Threat model: untrusted webpages, model output, imported files, malicious prompts, and local network peers.

Check permissions, host access, message sender validation, origin validation, CORS, CSP, web-accessible resources, token handling, path traversal, command injection, arbitrary execution, secret leakage, archive handling, and destructive operations. Identify practical exploit paths and recommend least-privilege fixes with tests. Never recommend disabling CSP or allowing wildcard origins for convenience.`,
  },
  {
    id: 'architecture-simplify',
    title: 'Simplify Architecture',
    description: 'Consolidate duplicate systems while preserving reachable behaviour.',
    category: 'Architecture',
    tags: ['refactor', 'duplication', 'boundaries'],
    routingIntents: ['simplify architecture', 'consolidate duplicate systems', 'remove architectural duplication safely', 'clarify subsystem ownership'],
    negativeRoutingIntents: ['fix one isolated bug', 'operate live business'],
    workModes: ['ask', 'agent'],
    routingRisk: 'elevated',
    content: `Review this subsystem for unnecessary complexity and duplicated responsibility.

Subsystem: ${'${subsystem}'}
Goal: ${'${goal:one clear runtime path with stable interfaces}'}

Map current entry points, ownership, state, events, and consumers. Prove which implementations are active before removing anything. Propose a staged simplification that keeps behaviour working after each step. Define interfaces, migration risks, and tests. Avoid broad unrelated refactoring.`,
  },
  {
    id: 'manifest-v3-lifecycle',
    title: 'Manifest V3 Lifecycle Check',
    description: 'Inspect service-worker suspension, reconnection, alarms, and state recovery.',
    category: 'Extension',
    tags: ['chrome', 'service-worker', 'lifecycle'],
    routingIntents: ['audit manifest v3 lifecycle', 'debug service worker suspension', 'review extension restart and state recovery', 'check alarms reconnect and duplicate listeners'],
    negativeRoutingIntents: ['general provider adapter repair', 'operate live business'],
    workModes: ['ask', 'agent'],
    routingRisk: 'standard',
    content: `Audit this Manifest V3 extension for service-worker lifecycle defects.

Trace startup, installation, browser restart, worker suspension, alarms, event listener registration, storage recovery, long-lived connections, retries, duplicate listeners, and cleanup. Identify state that incorrectly lives only in memory. Recommend event-driven repairs and focused lifecycle tests. Preserve Firefox compatibility where applicable.`,
  },
  {
    id: 'provider-adapter-update',
    title: 'Repair AI Provider Adapter',
    description: 'Isolate and harden selectors and streaming detection for one AI platform.',
    category: 'Extension',
    tags: ['chatgpt', 'claude', 'deepseek', 'selectors'],
    routingIntents: ['repair ai provider adapter', 'fix chatgpt or claude selectors', 'debug streaming completion detection', 'harden provider page integration'],
    negativeRoutingIntents: ['audit all providers for prompt portability', 'operate live business'],
    workModes: ['agent'],
    routingRisk: 'elevated',
    content: `Inspect and repair the ${'${provider:ChatGPT}'} provider adapter.

Verify composer discovery, prompt injection, submit controls, streaming detection, completion detection, stop controls, attachments, navigation, retries, and compatibility with third-party UI extensions. Keep platform-specific selectors isolated. Prefer semantic attributes and bounded fallbacks. Add fixtures or tests that fail gracefully when host markup changes.`,
  },
  {
    id: 'git-ready-pass',
    title: 'Prepare a Git-Ready Pass',
    description: 'Turn completed work into a clean reviewable branch and draft PR plan.',
    category: 'Git',
    tags: ['branch', 'commit', 'pull-request'],
    routingIntents: ['prepare branch for pull request', 'make changes git ready', 'review status diff and commit boundaries', 'draft pull request plan'],
    negativeRoutingIntents: ['merge immediately', 'force push', 'operate live business'],
    workModes: ['agent'],
    routingRisk: 'elevated',
    content: `Prepare this work for a clean Git review.

Target branch: ${'${target:main}'}
Scope: ${'${scope:the current focused change}'}

Inspect status and diff, separate unrelated changes, verify generated files and secrets are excluded, run the relevant tests and builds, propose cohesive commit boundaries, and draft a pull-request title and body. Do not merge or force-push. Clearly list skipped checks and remaining risks.`,
  },
  {
    id: 'document-system',
    title: 'Document a Subsystem',
    description: 'Create evidence-based architecture and operator documentation.',
    category: 'Documentation',
    tags: ['architecture', 'setup', 'operations'],
    routingIntents: ['document subsystem', 'write architecture documentation from code', 'create developer setup and troubleshooting docs', 'explain system boundaries and data flow'],
    negativeRoutingIntents: ['implement feature', 'operate live business'],
    workModes: ['ask', 'agent'],
    routingRisk: 'standard',
    content: `Document this subsystem from the implementation rather than assumptions.

Subsystem: ${'${subsystem}'}
Audience: ${'${audience:developers and maintainers}'}

Cover purpose, boundaries, entry points, data flow, configuration, security model, failure handling, tests, operational commands, and known limitations. Link documentation statements to exact code paths. Include a concise troubleshooting section and avoid claiming features that are only stubs.`,
  },
  {
    id: 'performance-audit',
    title: 'Extension Performance Audit',
    description: 'Find expensive observers, polling, bundle, memory, and service-worker behaviour.',
    category: 'Performance',
    tags: ['memory', 'observers', 'bundle'],
    routingIntents: ['audit extension performance', 'find memory growth or expensive observers', 'review polling and service worker wakeups', 'optimise browser extension startup'],
    negativeRoutingIntents: ['security audit', 'operate live business'],
    workModes: ['ask', 'agent'],
    routingRisk: 'standard',
    content: `Audit extension performance with evidence.

Focus area: ${'${area:startup, content scripts, observers, polling, and memory growth}'}

Identify unnecessary page scans, duplicate timers, unbounded MutationObservers, repeated storage reads, large payloads, excessive service-worker wakeups, retained DOM references, and expensive bundle dependencies. Rank findings by user impact and provide measurable verification steps for each proposed optimisation.`,
  },
]);
