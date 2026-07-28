# 鉴权与数据隔离测试

`isolation.mjs` 针对一个正在运行的测试实例执行真实 PostgreSQL 集成测试。脚本会拒绝数据库名中不含 `test` 的 `DATABASE_URL`，也会拒绝非空数据库，不会清理或重置数据库。

运行前先创建独立测试库、执行 `prisma db push`，再用同一个 `DATABASE_URL` 和 `AUTH_BOOTSTRAP_TOKEN` 启动应用：

```bash
DATABASE_URL='postgresql://.../novel_role_auth_test' npx prisma db push
DATABASE_URL='postgresql://.../novel_role_auth_test' AUTH_BOOTSTRAP_TOKEN='test-only-token' npm run dev -- --port 3011
DATABASE_URL='postgresql://.../novel_role_auth_test' AUTH_BOOTSTRAP_TOKEN='test-only-token' AUTH_TEST_BASE_URL='http://127.0.0.1:3011' npm run test:auth
```

覆盖范围包括首位用户原地接管两个同名 legacy 项目、正文/任务/AI 配置归属回填、双用户项目与 AI 设置隔离、跨用户项目/章节/生成接口统一 404、未登录 401、跨站写入 403，以及退出后 Session 失效。
