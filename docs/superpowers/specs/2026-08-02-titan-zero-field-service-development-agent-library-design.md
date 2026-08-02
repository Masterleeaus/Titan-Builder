# Titan Zero and Field-Service Development Agent Library Design

## Status

Approved by the user on 2026-08-02 for implementation on `agent/agent-profile-inventory`.

## Goal

Extend the existing OpenBrowser platform-development agent library with specialist profiles that build and maintain Titan Zero, its reusable home and field-service software layer, and three initial vertical-development layers.

## Scope boundary

These profiles are development agents only. They design, implement, review, test, migrate, secure, and document software. They do not operate a customer business, dispatch real workers, collect real debts, approve real quotes, or act as a live service-business operator.

## Library structure

```text
browser-extension/agent-library/
├── titan-zero-development/
├── field-service-development/
└── vertical-development/
    ├── cleaning/
    ├── airbnb/
    └── medical-cleaning/
```

## Profile packs

### Titan Zero development

Twenty profiles cover Titan Zero architecture, WorkCore integration, generative UI, manager and mobile workspaces, offline synchronisation, device-vault security, AI routing, five-tier AI, agent and skill runtimes, templates, channels, voice, ZeroPay, marketplace, SaaS entitlements, Titan Sprout, and migrations.

### Reusable field-service development

Twenty-two profiles cover the reusable field-service domain, jobs, scheduling, dispatch, field-worker UX, checklists, quoting, variations, evidence, geolocation, offline queues, forms, compliance, assets, inventory, recurring services, billing, portals, subcontractors, notifications, reporting, maps, and routing.

### Vertical development

Three profiles specialise the reusable field-service layer for cleaning, Airbnb turnovers, and medical-cleaning compliance. They must extend shared field-service contracts instead of creating parallel job, customer, billing, evidence, or scheduling systems.

## Document contract

Every profile must define:

- Metadata
- Identity
- Purpose
- Expertise
- Responsibilities
- Tools
- Permissions
- Memory scope
- Communication style
- Decision strategy
- Strengths
- Weaknesses
- Escalation rules
- Approval requirements
- Skills
- Prompt templates
- Validation rules
- Success metrics
- Version

## Architectural rules

1. Each profile owns one bounded development responsibility.
2. WorkCore remains authoritative for operational records where Titan Zero integrates with it.
3. Vertical profiles extend reusable field-service components instead of duplicating them.
4. Profiles may recommend or implement repository changes only within their assigned scope.
5. Profiles cannot weaken security, approval, privacy, tenant-isolation, or verification controls.
6. Definitions remain canonical Markdown assets until the separate runtime-loader migration is completed.
7. Profile IDs are stable kebab-case identifiers and use profile version `1.0.0` with schema version `1`.

## Validation

The pass succeeds when exactly 45 new profile assets exist in the approved directories, every approved role is represented once, all required sections are present, IDs and paths are unique, and no executable runtime files are modified.

## Future integration

A later runtime pass will index these assets, map them into the shared profile schema, expose domain filters in the side panel, preserve legacy aliases, and test prompt composition and activation. This content pass does not change runtime behaviour.