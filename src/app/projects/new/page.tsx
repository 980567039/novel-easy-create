"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, BookOpen, Loader2, Sparkles } from "lucide-react";

interface OnboardingAnswers {
  premise: string;
  protagonist: string;
  protagonistDesire: string;
  mainObstacle: string;
  failureCost: string;
  endingDirection: string;
}

interface ProjectForm {
  title: string;
  genre: string;
  targetWordCount: string;
  targetChapterCount: string;
  answers: OnboardingAnswers;
}

const initialForm: ProjectForm = {
  title: "",
  genre: "",
  targetWordCount: "100000",
  targetChapterCount: "100",
  answers: {
    premise: "",
    protagonist: "",
    protagonistDesire: "",
    mainObstacle: "",
    failureCost: "",
    endingDirection: "",
  },
};

const stepCopy = [
  { title: "先给故事一个位置", description: "不用想专业术语，先告诉我们你想写什么。" },
  { title: "认识你的主角", description: "主角想要什么，决定故事会往哪里走。" },
  { title: "为结局留出空间", description: "提前知道代价和方向，故事更容易写完。" },
];

function Field({
  label,
  hint,
  value,
  onChange,
  multiline = false,
  placeholder,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  placeholder: string;
}) {
  const className = "w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-slate-900 outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100";
  return (
    <label className="block space-y-2">
      <span className="flex items-baseline justify-between gap-3 text-sm font-semibold text-slate-800">
        <span>{label}</span>
        {hint && <span className="text-xs font-normal text-slate-400">{hint}</span>}
      </span>
      {multiline ? (
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          rows={4}
          className={`${className} resize-none leading-relaxed`}
        />
      ) : (
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className={className}
        />
      )}
    </label>
  );
}

export default function NewProjectPage() {
  const router = useRouter();
  const [form, setForm] = useState<ProjectForm>(initialForm);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const currentStep = stepCopy[step];
  const canContinue = useMemo(() => {
    if (step === 0) return form.title.trim().length >= 2 && form.answers.premise.trim().length >= 10;
    if (step === 1) {
      return form.answers.protagonist.trim().length >= 2 && form.answers.protagonistDesire.trim().length >= 4;
    }
    return form.answers.mainObstacle.trim().length >= 4 && form.answers.endingDirection.trim().length >= 2;
  }, [form, step]);

  const updateAnswer = (key: keyof OnboardingAnswers, value: string) => {
    setForm((current) => ({ ...current, answers: { ...current.answers, [key]: value } }));
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (step < stepCopy.length - 1) {
      setStep((current) => current + 1);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title.trim(),
          genre: form.genre.trim() || undefined,
          targetWordCount: Number(form.targetWordCount) || undefined,
          targetChapterCount: Number(form.targetChapterCount) || undefined,
          onboardingAnswers: form.answers,
        }),
      });
      const body = (await response.json()) as { project?: { id: string }; error?: string };
      if (!response.ok || !body.project?.id) {
        throw new Error(body.error ?? "项目创建失败，请稍后重试");
      }
      router.push(`/projects/${body.project.id}`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "项目创建失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-900 sm:px-8">
      <div className="mx-auto max-w-3xl">
        <button
          type="button"
          onClick={() => router.push("/")}
          className="mb-8 inline-flex items-center gap-2 text-sm font-medium text-slate-500 transition hover:text-indigo-600"
        >
          <ArrowLeft size={16} /> 返回首页
        </button>

        <div className="mb-8 flex items-start gap-4">
          <div className="rounded-2xl bg-indigo-100 p-3 text-indigo-600"><BookOpen size={26} /></div>
          <div>
            <p className="mb-1 text-sm font-semibold tracking-wide text-indigo-600">新建长篇小说</p>
            <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{currentStep.title}</h1>
            <p className="mt-2 text-slate-500">{currentStep.description}</p>
          </div>
        </div>

        <div className="mb-8 flex gap-2" aria-label="创建进度">
          {stepCopy.map((item, index) => (
            <div key={item.title} className="flex-1">
              <div className={`mb-2 h-1.5 rounded-full ${index <= step ? "bg-indigo-500" : "bg-slate-200"}`} />
              <span className={`text-xs ${index === step ? "font-bold text-indigo-600" : "text-slate-400"}`}>0{index + 1}</span>
            </div>
          ))}
        </div>

        <form onSubmit={submit} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-9">
          {step === 0 && (
            <div className="space-y-6">
              <Field
                label="小说名称"
                value={form.title}
                onChange={(value) => setForm((current) => ({ ...current, title: value }))}
                placeholder="例如：雾城来信"
              />
              <Field
                label="一句话描述故事"
                hint="至少说清楚主角和他面对的事情"
                multiline
                value={form.answers.premise}
                onChange={(value) => updateAnswer("premise", value)}
                placeholder="例如：一个能听见旧物记忆的女孩，为了寻找失踪的哥哥，卷入一场被全城掩盖的火灾。"
              />
              <Field
                label="题材或类型"
                hint="可选"
                value={form.genre}
                onChange={(value) => setForm((current) => ({ ...current, genre: value }))}
                placeholder="例如：悬疑、现代、轻科幻"
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="预计总字数"
                  value={form.targetWordCount}
                  onChange={(value) => setForm((current) => ({ ...current, targetWordCount: value.replace(/[^0-9]/g, "") }))}
                  placeholder="100000"
                />
                <Field
                  label="预计章节数"
                  value={form.targetChapterCount}
                  onChange={(value) => setForm((current) => ({ ...current, targetChapterCount: value.replace(/[^0-9]/g, "") }))}
                  placeholder="100"
                />
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-6">
              <Field
                label="主角是谁？"
                multiline
                value={form.answers.protagonist}
                onChange={(value) => updateAnswer("protagonist", value)}
                placeholder="不用写完整人设，说说他现在是什么人。"
              />
              <Field
                label="主角最想得到什么？"
                multiline
                value={form.answers.protagonistDesire}
                onChange={(value) => updateAnswer("protagonistDesire", value)}
                placeholder="这是故事持续推进的发动机。"
              />
              <div className="rounded-2xl bg-indigo-50 p-4 text-sm leading-relaxed text-indigo-800">
                <Sparkles className="mb-2" size={18} />
                你不需要现在就决定所有配角。系统会先抓住主角的目标，再帮你生成一版可以修改的故事圣经。
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-6">
              <Field
                label="谁或什么会阻止主角？"
                multiline
                value={form.answers.mainObstacle}
                onChange={(value) => updateAnswer("mainObstacle", value)}
                placeholder="可以是一个人、一种制度、一个秘密，或者主角自己的弱点。"
              />
              <Field
                label="如果失败，主角会失去什么？"
                multiline
                value={form.answers.failureCost}
                onChange={(value) => updateAnswer("failureCost", value)}
                placeholder="代价越具体，冲突越有力量。"
              />
              <Field
                label="你希望故事最后是什么感觉？"
                multiline
                value={form.answers.endingDirection}
                onChange={(value) => updateAnswer("endingDirection", value)}
                placeholder="例如：圆满但有代价、真相揭开后留下余味、主角完成成长。"
              />
            </div>
          )}

          {error && <p className="mt-6 rounded-xl bg-red-50 px-4 py-3 text-sm leading-relaxed text-red-700">{error}</p>}

          <div className="mt-8 flex items-center justify-between gap-4 border-t border-slate-100 pt-6">
            <button
              type="button"
              disabled={step === 0 || submitting}
              onClick={() => setStep((current) => Math.max(0, current - 1))}
              className="rounded-xl px-4 py-3 text-sm font-semibold text-slate-500 transition hover:bg-slate-100 disabled:invisible"
            >
              上一步
            </button>
            <button
              type="submit"
              disabled={!canContinue || submitting}
              className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {submitting ? <Loader2 size={17} className="animate-spin" /> : step === stepCopy.length - 1 ? <Sparkles size={17} /> : <ArrowRight size={17} />}
              {submitting ? "正在创建..." : step === stepCopy.length - 1 ? "创建我的小说" : "继续"}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
