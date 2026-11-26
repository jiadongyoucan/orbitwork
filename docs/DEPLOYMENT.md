# OrbitWork 部署手册（本地 Docker → 阿里云 ECS）

> 目标：用最少的云资源完成一次可验证的私有化上线。
> 推荐：Aliyun ECS 2 vCPU / 4 GB、Ubuntu 24.04 LTS、40 GB ESSD、一个已备案域名。
> 最低：2 GB RAM（建议至少 2 GB swap）、单核、20 GB 磁盘。

## 1. 本地 Docker 启动（验收用）

前置：Docker Engine 24+、Docker Compose v2。

```bash
git clone <your-repo> orbitwork
cd orbitwork
cp .env.example .env
```

编辑 `.env`，然后运行一次环境自检（有 Node 时）：

```bash
node scripts/preflight.mjs
```

`preflight` 会检查 Origin/Cookie 一致性、域名与 80/443、APP_SECRET/管理员密码占位符、沙箱超时等。

编辑 `.env`：

```dotenv
APP_ORIGIN=http://localhost:8080
APP_SECRET=<openssl rand -hex 32>
COOKIE_SECURE=false
TRUST_PROXY=false          # Compose 会覆盖为可信内网代理范围（Caddy）
SEED_ADMIN_PASSWORD=<strong-password>
SEED_DEMO_PASSWORD=<strong-password>
SEED_DEMO=true
SITE_ADDRESS=:80
HTTP_PORT=8080
HTTPS_PORT=8443
```

启动：

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f app
curl -f http://localhost:8080/api/health
```

访问 `http://localhost:8080`。用 `.env` 中设置的账号登录。

> 本仓库根目录的 `.env` 是本地生成文件（已 gitignore），包含随机 `APP_SECRET` 与演示密码。不要把它提交或用于生产。

### 首次验收脚本

1. 登录后工作台出现「通用助理」、市场种子卡片。
2. 新建任务 → 输入一句话 → 看到流式回复；点击「停止」可取消。
3. 打开「插件市场」→ 安装一个技能/专家 → 在「专家」中启用并开始对话。
4. 打开「沙箱」→ 运行 `console.log(1 + 1)` → 输出 2。
5. 邀请第二个账号 → 登录第二个账号 → 确认看不到第一个账号的会话。
6. 平台管理员登录 → 内容审核/用户管理可见。

## 2. 阿里云 ECS 准备

1. 购买 ECS（Ubuntu 24.04，2 vCPU / 4 GB，40 GB ESSD）。
2. 安全组入方向仅放行 **22 / 80 / 443**；不要暴露 8080、8790、8797。
3. 域名 A 记录指向 ECS 公网 IP；中国大陆地域需完成 ICP 备案。
4. 登录服务器安装 Docker：

```bash
sudo apt update
sudo apt install -y ca-certificates curl git docker.io docker-compose-v2
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
newgrp docker
docker --version && docker compose version
```

## 3. 生产环境变量

```dotenv
NODE_ENV=production
APP_ORIGIN=https://work.example.com
APP_SECRET=<64 hex chars>
COOKIE_SECURE=true
REGISTRATION_OPEN=true
TRUST_PROXY=false       # Compose 覆盖为可信内网代理范围
SITE_ADDRESS=work.example.com
HTTP_PORT=80
HTTPS_PORT=443

SEED_ADMIN_EMAIL=admin@example.com
SEED_ADMIN_PASSWORD=<strong-unique-password>
SEED_DEMO=false
SEED_DEMO_EMAIL=demo@example.com
SEED_DEMO_PASSWORD=<unused>

LLM_BASE_URL=https://api.deepseek.com/v1
LLM_API_KEY=<secret>
LLM_MODELS=deepseek-chat:DeepSeek Chat,deepseek-reasoner:DeepSeek Reasoner
LLM_TIMEOUT_MS=120000
# v1.3：接入层与上下文（可灰度回退）
LLM_ADAPTER=legacy          # legacy | port
LLM_MAX_RETRIES=2
LLM_RETRY_BASE_MS=250
LLM_CONTEXT_WINDOW=128000
AGENT_MAX_STEPS=6

SANDBOX_TIMEOUT_MS=6000
ALLOW_PRIVATE_CONNECTORS=false

# v1.1 联网与文件（可选覆盖，默认值如下）
WEB_FETCH_ENABLED=true
WEB_FETCH_TIMEOUT_MS=15000
WEB_FETCH_MAX_BYTES=1048576
WEB_FETCH_MAX_CHARS=20000
FILES_MAX_FILE_BYTES=5242880
FILES_MAX_WORKSPACE_BYTES=209715200
FILES_MAX_COUNT=500
# FILES_DIR=/app/.data/files
```

注意：

- `APP_ORIGIN` 必须与实际浏览器地址完全一致（协议 + 域名 + 端口）。不一致会导致 403。
- `COOKIE_SECURE=true` 时必须使用 HTTPS；本地 HTTP 请设 false。
- `SEED_*` 只在数据库为空时生效。修改密码后重启不会覆盖已有用户。
- 修改 `APP_SECRET` 会导致已保存的连接器密钥无法解密；上线后不要随意轮换。
- 不提交 `.env`。生产建议使用 Aliyun KMS/Secrets Manager 注入或至少 `chmod 600 .env`。

## 4. 启动与 TLS

```bash
git clone <your-repo> /opt/orbitwork
cd /opt/orbitwork
cp .env.example .env
vim .env
chmod 600 .env
docker compose up -d --build
docker compose ps
docker compose logs -f caddy
```

Caddy 会在 `SITE_ADDRESS=work.example.com` 且 80/443 可达时自动申请 Let's Encrypt 证书。确认：

```bash
curl -I https://work.example.com
curl -f https://work.example.com/api/health
```

Compose 拓扑：

- 仅 `caddy` 暴露端口；
- `app` 与 `sandbox` 使用同一镜像，sandbox 以 `network_mode: none` 运行；
- `app`、`sandbox` 共享 `/jobs` 命名卷用于沙箱任务队列；
- `app` 的 SQLite 数据在 `orbit_data` 命名卷；
- sandbox 只读根文件系统，`/tmp` 为 tmpfs，cap_drop ALL，pids/memory/cpu 限制。

## 5. 验收与安全冒烟

```bash
# 1. 健康
curl -f https://work.example.com/api/health

# 2. 登录（注意替换账号；Origin 必须匹配）
curl -i -c /tmp/orbit.cookies \
  -H 'content-type: application/json' \
  -H 'origin: https://work.example.com' \
  -d '{"email":"admin@example.com","password":"***"}' \
  https://work.example.com/api/auth/login

# 3. 越权：用第二个账号访问第一个工作区应返回 404
# 4. 流式：浏览器创建会话，确认文字逐字出现
# 5. 沙箱：手动运行 console.log(1+1)，再尝试 fetch('https://example.com')（Docker 下应失败）
```

浏览器 DevTools 检查：

- Response headers 含 CSP、X-Frame-Options、nosniff；
- 登录 Cookie 为 HttpOnly + Secure + SameSite=Lax；
- `/api/market` 响应不包含连接器 secret 值；
- 网络断开时 SSE 终止，刷新后能看到已保存的部分消息。

## 6. 备份（必须）

SQLite 使用 WAL，**不要直接 `cp` 数据库文件**。使用内置备份：

```bash
docker compose run --rm app node dist/backup.js
```

默认写入 `/app/.data/backups/`（即 `orbit_data` 卷），保留 14 天。

> **v1.1 起必须同时备份文件**。`backup.js` 只做 SQLite 的 `VACUUM INTO`，工作区文件在 `/app/.data/files/`，不在数据库里：
>
> ```bash
> docker run --rm -v orbitwork_orbit_data:/data -v /opt/orbitwork/backups:/backup alpine \
>   tar czf /backup/orbitwork-files-$(date +%F).tgz -C /data files
> ```
>
> 恢复时先还原数据库，再把 `files/` 解回卷内的 `/app/.data/files`，并保持 UID 1000 属主。

宿主机 cron：

```cron
20 3 * * * cd /opt/orbitwork && docker compose run --rm app node dist/backup.js >> /var/log/orbitwork-backup.log 2>&1
30 3 * * * docker run --rm -v orbitwork_orbit_data:/data -v /opt/orbitwork/backups:/backup alpine sh -c 'cp /data/backups/*.db /backup/ 2>/dev/null || true'
```

再将 `/opt/orbitwork/backups` 同步到 Aliyun OSS（ossutil / OSSFS），保留至少 30 天异地副本。

### 恢复演练（每季度）

SQLite 使用 WAL：**必须同时移除 `orbitwork.db-wal` 与 `orbitwork.db-shm`**，并且让恢复后的文件归 app 的 `node` 用户（UID 1000）所有，否则应用可能读到旧 WAL 或无法打开数据库。

```bash
docker compose stop app caddy
# 1. 清理旧库与 WAL（确认备份已校验后再执行）
docker run --rm -v orbitwork_orbit_data:/data alpine sh -c \
  'rm -f /data/orbitwork.db /data/orbitwork.db-wal /data/orbitwork.db-shm'
# 2. 放入备份并修正权限
docker run --rm -v orbitwork_orbit_data:/data -v /opt/orbitwork/backups:/backup alpine sh -c \
  'cp /backup/orbitwork-YYYY-MM-DD.db /data/orbitwork.db && chown 1000:1000 /data/orbitwork.db'
# 3. 以 app 用户做完整性检查
docker compose run --rm app node -e \
  "const {DatabaseSync}=require('node:sqlite'); const db=new DatabaseSync('/app/.data/orbitwork.db'); console.log(db.prepare('PRAGMA integrity_check').get()); db.close()"
# 4. 启动并验证
docker compose up -d
curl -f https://work.example.com/api/health
```

期望完整性检查结果为 `{ integrity_check: 'ok' }`。如果失败，停止应用并从另一份备份重试。

## 7. 升级与回滚

```bash
cd /opt/orbitwork
git pull
docker compose up -d --build
docker compose ps
```

- 数据库迁移在 app 启动时自动执行；迁移失败会阻止启动。
- 升级前先做一次备份。
- 回滚：`docker compose down && git checkout <prev-tag> && docker compose up -d --build`；若 schema 已升级，恢复对应备份。
- 镜像可打 tag 并推送到 ACR，生产使用固定 tag 而不是 `latest`。

## 8. 监控与日志

- 容器日志：`docker compose logs --tail=200 app`；建议接入 Aliyun SLS。
- 健康检查：`docker inspect --format '{{json .State.Health}}' orbitwork-app-1`。
- 建议告警：5xx 比例、登录 429 比例、SSE 中断率、LLM 请求 P95、沙箱超时率、磁盘 >80%。
- 每日检查：备份文件存在、证书剩余天数、容器重启次数。
- 不记录请求体、Cookie 或连接器密钥；日志中已有 redaction 由代码保证，但仍应避免在网关开启全量 body 日志。

> **沙箱定位（v1.3）**：这里的能力是**受限脚本执行**，用于数据转换/算法验证等内部半可信脚本，不是「运行用户上传代码」的安全沙箱。若产品需要对外承诺用户代码执行，请引入 gVisor/E2B 等强隔离方案，并保留当前实现作为离线降级路径。

## 9. 常见问题

| 现象 | 排查 |
|---|---|
| 登录 403 BAD_ORIGIN | `APP_ORIGIN` 与浏览器地址不一致；协议/端口需完全一致 |
| 登录成功但刷新掉登录 | `COOKIE_SECURE=true` 却用 HTTP；或反向代理未传 X-Forwarded-Proto |
| SSE 一次性返回 | 代理缓冲；确认使用 Caddyfile 的 `flush_interval -1`，不要加 gzip/压缩 |
| 沙箱 503 | sandbox 容器不健康；`docker compose logs sandbox`；检查 `/jobs` 卷权限与健康检查 |
| 沙箱执行超时 | 任务超过 6s；优化代码或调整 `SANDBOX_TIMEOUT_MS`（同时调整资源限制） |
| 模型 401/超时 | 检查 `LLM_API_KEY`、`LLM_BASE_URL`，容器需能出公网访问模型服务 |
| 市场为空 | 数据库非空时不会重新 seed；用管理员发布资产或备份恢复 |
| 磁盘增长 | 检查 Docker 日志轮转与备份保留策略；不要无限保留 `.db` |

## 10. 生产安全检查清单

- [ ] `.env` 权限 600，未提交仓库；`APP_SECRET` 随机且 ≥32 字符
- [ ] 管理员与演示密码已修改；`SEED_DEMO=false`
- [ ] `COOKIE_SECURE=true`，HTTPS 证书有效
- [ ] 安全组仅 22/80/443；SSH 限制源 IP
- [ ] Caddy 以外无服务暴露端口
- [ ] 备份 cron 已运行，已做一次恢复演练
- [ ] 平台管理员数量 ≥2，密码管理器保存
- [ ] 模型 API Key 有配额/告警，连接器密钥最小权限
- [ ] 日志与备份访问受控；无敏感信息进入日志
- [ ] 已用两个账号验证租户隔离与会话隐私

---

文档版本 1.0 · 2026-11-25
