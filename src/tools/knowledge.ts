import { builtinToolRegistry } from './catalog.js';
import type { ToolRegistry } from './types.js';

export interface ToolKnowledgeRecord {
  id: string;
  runtimeId: string;
  version: string;
  status: string;
  summary: string;
  keywords: readonly string[];
  category: string;
  relatedTools: readonly string[];
  relatedAgents: readonly string[];
  relatedSkills: readonly string[];
  relatedWorkflows: readonly string[];
  dependencies: readonly string[];
  servicesUsed: readonly string[];
  permissions: readonly string[];
  risk: string;
  approval: string;
  compatibility: {
    minTitanVersion?: string;
    node?: string;
    platforms: readonly string[];
  };
}

export function createToolKnowledgeRecords(
  registry: ToolRegistry = builtinToolRegistry,
): readonly ToolKnowledgeRecord[] {
  const records = registry.manifests().map((manifest): ToolKnowledgeRecord => deepFreeze({
    id: manifest.id,
    runtimeId: manifest.runtimeId,
    version: manifest.version,
    status: manifest.status,
    summary: manifest.knowledge.summary,
    keywords: [...manifest.knowledge.keywords].sort(),
    category: manifest.category,
    relatedTools: [...manifest.knowledge.relatedTools].sort(),
    relatedAgents: [...manifest.knowledge.relatedAgents].sort(),
    relatedSkills: [...manifest.knowledge.relatedSkills].sort(),
    relatedWorkflows: [...manifest.knowledge.relatedWorkflows].sort(),
    dependencies: [...manifest.dependencies].sort(),
    servicesUsed: [...manifest.servicesUsed].sort(),
    permissions: [...manifest.permissions].sort(),
    risk: manifest.risk,
    approval: manifest.approval,
    compatibility: {
      minTitanVersion: manifest.compatibility.minTitanVersion,
      node: manifest.compatibility.node,
      platforms: [...(manifest.compatibility.platforms ?? [])].sort(),
    },
  }));
  return Object.freeze(records.sort((left, right) => left.runtimeId.localeCompare(right.runtimeId)));
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) {
      deepFreeze(nested);
    }
  }
  return value;
}
