# 小白作家

小白作家是一套面向新手作者的 AI 长篇小说创作系统。你负责提供创意和做出关键选择，系统负责整理故事圣经、规划长篇大纲、辅助逐章创作，并帮助小说持续推进到完结。

当前版本已经支持：

- 三步创建小说项目；
- AI 服务、模型地址和 API Key 设置；
- 故事圣经生成；
- 分卷、分章的长篇分层大纲；
- 场景表、正文草稿和章节定稿；
- 桌面端与手机 H5 小说预览；
- 小说项目 JSON 导入与完整备份导出；
- PostgreSQL 持久化存储。

## 功能预览

### 小说创作工作台

从首页管理小说项目、AI 模型配置和创作入口。

![小白作家首页工作台](docs/images/home-dashboard.png)

### 三步创建小说

通过通俗问题收集故事创意、主角目标和结局方向，无需预先掌握专业写作术语。

![三步小说创建向导](docs/images/project-onboarding.png)

### 完整分层大纲

查看全书结局方向、分卷目标以及每章的目标、冲突、结果和状态变化。

![完整分层大纲](docs/images/outline-planner.png)

### 章节创作工作台

按章节管理写作进度，在同一界面生成场景表、生成正文初稿、编辑和定稿。

![章节创作工作台](docs/images/chapter-editor.png)

### 沉浸式小说预览

以阅读模式预览已完成正文，支持目录、章节切换和阅读显示设置。

![沉浸式小说预览](docs/images/reader-preview.png)

## 推荐：使用 Docker 一键部署

这是最简单的部署方式。只需要提前安装 [Docker Desktop](https://www.docker.com/products/docker-desktop/) 或 Docker Engine，并确保 Docker Compose 可用。

### 1. 启动

进入项目目录后运行：

```bash
docker compose up -d --build
```

Compose 会自动完成以下工作：

1. 启动 PostgreSQL；
2. 等待数据库可用；
3. 初始化或同步 Prisma 数据库结构；
4. 启动小白作家 Web 服务。

首次构建需要下载镜像和安装依赖，通常会比后续启动慢。服务启动后打开：

- 本机访问：[http://localhost:3000](http://localhost:3000)
- AI 设置：[http://localhost:3000/settings/ai](http://localhost:3000/settings/ai)

### 2. 查看状态和日志

```bash
docker compose ps
docker compose logs -f web
```

看到 Web 服务状态为 `healthy` 后即可使用。按 `Ctrl+C` 退出日志查看不会停止服务。

### 3. 停止或重新启动

```bash
# 停止服务，保留小说和设置数据
docker compose down

# 再次启动
docker compose up -d

# 拉取新代码后重新构建
docker compose up -d --build
```

PostgreSQL 数据保存在 Docker volume 中，普通的 `docker compose down` 不会删除数据。

> 注意：`docker compose down -v` 会同时删除数据库 volume，小说项目、正文和 AI 设置将无法恢复。除非明确需要清空数据，否则不要添加 `-v`。

### 4. 修改 Docker 数据库密码

默认账号和密码只适合本机体验。公网或服务器部署前，在项目根目录创建 `.env.docker`：

```dotenv
POSTGRES_USER=xiaobai
POSTGRES_PASSWORD=请替换为足够长的字母数字随机密码
POSTGRES_DB=xiaobai_writer
```

启动时显式加载：

```bash
docker compose --env-file .env.docker up -d --build
```

`.env.docker` 不应提交到 Git，也不要把真实 API Key 写进镜像或 README。

连接字符串会直接使用这个密码；请使用字母和数字，避免 `@`、`:`、`/` 等需要 URL 编码的字符。

### 5. 配置 AI

部署完成后进入“AI 设置”页面，选择 OpenAI、OpenAI-compatible 或 LM Studio，并填写：

- API Base URL；
- 模型名；
- API Key。

设置会保存在 PostgreSQL 中，API Key 只由服务端读取，不会作为浏览器公开环境变量打包。

如果小白作家部署在远程服务器，而 LM Studio 运行在你自己的电脑上，容器中的 `localhost` 指向容器本身，不能直接访问电脑上的 LM Studio。此时需要使用容器可访问的局域网地址或中转服务地址。

## 本地开发

### 环境要求

- Node.js 20.19 或更高版本；
- npm；
- PostgreSQL 14 或更高版本。

### macOS / Windows 一键启动

- macOS：双击 `scripts/start-mac.command`；
- Windows：双击 `scripts/start-windows.bat`。

详细说明见 [scripts/README.md](scripts/README.md)。

### 手动启动

复制环境变量示例：

```bash
cp .env.example .env
```

Windows PowerShell：

```powershell
Copy-Item .env.example .env
```

修改 `.env` 中的 `DATABASE_URL`，然后执行：

```bash
npm ci
npm run db:generate
npm run db:sync
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)。

## 常用命令

```bash
npm run dev              # 开发模式
npm run build            # 生产构建
npm run start            # 运行生产构建
npm run lint             # ESLint
npx tsc --noEmit         # TypeScript 检查
npm run test:ai-eval     # AI 固定评估
npm run db:validate      # 校验 Prisma Schema
npm run db:generate      # 生成 Prisma Client
npm run db:sync          # 初始化或同步数据库结构
npm run db:studio        # 打开 Prisma Studio
```

## 环境变量

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `DATABASE_URL` | 是 | PostgreSQL 连接字符串 |
| `AI_PROVIDER` | 否 | 默认 `openai-compatible` |
| `AI_API_KEY` | 否 | 服务端 AI Key，也可在设置页保存 |
| `AI_BASE_URL` | 否 | OpenAI-compatible API 地址 |
| `AI_PLANNING_MODEL` | 否 | 故事圣经和大纲模型 |
| `AI_WRITING_MODEL` | 否 | 正文创作模型 |
| `AI_CHECK_MODEL` | 否 | 质量检查模型 |

`.env.example` 只提供安全的空值示例。不要提交包含真实密钥的 `.env`、`.env.docker` 或日志文件。

## 项目结构

```text
src/app/                 Next.js 页面与 API Routes
src/server/              数据库、AI Provider 和业务服务
prisma/                  数据模型与数据库迁移
scripts/                 macOS / Windows 一键启动脚本
tests/ai-evals/          AI 契约和固定评估
docs/DEVELOPMENT_PLAN.md 产品与技术开发计划
```

更多设计和后续开发计划见 [docs/DEVELOPMENT_PLAN.md](docs/DEVELOPMENT_PLAN.md)。
