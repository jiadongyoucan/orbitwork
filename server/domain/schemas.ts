import { z } from 'zod';

const safeText = (max: number) => z.string().trim().min(1).max(max);

export const agentInputSchema = z
  .object({
    name: safeText(48),
    description: z.string().trim().max(240).default(''),
    systemPrompt: z.string().trim().max(12_000).default(''),
    model: z.string().trim().max(120).optional(),
    icon: z.string().trim().max(32).default('sparkles'),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#c8f768'),
    skillIds: z.array(z.string().max(64)).max(20).default([]),
    connectorIds: z.array(z.string().max(64)).max(20).default([]),
    memoryEnabled: z.boolean().default(true),
    sandboxEnabled: z.boolean().default(true),
  })
  .strict();

export const chatInputSchema = z
  .object({
    title: z.string().trim().max(120).optional(),
    agentId: z.string().max(64).nullable().optional(),
    model: z.string().max(120).optional(),
  })
  .strict();

export const messageInputSchema = z
  .object({
    content: z.string().trim().min(1).max(40_000),
  })
  .strict();

export const memoryInputSchema = z
  .object({
    title: safeText(120),
    content: safeText(8000),
    scope: z.enum(['workspace', 'agent']).default('workspace'),
    agentId: z.string().max(64).nullable().optional(),
    tags: z.array(z.string().trim().max(24)).max(10).default([]),
  })
  .strict();

export const workspaceInputSchema = z
  .object({
    name: safeText(48),
    icon: z.string().max(16).default('◎'),
  })
  .strict();

export const inviteInputSchema = z
  .object({ email: z.string().trim().toLowerCase().email(), role: z.enum(['admin', 'member']).default('member') })
  .strict();

export const memberRoleSchema = z.object({ role: z.enum(['admin', 'member']) }).strict();

const connectorSchema = z
  .object({
    method: z.enum(['GET', 'POST']).default('POST'),
    url: z.string().url().max(1000),
    toolName: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]{1,40}$/),
    description: z.string().max(500).default(''),
    parameters: z.record(z.unknown()).default({ type: 'object', properties: {} }),
  })
  .strict();

const expertSchema = z
  .object({
    role: z.string().trim().max(80).default('专家'),
    systemPrompt: z.string().trim().min(20).max(12_000),
    model: z.string().max(120).optional(),
  })
  .strict();

const skillSchema = z
  .object({
    instructions: z.string().trim().min(20).max(20_000),
    outputFormat: z.string().trim().max(2000).default(''),
  })
  .strict();

export const assetPayloadSchemas = {
  expert: expertSchema,
  skill: skillSchema,
  connector: connectorSchema,
} as const;

export const pluginItemSchema = z
  .object({
    kind: z.enum(['expert', 'skill', 'connector']),
    name: z.string().trim().min(1).max(48),
    summary: z.string().trim().max(160).default(''),
    payload: z.record(z.unknown()),
  })
  .strict();

export const pluginSchema = z
  .object({
    items: z.array(pluginItemSchema).min(1).max(10),
  })
  .strict();

export const assetKindSchema = z.enum(['expert', 'skill', 'connector', 'plugin']);

export const assetInputSchema = z
  .object({
    kind: assetKindSchema,
    name: safeText(48),
    summary: z.string().trim().max(180).default(''),
    description: z.string().trim().max(4000).default(''),
    icon: z.string().trim().max(32).default('box'),
    category: z.string().trim().max(32).default('通用'),
    version: z.string().regex(/^\d+\.\d+\.\d+$/).default('1.0.0'),
    payload: z.record(z.unknown()),
    secrets: z.record(z.string().max(2000)).optional(),
  })
  .strict();

export const assetPatchSchema = z
  .object({
    name: safeText(48).optional(),
    summary: z.string().trim().max(180).optional(),
    description: z.string().trim().max(4000).optional(),
    icon: z.string().trim().max(32).optional(),
    category: z.string().trim().max(32).optional(),
    payload: z.record(z.unknown()).optional(),
    version: z.string().regex(/^\d+\.\d+\.\d+$/).optional(),
    secrets: z.record(z.string().max(2000)).optional(),
  })
  .strict();

export const publishSchema = z
  .object({ version: z.string().regex(/^\d+\.\d+\.\d+$/).optional() })
  .strict();

export const sandboxRunSchema = z.object({ code: z.string().min(1).max(20_000) }).strict();

export const settingsSchema = z
  .object({
    defaultModel: z.string().max(120).optional(),
    allowMemberPublish: z.boolean().optional(),
    sandboxEnabled: z.boolean().optional(),
    memoryEnabled: z.boolean().optional(),
    networkEnabled: z.boolean().optional(),
    filesEnabled: z.boolean().optional(),
  })
  .strict();

export type AssetKind = z.infer<typeof assetKindSchema>;
export type AssetPayload = Record<string, unknown>;

export function validateAssetPayload(kind: AssetKind, payload: Record<string, unknown>): Record<string, unknown> {
  if (kind === 'plugin') {
    const parsed = pluginSchema.parse(payload);
    return {
      items: parsed.items.map((item) => ({
        ...item,
        payload: assetPayloadSchemas[item.kind].parse(item.payload),
      })),
    };
  }
  return assetPayloadSchemas[kind].parse(payload) as Record<string, unknown>;
}

export const providerInputSchema = z
  .object({
    name: z.string().trim().min(2).max(60),
    baseUrl: z.string().trim().url().max(500),
    apiKey: z.string().trim().max(4000).optional(),
    enabled: z.boolean().default(true),
  })
  .strict();

export const providerPatchSchema = z
  .object({
    name: z.string().trim().min(2).max(60).optional(),
    baseUrl: z.string().trim().url().max(500).optional(),
    apiKey: z.string().trim().max(4000).optional(),
    clearKey: z.boolean().optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

export const modelInputSchema = z
  .object({
    providerId: z.string().min(1).max(64),
    modelId: z.string().trim().min(1).max(200).regex(/^[A-Za-z0-9._:/@-]+$/),
    label: z.string().trim().min(1).max(80),
    contextWindow: z.number().int().min(4096).max(2_000_000).default(128000),
    enabled: z.boolean().default(true),
    isDefault: z.boolean().default(false),
  })
  .strict();

export const modelPatchSchema = modelInputSchema.partial().strict();
