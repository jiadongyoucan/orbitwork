import { randomUUID } from 'node:crypto';
import type { DB } from './infrastructure/db.js';
import { now } from './infrastructure/db.js';
import { config, defaultModel } from './config.js';
import { hashPassword, sha256 } from './domain/security.js';
import { validateAssetPayload } from './domain/schemas.js';

type SeedAsset = {
  kind: 'expert' | 'skill' | 'connector' | 'plugin';
  name: string;
  summary: string;
  description: string;
  icon: string;
  category: string;
  payload: Record<string, unknown>;
  installs?: number;
  stars?: number;
  featured?: boolean;
  version?: string;
};

const SKILLS = {
  research: {
    instructions:
      '## 深度研究简报法\n1. 先重述研究问题，列出 3-5 个关键子问题。\n2. 对每个结论标注证据等级（事实 / 推断 / 假设）。\n3. 输出「结论先行」的结构：摘要、关键发现、证据、反方观点、行动建议。\n4. 明确写出信息缺口，不臆造数据来源。\n5. 最后给出一页可转发的 TL;DR。',
    outputFormat: 'Markdown，含摘要、关键发现表、风险与下一步。',
  },
  growth: {
    instructions:
      '## 增长实验设计\n1. 用 ICE 打分排序假设（Impact、Confidence、Ease）。\n2. 每个实验写清：假设、目标人群、变量、成功指标、样本量、周期、停止条件。\n3. 优先设计低成本可逆实验。\n4. 输出实验看板，包含负责人和复盘日期。',
    outputFormat: '实验卡片表格 + 一页执行清单。',
  },
  review: {
    instructions:
      '## 代码审查清单\n- 正确性：边界条件、空值、并发与错误路径。\n- 安全：认证、租户隔离、注入、越权、密钥泄漏。\n- 可维护性：命名、职责单一、重复逻辑、测试缺口。\n- 性能：N+1、无界查询、阻塞调用。\n按「阻塞 / 建议 / 称赞」分级，并给出可直接应用的补丁建议。',
    outputFormat: '按严重级别分组的审查意见，附代码片段。',
  },
  copy: {
    instructions:
      '## 落地页文案公式\n1. 一句话价值主张：为谁 + 解决什么 + 差异化。\n2. 用「问题—转变—证据—行动」组织首屏。\n3. 每个卖点配一个可验证证据，避免空泛形容词。\n4. 给出 3 版标题、3 版 CTA，并说明适用人群。',
    outputFormat: '首屏区块文案 + A/B 变体表。',
  },
};

const EXPERTS = [
  {
    name: '增长策略顾问',
    summary: '把模糊增长目标拆成可验证的实验组合',
    description: '擅长北极星指标、增长模型、实验优先级与复盘。适合从 0 到 1 或增长停滞期。',
    icon: 'trending-up',
    category: '增长',
    systemPrompt:
      '你是一位有 10 年经验的增长策略顾问。你先用数据澄清现状，再建立增长模型，最后给出按 ICE 排序的实验组合。拒绝空泛建议；每个建议必须包含指标、成本、风险和验证周期。输出简洁、可直接排期。',
    installs: 1284,
    stars: 386,
    featured: true,
  },
  {
    name: '资深代码审查员',
    summary: '以安全与可维护性为先的严格代码审查',
    description: '覆盖正确性、安全、多租户隔离、性能与测试缺口，输出可执行的修改建议。',
    icon: 'shield-check',
    category: '研发',
    systemPrompt:
      '你是一位严格但友善的 Staff Engineer，负责代码审查。优先发现会造成数据泄漏、越权、资损和线上故障的问题。每条意见说明严重级别、触发条件、修复方式；不要重写整个文件。最后给出合并建议。',
    installs: 972,
    stars: 301,
    featured: true,
  },
  {
    name: '品牌叙事设计师',
    summary: '把产品能力翻译成有记忆点的品牌故事',
    description: '从用户洞察出发，产出品牌主张、叙事结构、官网文案与内容栏目。',
    icon: 'pen-tool',
    category: '设计',
    systemPrompt:
      '你是一位品牌叙事设计师。先追问受众、场景、替代方案与差异化证据，再输出品牌主张、三幕式故事、官网首屏文案和内容栏目。语言具体、有画面感，避免行业黑话。',
    installs: 643,
    stars: 188,
    featured: false,
  },
  {
    name: '数据分析教练',
    summary: '从业务问题到可执行的分析方案',
    description: '帮助定义指标、设计 SQL、检查统计陷阱，并把分析结果讲成决策。',
    icon: 'chart-no-axes-combined',
    category: '数据',
    systemPrompt:
      '你是一位数据分析教练。先确认业务决策和指标口径，再给出分析计划、SQL 骨架、验证方法与可视化建议。警惕幸存者偏差、辛普森悖论与均值陷阱。用业务语言解释统计结论。',
    installs: 511,
    stars: 154,
    featured: false,
  },
];

const PUBLIC_ASSETS: SeedAsset[] = [
  ...EXPERTS.map((expert) => ({
    kind: 'expert' as const,
    name: expert.name,
    summary: expert.summary,
    description: expert.description,
    icon: expert.icon,
    category: expert.category,
    installs: expert.installs,
    stars: expert.stars,
    featured: expert.featured,
    payload: { role: expert.category, systemPrompt: expert.systemPrompt },
  })),
  {
    kind: 'skill', name: '深度研究简报', summary: '把零散资料压缩成决策者可读的一页简报',
    description: '适用于行业研究、竞品分析与方案调研。强调证据等级与信息缺口。',
    icon: 'book-open', category: '研究', payload: SKILLS.research, installs: 1502, stars: 420, featured: true,
  },
  {
    kind: 'skill', name: '增长实验设计', summary: '用 ICE 排序假设，产出可执行的实验卡片',
    description: '从假设到停止条件的完整实验模板，适合增长与产品团队。',
    icon: 'flask-conical', category: '增长', payload: SKILLS.growth, installs: 811, stars: 210, featured: false,
  },
  {
    kind: 'skill', name: '代码审查清单', summary: '安全、正确性、可维护性的系统化审查框架',
    description: '让审查不再依赖灵感：按阻塞、建议、称赞分级输出。',
    icon: 'clipboard-check', category: '研发', payload: SKILLS.review, installs: 1094, stars: 267, featured: false,
  },
  {
    kind: 'connector', name: 'Open-Meteo 天气', summary: '免密钥天气与温度查询连接器',
    description: '示例连接器：调用 Open-Meteo 公共 API 查询指定经纬度的当前天气。可用于验证连接器编排。',
    icon: 'cloud-sun', category: '生活',
    payload: {
      method: 'GET',
      url: 'https://api.open-meteo.com/v1/forecast',
      toolName: 'get_weather',
      description: 'Get current weather for a latitude/longitude using Open-Meteo.',
      parameters: {
        type: 'object',
        properties: {
          latitude: { type: 'number', description: 'Latitude, e.g. 31.23' },
          longitude: { type: 'number', description: 'Longitude, e.g. 121.47' },
          current: { type: 'string', description: 'Comma-separated fields, e.g. temperature_2m,weather_code' },
        },
        required: ['latitude', 'longitude', 'current'],
      },
    },
    installs: 455, stars: 99, featured: false,
  },
  {
    kind: 'plugin', name: '出海增长工具箱', summary: '专家 + 研究技能 + 增长实验，一次安装即可开工',
    description: '为出海团队准备的组合包：增长策略顾问、深度研究简报与增长实验设计。安装后可在「专家」中启用。',
    icon: 'package', category: '增长', installs: 328, stars: 121, featured: true,
    payload: {
      items: [
        { kind: 'expert', name: '出海增长顾问', summary: '面向海外市场的增长诊断', payload: { role: '增长', systemPrompt: EXPERTS[0].systemPrompt + ' 特别关注海外渠道、支付习惯、本地化合规与获客成本。' } },
        { kind: 'skill', name: '深度研究简报', summary: '一页决策简报', payload: SKILLS.research },
        { kind: 'skill', name: '增长实验设计', summary: 'ICE 实验卡片', payload: SKILLS.growth },
      ],
    },
  },
];

function insertUser(db: DB, email: string, name: string, passwordHash: string, role: 'user' | 'admin') {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO users (id, email, name, password_hash, platform_role, avatar, created_at, last_login_at)
     VALUES (?, ?, ?, ?, ?, '', ?, ?)`,
  ).run(id, email, name, passwordHash, role, now(), now());
  return id;
}

function insertWorkspace(db: DB, ownerId: string, name: string, slug: string) {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO workspaces (id, name, slug, owner_id, settings_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, name, slug, ownerId, JSON.stringify({ defaultModel: defaultModel() }), now(), now());
  db.prepare('INSERT INTO memberships (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)').run(id, ownerId, 'owner', now());
  return id;
}

function publishSeedAsset(db: DB, workspaceId: string, authorId: string, asset: SeedAsset) {
  const payload = validateAssetPayload(asset.kind, asset.payload);
  const id = randomUUID();
  const version = asset.version ?? '1.0.0';
  const timestamp = now();
  db.prepare(
    `INSERT INTO assets (id, workspace_id, kind, name, slug, summary, description, icon, category, payload_json,
      version, status, visibility, author_id, installs, stars, featured, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', 'public', ?, ?, ?, ?, ?, ?)`,
  ).run(
    id, workspaceId, asset.kind, asset.name, asset.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) + '-' + randomUUID().slice(0, 4),
    asset.summary, asset.description, asset.icon, asset.category, JSON.stringify(payload), version,
    authorId, asset.installs ?? 0, asset.stars ?? 0, asset.featured ? 1 : 0, timestamp, timestamp,
  );
  const snapshot = JSON.stringify({
    kind: asset.kind, name: asset.name, summary: asset.summary, description: asset.description,
    icon: asset.icon, category: asset.category, version, payload,
  });
  db.prepare(
    `INSERT INTO asset_versions (id, asset_id, version, snapshot_json, content_hash, published_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(randomUUID(), id, version, snapshot, sha256(snapshot), authorId, timestamp);
  return id;
}

export async function seedDatabase(db: DB, options: { demo?: boolean; quiet?: boolean } = {}): Promise<{ createdAdmin: boolean; adminEmail: string }> {
  const existing = (db.prepare('SELECT COUNT(*) as n FROM users').get() as { n: number }).n;
  const demo = options.demo ?? config.seed.demo;
  let adminPassword = config.seed.adminPassword;
  let createdAdmin = false;

  if (existing === 0) {
    if (!adminPassword) {
      if (config.nodeEnv === 'production') {
        throw new Error('SEED_ADMIN_PASSWORD is required to initialize a production database');
      }
      adminPassword = 'OrbitWork!Admin2026';
    }
    if (config.nodeEnv === 'production' && (adminPassword.includes('CHANGE_ME') || adminPassword.length < 12)) {
      throw new Error('SEED_ADMIN_PASSWORD must be a strong (12+ chars) production secret');
    }
    if (config.nodeEnv === 'production' && demo && (config.seed.demoPassword || 'Demo!2026').includes('CHANGE_ME')) {
      throw new Error('SEED_DEMO_PASSWORD must not be a placeholder when SEED_DEMO=true');
    }
    const adminId = insertUser(db, config.seed.adminEmail, 'OrbitWork 官方', await hashPassword(adminPassword), 'admin');
    const officialWs = insertWorkspace(db, adminId, 'OrbitWork 官方', 'orbitwork-official');
    for (const asset of PUBLIC_ASSETS) publishSeedAsset(db, officialWs, adminId, asset);
    createdAdmin = true;

    if (demo) {
      const demoPassword = config.seed.demoPassword || 'Demo!2026';
      const demoId = insertUser(db, config.seed.demoEmail, '林默', await hashPassword(demoPassword), 'user');
      const demoWs = insertWorkspace(db, demoId, '星图产品实验室', 'xingtu-lab');
      const researchId = publishSeedAsset(db, demoWs, demoId, {
        kind: 'skill', name: '用户访谈洞察', summary: '把访谈原话整理成机会地图', description: '研究团队的内部技能示例。',
        icon: 'messages-square', category: '研究', payload: {
          instructions: '## 访谈洞察整理\n1. 按用户、场景、痛点、现有替代方案归类原话。\n2. 区分「说了」与「做了」。\n3. 输出机会地图和 3 个可验证假设。',
          outputFormat: '机会地图表格 + 假设清单。',
        },
      });
      db.prepare("UPDATE assets SET status = 'draft', visibility = 'private' WHERE id = ?").run(researchId);
      db.prepare('DELETE FROM asset_versions WHERE asset_id = ?').run(researchId);
      const agentId = randomUUID();
      db.prepare(
        `INSERT INTO agents (id, workspace_id, name, description, system_prompt, model, icon, color, skill_ids_json,
          connector_ids_json, memory_enabled, sandbox_enabled, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', 1, 1, ?, ?, ?)`,
      ).run(
        agentId, demoWs, '产品研究助理', '整理访谈、提炼洞察并设计验证实验',
        '你是一位产品研究助理。你善于从用户原话中提炼需求，区分事实与推断，并把洞察转成可验证的实验。',
        defaultModel(), 'telescope', '#8be9fd', JSON.stringify([researchId]), demoId, now(), now(),
      );
      const memoryRows = [
        ['产品原则', '我们的用户是 5-50 人的出海 SaaS 团队，最在意「少开会、快验证」。', ['定位', '原则']],
        ['品牌语气', '专业、克制、具体；不使用「颠覆」「赋能」等空泛词。', ['品牌']],
        ['当前重点', 'Q4 聚焦激活率与周留存，不新开大功能。', ['目标', 'Q4']],
      ];
      for (const [title, content, tags] of memoryRows) {
        db.prepare(
          `INSERT INTO memories (id, workspace_id, scope, title, content, tags_json, created_by, created_at, updated_at)
           VALUES (?, ?, 'workspace', ?, ?, ?, ?, ?, ?)`,
        ).run(randomUUID(), demoWs, String(title), String(content), JSON.stringify(tags), demoId, now(), now());
      }
      const chatId = randomUUID();
      db.prepare(
        `INSERT INTO chats (id, workspace_id, user_id, agent_id, title, model, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(chatId, demoWs, demoId, agentId, 'Q4 激活率实验规划', defaultModel(), now(), now());
      db.prepare(
        `INSERT INTO messages (id, chat_id, workspace_id, role, content, status, model, created_at)
         VALUES (?, ?, ?, 'user', ?, 'complete', ?, ?)`,
      ).run(randomUUID(), chatId, demoWs, '帮我把 Q4 激活率目标拆成 3 个可验证实验，并说明成功指标。', defaultModel(), now() - 60_000);
      db.prepare(
        `INSERT INTO messages (id, chat_id, workspace_id, role, content, reasoning, status, model, input_tokens, output_tokens, created_at)
         VALUES (?, ?, ?, 'assistant', ?, '', 'sample', ?, 0, 0, ?)`,
      ).run(
        randomUUID(), chatId, demoWs,
        '## Q4 激活率实验组合\n\n先对齐口径：激活 = 注册后 24h 内完成「创建第一个项目并邀请 1 位成员」。\n\n| 优先级 | 实验 | 假设 | 成功指标 | 周期 |\n|---|---|---|---|---|\n| P0 | 模板化首次项目 | 空白画布导致犹豫 | 24h 激活率 +15% | 2 周 |\n| P1 | 邀请引导卡 | 团队价值感知不足 | 邀请率 +20% | 3 周 |\n| P2 | 激活邮件序列 | 用户遗忘回访 | D7 留存 +8% | 4 周 |\n\n### 停止条件\n任一组在 7 天内相对提升 <3% 且样本量达到 80% 预期时停止，资源转向下一实验。',
        defaultModel(), now() - 30_000,
      );
      db.prepare("UPDATE chats SET title = 'Q4 激活率实验规划' WHERE id = ?").run(chatId);
    }
  }

  if (!options.quiet) {
    if (createdAdmin) console.log(`[seed] admin: ${config.seed.adminEmail}`);
    if (demo) console.log(`[seed] demo user: ${config.seed.demoEmail} (password from env)`);
  }
  return { createdAdmin, adminEmail: config.seed.adminEmail };
}
