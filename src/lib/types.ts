export type PlatformRole = 'user' | 'admin';
export type WorkspaceRole = 'owner' | 'admin' | 'member';

export type User = {
  id: string;
  email: string;
  name: string;
  avatar: string;
  platformRole: PlatformRole;
};

export type Workspace = {
  id: string;
  name: string;
  slug: string;
  role: WorkspaceRole;
  plan: string;
  settings: Record<string, unknown>;
};

export type Agent = {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  model: string;
  icon: string;
  color: string;
  skillIds: string[];
  connectorIds: string[];
  memoryEnabled: boolean;
  sandboxEnabled: boolean;
  createdAt: number;
  updatedAt: number;
};

export type Chat = {
  id: string;
  title: string;
  model: string;
  agent_id: string | null;
  agent_name?: string;
  agent_icon?: string;
  pinned?: number;
  archived?: number;
  created_at: number;
  updated_at: number;
  message_count?: number;
};

export type ToolEvent = {
  id: string;
  name: string;
  input: unknown;
  output: string;
  status: 'success' | 'error';
  durationMs: number;
};

export type Message = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  reasoning?: string;
  toolEvents?: ToolEvent[];
  status?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  reasoningMs?: number;
  runId?: string;
  createdAt?: number;
};

export type TraceEvent = {
  id: string;
  runId: string | null;
  seq: number;
  kind: string;
  phase: string;
  status: string;
  durationMs: number;
  at: number;
  detail: Record<string, unknown>;
};

export type TraceRun = {
  id: string;
  status: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  error: string;
  startedAt: number;
  finishedAt: number | null;
};

export type TracePayload = {
  runs: TraceRun[];
  events: TraceEvent[];
  totals: { events: number; durationMs: number; tokensIn: number; tokensOut: number; errors: number };
  metrics: { totalMs: number; modelMs: number; toolMs: number; firstTokenMs: number };
  truncated: boolean;
  totalEvents: number;
};

export type Memory = {
  id: string;
  agentId: string | null;
  scope: 'workspace' | 'agent';
  title: string;
  content: string;
  tags: string[];
  createdBy?: string;
  createdAt: number;
  updatedAt: number;
};

export type AssetKind = 'expert' | 'skill' | 'connector' | 'plugin';

export type Asset = {
  id: string;
  workspaceId: string;
  kind: AssetKind;
  name: string;
  slug: string;
  summary: string;
  description: string;
  icon: string;
  category: string;
  payload: Record<string, any>;
  secretKeys: string[];
  version: string;
  status: 'draft' | 'published' | 'suspended';
  visibility: 'private' | 'workspace' | 'public';
  authorId: string;
  authorName: string;
  sourceAssetId: string | null;
  installs: number;
  stars: number;
  featured: boolean;
  starred?: boolean;
  createdAt: number;
  updatedAt: number;
};

export type Member = {
  id: string;
  name: string;
  email: string;
  avatar: string;
  role: WorkspaceRole;
  created_at: number;
};

export type Invite = {
  id: string;
  email: string;
  role: string;
  expires_at: number;
  created_at: number;
};

export type ModelOption = {
  id: string;
  label: string;
  providerId?: string | null;
  providerName?: string;
  contextWindow?: number;
  source?: 'workspace' | 'system';
  isDefault?: boolean;
  hasKey?: boolean;
  keyError?: boolean;
  demo?: boolean;
};

export type Overview = {
  workspace: Workspace;
  stats: { chats: number; agents: number; memories: number; assets: number; members: number };
  usage: { tokens_in: number; tokens_out: number };
  recentChats: Chat[];
  models: ModelOption[];
};

export type RunRecord = {
  id: string;
  chatId?: string;
  status: string;
  model: string;
  tokens_in?: number;
  tokens_out?: number;
  started_at: number;
  finished_at?: number;
};

export type AuditLog = {
  id: string;
  action: string;
  target_type: string;
  target_id: string;
  metadata_json?: string;
  created_at: number;
  actor_name?: string;
  actor_email?: string;
  workspace_name?: string;
};

export type ProviderConfig = {
  id: string;
  name: string;
  type: string;
  baseUrl: string;
  enabled: boolean;
  hasKey: boolean;
  keyError: boolean;
  modelCount: number;
  createdAt: number;
  updatedAt: number;
};

export type WorkspaceModel = {
  id: string;
  providerId: string;
  providerName: string;
  modelId: string;
  label: string;
  contextWindow: number;
  enabled: boolean;
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
};

export type ModelSettings = {
  providers: ProviderConfig[];
  models: WorkspaceModel[];
  effectiveModels: ModelOption[];
  configured: boolean;
  defaultModel: string;
  env: { hasKey: boolean; baseUrl: string; modelCount: number };
};

export type WorkspaceFile = {
  id: string;
  name: string;
  mime: string;
  size: number;
  sha256: string;
  text: boolean;
  chatId: string | null;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
};
