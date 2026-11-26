import { z } from 'zod';

const bool = (v: string | undefined, fallback = false) =>
  v === undefined ? fallback : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());

const num = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const DATA_DIR = process.env.DATA_DIR ?? '.data';

export const config = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 8797),
  host: process.env.HOST ?? '0.0.0.0',
  appOrigin: process.env.APP_ORIGIN ?? `http://localhost:${process.env.PORT ?? 8797}`,
  dataDir: DATA_DIR,
  dbPath: process.env.DB_PATH ?? '.data/orbitwork.db',
  appSecret: process.env.APP_SECRET ?? 'dev-only-secret-change-me-please-32chars',
  sessionDays: Number(process.env.SESSION_DAYS ?? 14),
  cookieSecure: bool(process.env.COOKIE_SECURE, process.env.NODE_ENV === 'production'),
  trustProxy: (() => {
    const raw = process.env.TRUST_PROXY ?? 'false';
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    return raw;
  })(),
  registrationOpen: bool(process.env.REGISTRATION_OPEN, true),
  llm: {
    baseUrl: (process.env.LLM_BASE_URL ?? 'https://api.deepseek.com/v1').replace(/\/$/, ''),
    apiKey: process.env.LLM_API_KEY ?? '',
    modelsRaw: process.env.LLM_MODELS ?? 'deepseek-chat:DeepSeek Chat,deepseek-reasoner:DeepSeek Reasoner',
    timeoutMs: Math.max(1000, num(process.env.LLM_TIMEOUT_MS, 120000)),
    adapter: (process.env.LLM_ADAPTER === 'port' ? 'port' : 'legacy') as 'legacy' | 'port',
    maxRetries: Math.max(0, num(process.env.LLM_MAX_RETRIES, 2)),
    retryBaseMs: Math.max(1, num(process.env.LLM_RETRY_BASE_MS, 250)),
    contextWindow: Math.max(4096, num(process.env.LLM_CONTEXT_WINDOW, 128000)),
  },
  agent: {
    maxSteps: Math.min(12, Math.max(1, Math.trunc(num(process.env.AGENT_MAX_STEPS, 6)))),
  },
  sandbox: {
    url: process.env.SANDBOX_URL ?? 'http://127.0.0.1:8790',
    token: process.env.SANDBOX_TOKEN ?? 'dev-sandbox-token',
    timeoutMs: Math.max(1000, num(process.env.SANDBOX_TIMEOUT_MS, 6000)),
    queueDir: process.env.SANDBOX_QUEUE_DIR ?? '',
  },
  allowPrivateConnectors: bool(process.env.ALLOW_PRIVATE_CONNECTORS, false),
  allowPrivateProviders: bool(process.env.ALLOW_PRIVATE_PROVIDERS, false),
  files: {
    dir: process.env.FILES_DIR ?? `${DATA_DIR}/files`,
    maxFileBytes: Number(process.env.FILES_MAX_FILE_BYTES ?? 5 * 1024 * 1024),
    maxWorkspaceBytes: Number(process.env.FILES_MAX_WORKSPACE_BYTES ?? 200 * 1024 * 1024),
    maxCount: Number(process.env.FILES_MAX_COUNT ?? 500),
    readBytes: 100 * 1024,
  },
  web: {
    enabled: bool(process.env.WEB_FETCH_ENABLED, true),
    timeoutMs: Number(process.env.WEB_FETCH_TIMEOUT_MS ?? 15_000),
    maxBytes: Number(process.env.WEB_FETCH_MAX_BYTES ?? 1024 * 1024),
    maxChars: Number(process.env.WEB_FETCH_MAX_CHARS ?? 20_000),
  },
  seed: {
    adminEmail: process.env.SEED_ADMIN_EMAIL ?? 'admin@orbitwork.local',
    adminPassword: process.env.SEED_ADMIN_PASSWORD ?? '',
    demoEmail: process.env.SEED_DEMO_EMAIL ?? 'demo@orbitwork.local',
    demoPassword: process.env.SEED_DEMO_PASSWORD ?? '',
    demo: bool(process.env.SEED_DEMO, process.env.NODE_ENV !== 'production'),
  },
};

export type ModelOption = { id: string; label: string };

export function models(): ModelOption[] {
  return config.llm.modelsRaw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [id, ...label] = part.split(':');
      return { id: id.trim(), label: (label.join(':') || id).trim() };
    });
}

export function defaultModel(): string {
  return models()[0]?.id ?? 'deepseek-chat';
}

export function isDemoLlm(): boolean {
  return !config.llm.apiKey;
}

export const signupSchema = z.object({
  name: z.string().trim().min(2).max(40),
  email: z.string().trim().toLowerCase().email().max(120),
  password: z.string().min(12).max(128),
  workspaceName: z.string().trim().min(2).max(48).optional(),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(128),
});
