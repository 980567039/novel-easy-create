import assert from "node:assert/strict";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const databaseUrl = process.env.DATABASE_URL;
const baseUrl = (process.env.AUTH_TEST_BASE_URL ?? "http://127.0.0.1:3011").replace(/\/$/, "");
const bootstrapToken = process.env.AUTH_BOOTSTRAP_TOKEN;

assert(databaseUrl, "DATABASE_URL is required");
assert(bootstrapToken, "AUTH_BOOTSTRAP_TOKEN is required");
const databaseName = new URL(databaseUrl).pathname.slice(1).toLowerCase();
assert(databaseName.includes("test"), `refusing to run against non-test database: ${databaseName}`);

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const LEGACY_USER_ID = "10000000-0000-4000-8000-000000000001";
const LEGACY_PROJECT_IDS = [
  "20000000-0000-4000-8000-000000000001",
  "20000000-0000-4000-8000-000000000002",
];

function cookieFrom(response) {
  const value = response.headers.get("set-cookie");
  assert(value, "response did not set a session cookie");
  return value.split(";", 1)[0];
}

async function request(path, { cookie, expected = 200, ...init } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...init.headers,
    },
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  assert.equal(response.status, expected, `${init.method ?? "GET"} ${path}: ${response.status} ${text}`);
  return { response, body };
}

async function seedLegacyData() {
  const [users, projects, bootstraps] = await Promise.all([
    db.user.count(),
    db.novelProject.count(),
    db.authBootstrap.count(),
  ]);
  assert.deepEqual({ users, projects, bootstraps }, { users: 0, projects: 0, bootstraps: 0 }, "test database must be empty");

  await db.user.create({
    data: {
      id: LEGACY_USER_ID,
      email: "local@novel-role.local",
      displayName: "本地作者",
      aiProviderConfig: {
        create: {
          provider: "openai-compatible",
          baseUrl: "https://legacy.test/v1",
          model: "legacy-model",
          apiKey: "legacy-secret",
        },
      },
      projects: {
        create: LEGACY_PROJECT_IDS.map((id, index) => ({
          id,
          title: "极品AI刁民",
          targetChapterCount: 80,
          storyBible: { create: { premise: `保留测试 ${index + 1}`, createdBy: "USER" } },
          ...(index === 0 ? {
            chapters: {
              create: {
                number: 1,
                title: "第一章",
                revisions: {
                  create: {
                    projectId: id,
                    revisionNumber: 1,
                    content: "必须原样保留的正文。",
                    source: "USER",
                    createdBy: "USER",
                  },
                },
                generationJobs: {
                  create: { projectId: id, type: "DRAFT", status: "SUCCEEDED" },
                },
              },
            },
          } : {}),
        })),
      },
    },
  });
}

try {
  await seedLegacyData();

  await request("/api/projects", { expected: 401 });
  const status = await request("/api/auth/status");
  assert.equal(status.body.bootstrapRequired, true);
  assert.equal(status.body.bootstrapConfigured, true);

  const registrationA = await request("/api/auth/register", {
    method: "POST",
    expected: 201,
    body: JSON.stringify({
      email: "owner-a@example.test",
      password: "correct-horse-a",
      displayName: "作者 A",
      bootstrapToken,
    }),
  });
  const cookieA = cookieFrom(registrationA.response);
  assert.equal(registrationA.body.user.id, LEGACY_USER_ID);
  assert.equal(registrationA.body.claimedLegacyProjectCount, 2);

  const retained = await db.user.findUniqueOrThrow({
    where: { id: LEGACY_USER_ID },
    include: {
      projects: { orderBy: { id: "asc" }, include: { chapters: { include: { revisions: true, generationJobs: true } } } },
      aiProviderConfig: true,
    },
  });
  assert.deepEqual(retained.projects.map((project) => project.id), LEGACY_PROJECT_IDS);
  assert(retained.passwordHash?.startsWith("scrypt$"));
  assert.equal(retained.projects[0].chapters[0].revisions[0].authorId, LEGACY_USER_ID);
  assert.equal(retained.projects[0].chapters[0].generationJobs[0].requesterId, LEGACY_USER_ID);
  assert.equal(retained.aiProviderConfig?.userId, LEGACY_USER_ID);

  const listA = await request("/api/projects", { cookie: cookieA });
  assert.equal(listA.body.projects.length, 2);
  assert(listA.body.projects.every((project) => project.title === "极品AI刁民"));

  await request("/api/settings/ai", {
    method: "PUT",
    cookie: cookieA,
    body: JSON.stringify({
      provider: "openai-compatible",
      baseUrl: "https://owner-a.test/v1",
      model: "owner-a-model",
      apiKey: "owner-a-secret",
      enabled: true,
    }),
  });

  const registrationB = await request("/api/auth/register", {
    method: "POST",
    expected: 201,
    body: JSON.stringify({
      email: "owner-b@example.test",
      password: "correct-horse-b",
      displayName: "作者 B",
    }),
  });
  const cookieB = cookieFrom(registrationB.response);
  const userBId = registrationB.body.user.id;
  assert.notEqual(userBId, LEGACY_USER_ID);

  const listB = await request("/api/projects", { cookie: cookieB });
  assert.deepEqual(listB.body.projects, []);
  const settingsB = await request("/api/settings/ai", { cookie: cookieB });
  assert.equal(settingsB.body.settings.apiKeyConfigured, false);

  const projectId = LEGACY_PROJECT_IDS[0];
  const chapterId = retained.projects[0].chapters[0].id;

  const publicReader = await request(`/api/projects/${projectId}/reader`);
  assert.equal(publicReader.body.project.id, projectId);
  assert.equal(publicReader.body.project.title, "极品AI刁民");
  assert.equal(publicReader.body.stats.readableChapterCount, 1);
  assert.equal(publicReader.body.chapters[0].id, chapterId);

  const publicChapter = await request(`/api/projects/${projectId}/reader?chapterId=${chapterId}`);
  assert.equal(publicChapter.body.chapter.id, chapterId);
  assert.equal(publicChapter.body.chapter.content, "必须原样保留的正文。");

  await request(`/api/projects/${projectId}/reader`, { cookie: cookieB });

  await request(`/api/chapters/${chapterId}/finalize?projectId=${projectId}`, {
    method: "POST",
    cookie: cookieA,
    body: JSON.stringify({ revisionId: retained.projects[0].chapters[0].revisions[0].id }),
  });
  const chaptersAfterFinalize = await request(`/api/projects/${projectId}/chapters`, { cookie: cookieA });
  const finalizedChapter = chaptersAfterFinalize.body.chapters.find((chapter) => chapter.id === chapterId);
  assert.equal(finalizedChapter.status, "CONFIRMED");
  assert.equal(finalizedChapter.latestRevision.status, "FINAL");

  const forbiddenReads = [
    `/api/projects/${projectId}/export`,
    `/api/projects/${projectId}/outline`,
    `/api/projects/${projectId}/outline?jobId=${retained.projects[0].chapters[0].generationJobs[0].id}`,
    `/api/projects/${projectId}/chapters`,
    `/api/projects/${projectId}/chapters/batch-drafts`,
    `/api/projects/${projectId}/chapters/${chapterId}`,
    `/api/chapters/${chapterId}`,
    `/api/chapters/${chapterId}/drafts`,
  ];
  for (const path of forbiddenReads) await request(path, { cookie: cookieB, expected: 404 });

  await request(`/api/projects/${projectId}/story-bible/generate`, {
    method: "POST",
    cookie: cookieB,
    expected: 404,
    body: "{}",
  });
  await request(`/api/projects/${projectId}/outline`, {
    method: "POST",
    cookie: cookieB,
    expected: 404,
    body: "{}",
  });
  await request(`/api/projects/${projectId}/chapters/${chapterId}/drafts/generate`, {
    method: "POST",
    cookie: cookieB,
    expected: 404,
    body: "{}",
  });
  await request(`/api/projects/${projectId}/chapters/batch-drafts`, {
    method: "POST",
    cookie: cookieB,
    expected: 404,
    body: JSON.stringify({ count: 5 }),
  });
  await request(`/api/projects/${projectId}`, {
    method: "DELETE",
    cookie: cookieB,
    expected: 404,
    body: JSON.stringify({ confirmationTitle: "极品AI刁民" }),
  });
  await request("/api/settings/ai", {
    method: "PUT",
    cookie: cookieB,
    expected: 403,
    headers: { Origin: "https://evil.example" },
    body: JSON.stringify({ provider: "openai-compatible", model: "evil", enabled: true }),
  });

  const createdB = await request("/api/projects", {
    method: "POST",
    cookie: cookieB,
    expected: 201,
    body: JSON.stringify({ title: "B 的项目", targetChapterCount: 60 }),
  });
  assert.equal(createdB.body.project.ownerId, userBId);
  const listAAfter = await request("/api/projects", { cookie: cookieA });
  assert.equal(listAAfter.body.projects.length, 2);
  assert(!listAAfter.body.projects.some((project) => project.id === createdB.body.project.id));

  await request("/api/auth/logout", { method: "POST", cookie: cookieB });
  await request("/api/auth/me", { cookie: cookieB, expected: 401 });

  const finalLegacyProjects = await db.novelProject.findMany({
    where: { ownerId: LEGACY_USER_ID, title: "极品AI刁民" },
    orderBy: { id: "asc" },
    select: { id: true },
  });
  assert.deepEqual(finalLegacyProjects.map(({ id }) => id), LEGACY_PROJECT_IDS);
  console.log("auth isolation integration test passed");
} finally {
  await db.$disconnect();
}
