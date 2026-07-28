import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const service = await import(path.resolve(here, "../../src/server/modules/outline/service.ts"));
const schemas = await import(path.resolve(here, "../../src/server/ai/schemas.ts"));

const {
  allocateVolumeChapterCounts,
  assertOutlineIntegrity,
  ensureExactVolumeChapters,
  normalizeOutlineSkeleton,
} = service;
const { OutlineBookSkeletonSchema, OutlineVolumeDraftSchema } = schemas;

interface NormalizedVolume {
  title: string;
  goal: string;
  climax: string;
  endingCondition: string;
  chapterCount: number;
  chapterStart: number;
  chapterEnd: number;
}

interface ContractChapter {
  order: number;
  title: string;
  objective: string;
  conflict: string;
  result: string;
  requiredChange: string;
  estimatedWords?: number;
}

interface ContractVolume {
  title: string;
  goal: string;
  climax: string;
  endingCondition: string;
  chapters: ContractChapter[];
}

function canonicalChapter(order: number) {
  return {
    order,
    title: `第${order}章`,
    objective: `推进第${order}章目标`,
    conflict: `解决第${order}章冲突`,
    result: `形成第${order}章结果`,
    requiredChange: `记录第${order}章状态变化`,
    estimatedWords: 2_500,
  };
}

function checkStagedSchemas() {
  const canonicalSkeleton = OutlineBookSkeletonSchema.parse({
    ending: "主角完成最终选择，主线冲突得到收束。",
    volumes: Array.from({ length: 5 }, (_, index) => ({
      number: index + 1,
      title: `第${index + 1}卷`,
      goal: `完成第${index + 1}阶段目标`,
      climax: `第${index + 1}卷核心冲突爆发`,
      endingCondition: `第${index + 1}阶段状态发生不可逆变化`,
      chapterCount: 20,
    })),
  });
  assert.equal(canonicalSkeleton.volumes.length, 5, "canonical skeleton must retain all volumes");
  assert.equal(canonicalSkeleton.volumes[4]?.chapterCount, 20);

  const compatibleSkeleton = OutlineBookSkeletonSchema.parse({
    bookPlan: {
      conclusion: "兼容字段也能给出明确结局。",
      parts: [{
        volumeNumber: "1",
        name: "启程卷",
        purpose: "让主角离开故乡",
        turningPoint: "故乡遭遇袭击",
        resolution: "主角踏上旅途",
        plannedChapterCount: "20",
      }],
    },
  });
  assert.deepEqual(compatibleSkeleton.volumes[0], {
    number: 1,
    title: "启程卷",
    goal: "让主角离开故乡",
    climax: "故乡遭遇袭击",
    endingCondition: "主角踏上旅途",
    chapterCount: 20,
  });
  assert.equal(compatibleSkeleton.ending, "兼容字段也能给出明确结局。");

  const canonicalVolume = OutlineVolumeDraftSchema.parse({ chapters: [canonicalChapter(1)] });
  assert.equal(canonicalVolume.chapters[0]?.requiredChange, "记录第1章状态变化");

  const compatibleVolume = OutlineVolumeDraftSchema.parse({
    volumePlan: {
      chapterPlans: [{
        chapterNumber: "21",
        name: "旧门重开",
        purpose: "进入第二阶段",
        obstacle: "守门人拒绝放行",
        outcome: "主角获得临时通行资格",
        required_changes: "阵营关系由中立转为合作",
        plannedWordCount: "2800",
      }],
    },
  });
  assert.deepEqual(compatibleVolume.chapters[0], {
    order: 21,
    title: "旧门重开",
    objective: "进入第二阶段",
    conflict: "守门人拒绝放行",
    result: "主角获得临时通行资格",
    requiredChange: "阵营关系由中立转为合作",
    estimatedWords: 2_800,
  });

  return canonicalSkeleton;
}

function checkOneHundredChapterContract(canonicalSkeleton: ReturnType<typeof checkStagedSchemas>) {
  const chapterCounts = allocateVolumeChapterCounts(100);
  assert.deepEqual(chapterCounts, [20, 20, 20, 20, 20], "100 chapters should form five balanced volumes");
  assert.equal(chapterCounts.reduce((sum, count) => sum + count, 0), 100);

  const normalized = normalizeOutlineSkeleton(canonicalSkeleton, chapterCounts);
  assert.deepEqual(normalized.volumes.map((volume: NormalizedVolume) => volume.chapterStart), [1, 21, 41, 61, 81]);
  assert.deepEqual(normalized.volumes.map((volume: NormalizedVolume) => volume.chapterEnd), [20, 40, 60, 80, 100]);
  assert.equal(normalized.volumes[0]?.chapterStart, 1);
  assert.equal(normalized.volumes.at(-1)?.chapterEnd, 100);
  for (let index = 1; index < normalized.volumes.length; index += 1) {
    assert.equal(
      normalized.volumes[index]?.chapterStart,
      (normalized.volumes[index - 1]?.chapterEnd ?? 0) + 1,
      "normalized volume ranges must be globally continuous",
    );
  }

  const volumes: ContractVolume[] = normalized.volumes.map((volume: NormalizedVolume) => {
    // Simulate a compatible model returning local/incorrect order values and
    // one chapter too few. Production normalization must renumber and repair.
    const modelChapters = Array.from(
      { length: volume.chapterCount - 1 },
      (_, index) => canonicalChapter(index + 1),
    );
    const exact = ensureExactVolumeChapters(volume, modelChapters, 2_500);
    assert.equal(exact.chapters.length, volume.chapterCount);
    assert.equal(exact.repairedCount, 1);
    assert.equal(exact.truncatedCount, 0);
    return {
      title: volume.title,
      goal: volume.goal,
      climax: volume.climax,
      endingCondition: volume.endingCondition,
      chapters: exact.chapters,
    };
  });

  const allChapters = volumes.flatMap((volume: ContractVolume) => volume.chapters);
  assert.equal(allChapters.length, 100, "five normalized volumes must contain exactly 100 chapters");
  assert.deepEqual(
    allChapters.map((chapter: ContractChapter) => chapter.order),
    Array.from({ length: 100 }, (_, index) => index + 1),
    "ensureExactVolumeChapters must produce one continuous global sequence",
  );

  const completeDraft = { ending: normalized.ending, volumes };
  assert.doesNotThrow(() => assertOutlineIntegrity(completeDraft, 100));

  const missingChapter = structuredClone(completeDraft);
  missingChapter.volumes[2]?.chapters.pop();
  assert.throws(
    () => assertOutlineIntegrity(missingChapter, 100),
    /章节总数与目标章节数不一致/,
    "a 99-chapter outline must not be marked complete",
  );

  const brokenSequence = structuredClone(completeDraft);
  const brokenChapter = brokenSequence.volumes[3]?.chapters[0];
  assert.ok(brokenChapter);
  brokenChapter.order = 999;
  assert.throws(
    () => assertOutlineIntegrity(brokenSequence, 100),
    /章节编号不连续/,
    "an outline with a numbering gap must not be marked complete",
  );
}

const canonicalSkeleton = checkStagedSchemas();
checkOneHundredChapterContract(canonicalSkeleton);
console.log("Outline target contract passed: staged schemas, five volume ranges, exact 100-chapter integrity.");
