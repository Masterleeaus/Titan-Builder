export type BrowserRunMode = 'ask' | 'agent';

export type BrowserRunStatus =
  | 'queued'
  | 'building_context'
  | 'waiting_for_model'
  | 'validating_response'
  | 'awaiting_approval'
  | 'ready_to_apply'
  | 'applying'
  | 'verifying'
  | 'completed'
  | 'rejected'
  | 'cancelled'
  | 'failed';

export type BrowserProvider =
  | 'auto'
  | 'chatgpt'
  | 'claude'
  | 'gemini'
  | 'deepseek'
  | 'perplexity'
  | 'glm'
  | 'grok';

export type VerificationProfile = 'quick' | 'standard' | 'full';

export interface BrowserOperationPreview {
  id: string;
  action: string;
  path?: string;
  risk: string;
  summary: string;
  diff: string;
  requiresExplicitApproval: boolean;
}

export interface BrowserVerificationSnapshot {
  profile: VerificationProfile;
  status: 'pending' | 'running' | 'passed' | 'failed' | 'skipped';
  summary?: string;
}

export interface BrowserRunSnapshot {
  id: string;
  mode: BrowserRunMode;
  status: BrowserRunStatus;
  projectId: string;
  projectName?: string;
  provider: BrowserProvider;
  createdAt: string;
  updatedAt: string;
  responseText?: string;
  operations?: BrowserOperationPreview[];
  previewRevision?: string;
  verification?: BrowserVerificationSnapshot;
  error?: string;
}

export interface BrowserRunRecord extends BrowserRunSnapshot {
  prompt: string;
  contextRefs: string[];
  contextBudget?: number;
}

export interface CreateBrowserRunInput {
  mode: BrowserRunMode;
  projectId: string;
  projectName?: string;
  prompt: string;
  contextRefs?: string[];
  contextBudget?: number;
  provider?: BrowserProvider;
  verificationProfile?: VerificationProfile;
}

export type BrowserRunTransitionPatch = Partial<
  Pick<
    BrowserRunRecord,
    'projectName' | 'provider' | 'responseText' | 'verification' | 'error'
  >
>;

export interface BrowserRunListOptions {
  projectId?: string;
  limit?: number;
}
