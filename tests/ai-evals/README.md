# AI Eval 固定测试集

这里存放不依赖模型、数据库或测试框架的小说连贯性评测夹具。每个 JSON 文件是一条独立案例，包含：

- `canon.facts`：写作前已确认的事实。`locked: true` 表示不可被 AI 默默覆盖；`validFromChapter` 用来表达事实何时生效。
- `chapter`：待审校章节编号和正文片段。
- `expected`：期望审校器报告的矛盾类型、最低严重度和正文证据词。

当前固定集覆盖人物状态、时间线、地点瞬移、物品状态、伏笔提前揭晓、信息边界、世界规则、人物动机、视角漂移和重复冲突，并包含两条无矛盾控制样本，用于观察误报。

## 运行

无需安装额外依赖：

```bash
node tests/ai-evals/run.mjs
```

这会校验所有夹具的结构、ID 唯一性以及证据词确实出现在章节文本中。模型或质量检查 API 接入后，可把结果写成下列格式，再运行评测：

大纲接口还有一组不依赖数据库或网络的契约测试。它直接复用生产环境的
`OutlineDraftSchema`，并检查生成任务进度事件和详情摘要的字段、计数及终态：

```bash
node --experimental-strip-types tests/ai-evals/outline-contract.mts
```

这组检查约束异步任务应保持的状态集合（`QUEUED`、`RUNNING`、`SUCCEEDED`、`FAILED`、`CANCELLED`）、单调进度和详情读取的计数一致性。当前大纲接口已通过 `jobId` 提供轮询进度；该测试仍是无网络契约测试，不伪装成端到端测试。

```json
{
  "results": [
    {
      "caseId": "location-001",
      "issues": [
        {
          "type": "location",
          "severity": "high",
          "evidence": "沈璃在没有任何行军描写的情况下出现在南港",
          "conflict": "第7章锁定位置为北境哨站",
          "suggestion": "补充移动过程或改回北境哨站"
        }
      ]
    }
  ]
}
```

```bash
node tests/ai-evals/run.mjs --results ./tmp/ai-eval-results.json
node tests/ai-evals/run.mjs --results ./tmp/ai-eval-results.json --strict
```

评测器会输出硬性矛盾检出率和控制样本误报率。`--strict` 模式按 MVP 门槛要求硬性矛盾检出率至少 90%，且控制样本误报率不超过 10%；默认模式只报告结果，方便在模型调试阶段使用。结果中的 `type` 应使用服务端 `QualityCheckSchema` 的枚举值：`canon`、`timeline`、`location`、`character`、`causality`、`pacing`、`style` 或 `foreshadowing`。

## 扩展规则

新增案例时复制一个 JSON 文件并保证 `id` 全局唯一。硬性矛盾应将 `expected.hardContradiction` 设为 `true`，至少声明一个 `issueTypes` 和 `severityAtLeast`；控制样本设为 `false` 且 `issueTypes`、`evidenceTokens` 为空。评测器只负责固定集契约和结果评分，不替代真正的 AI 连贯性检查器。
