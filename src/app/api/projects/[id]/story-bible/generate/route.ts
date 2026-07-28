import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { getConfiguredAiProvider } from "@/server/ai";
import { StoryBibleDraftSchema } from "@/server/ai/schemas";
import { authenticateApiRequest } from "@/server/api-auth";
import { getDatabase } from "@/server/db";

export const runtime = "nodejs";

const onboardingAnswersSchema = z.record(z.string(), z.unknown());

function asAnswers(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const parsed = onboardingAnswersSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}

function asText(value: unknown, preferredKeys: string[] = []): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    return value.map((item) => asText(item)).filter(Boolean).join("\n");
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of preferredKeys) {
      const preferred = asText(record[key]);
      if (preferred) return preferred;
    }
    const readable = Object.values(record)
      .map((item) => asText(item))
      .filter(Boolean);
    if (readable.length > 0) return readable.join("\n");
  }
  return value == null ? "" : String(value).trim();
}

function asJson(value: unknown): Prisma.InputJsonValue {
  // The provider result originated from JSON.parse; round-tripping here
  // narrows the value to Prisma's JSON input type and strips impossible
  // runtime values such as undefined.
  return JSON.parse(JSON.stringify(value ?? [])) as Prisma.InputJsonValue;
}

function asConstraints(value: unknown): Prisma.InputJsonValue {
  // Keep rich constraint objects intact in the JSON column. Older/shorter
  // model responses (a string or string array) remain valid as-is.
  return asJson(value);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateApiRequest(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const db = getDatabase();
  const project = await db.novelProject.findFirst({
    where: { id, ownerId: auth.user.id },
    include: { storyBible: true },
  });

  if (!project || !project.storyBible) {
    return NextResponse.json({ code: "PROJECT_NOT_FOUND", error: "小说项目不存在。" }, { status: 404 });
  }

  const styleGuide = asAnswers(project.storyBible.styleGuide);
  const answers = asAnswers(styleGuide.onboardingAnswers);

  try {
    const provider = await getConfiguredAiProvider(auth.user.id);
    const result = await provider.generateStructured(
      {
        schemaName: "StoryBibleDraft",
        model: undefined,
        temperature: 0.3,
        messages: [
          {
            role: "system",
            content: [
              "你是一名长篇小说总编，负责把新手作者的零散想法整理成可持续创作的故事圣经。",
              "不要擅自改变作者的核心创意；信息不足时用简洁、可编辑的合理假设补齐。",
              "输出必须是 JSON，字段包括 premise、theme、tone、pointOfView、endingDirection、constraints、characters。",
              "characters 中的每个角色必须包含 name、role、desire、fear、secret、arc。",
            ].join("\n"),
          },
          {
            role: "user",
            content: JSON.stringify({
              title: project.title,
              genre: project.genre,
              logline: project.logline,
              onboardingAnswers: answers,
              targetWordCount: project.targetWordCount,
              targetChapterCount: project.targetChapterCount,
            }),
          },
        ],
      },
      StoryBibleDraftSchema,
    );

    const generatedAt = new Date().toISOString();
    const generatedDraft = result.data;
    const generatedDraftJson = asJson(generatedDraft);
    const premise = asText(generatedDraft.premise, ["logline", "coreConflict", "summary"]);
    const theme = asText(generatedDraft.theme);
    const tone = asText(generatedDraft.tone, ["overall", "description"]);
    const pointOfView = asText(generatedDraft.pointOfView, ["primary", "description"]);
    const endingDirection = asText(generatedDraft.endingDirection, ["direction", "description"]);
    const updated = await db.storyBible.update({
      where: { projectId: id },
      data: {
        premise,
        theme,
        tone,
        pointOfView,
        forbiddenExpressions: asConstraints(generatedDraft.constraints),
        createdBy: "AI",
        status: "SUGGESTED",
        styleGuide: {
          ...styleGuide,
          generatedAt,
          generatedModel: result.model ?? null,
          generatedCharacters: generatedDraft.characters,
          endingDirection,
          generatedDraft: generatedDraftJson,
        },
      },
    });

    return NextResponse.json({ storyBible: updated, usage: result.usage });
  } catch (error) {
    console.error("[story-bible] generation failed", error);
    return NextResponse.json(
      { code: "AI_GENERATION_FAILED", error: "故事圣经生成失败，请检查 AI 设置和模型服务。" },
      { status: 502 },
    );
  }
}
