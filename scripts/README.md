# 小白作家一键启动脚本

## macOS

双击 `start-mac.command`。

第一次运行如果 macOS 阻止打开脚本，可在终端执行：

```bash
chmod +x scripts/start-mac.command
open scripts/start-mac.command
```

脚本会检查 Node.js、安装依赖、创建 `.env`、生成 Prisma Client、尝试启动 Homebrew PostgreSQL 16、同步数据库结构，然后运行 `npm run dev`。

## Windows

双击 `start-windows.bat`。它会调用同目录下的 PowerShell 脚本完成启动流程。

Windows 需要预先安装：

- Node.js 20 或更高版本；
- 如果需要项目创建和数据库功能，安装 PostgreSQL 并确保 `localhost:5432` 可连接。

PowerShell 脚本使用 `-ExecutionPolicy Bypass` 仅对本次启动生效，不会修改系统的执行策略。

## 两个平台的共同前提

- `.env.example` 会在缺少 `.env` 时自动复制为 `.env`；
- 数据库不可用时，前端仍会启动，但项目创建接口会返回 `DATABASE_UNAVAILABLE`；
- 关闭启动脚本窗口会停止开发服务器。
