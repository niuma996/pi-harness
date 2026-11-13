# @taco-ai/pi-harness

[English](./README.md) | 简体中文

把 Pi 1.0 从 `@earendil-works/pi-agent-core` 中删除的实验性 **AgentHarness** 抽取为独立包，
让使用方在运行 **最新版** pi 基础包的同时，保留 0.99.2 的 harness 与 JSONL 会话线。

> **本包不是 Earendil Works 官方包。**

## 为什么需要这个包

Pi 1.0 删掉了 harness，改由 `@earendil-works/pi-durable` 取代。但 `pi-durable` 目前仍标记为
不稳定 —— 它的 API 会在版本之间发生变动。想要离开 0.99.2 harness 线的应用，眼下**没有**
一个稳定的目标可以迁移过去。

本包就是为这段空窗期准备的过渡层：让旧接口继续跑在**当前**基础包上，使迁移到
`pi-durable` 成为一件你可以排期去做的事，而不是被上游删除逼着立刻做的事。在
`pi-durable` 去掉不稳定标记、转为稳定 API 之前，本包会持续维护：针对新基础包的构建失败
会被修复，会话格式保持逐字节兼容，磁盘上的会话不需要重写。

**预期在 `pi-durable` 稳定之后本包即行退出。** 这是一条带退出条件的兼容性线，而不是一个
长期 fork。当 `pi-durable` 稳定下来，使用方应当迁移过去，本包也应停止接受新工作。

## 快速开始

需要 Node.js **22.19+**。本包仅支持 ESM；pi 基础包是 peer 依赖，需要由你的应用提供。
首个版本发布后可直接安装：

```bash
pnpm add @taco-ai/pi-harness
```

在此之前，请在本地检出并构建，再以 workspace 或 path 依赖的方式引入：

```bash
pnpm install
pnpm build
```

切换过来本质上只是改 import。harness 接收 pi-ai `Models` 实例和模型：

```ts
import { createModels } from "@earendil-works/pi-ai"; // 在这里注册你的 provider
import { AgentHarness, BACKGROUND_CONTEXT } from "@taco-ai/pi-harness";
import { NodeExecutionEnv } from "@taco-ai/pi-harness/harness/env/nodejs";
import { JsonlSessionRepo } from "@taco-ai/pi-harness/harness/session";

const models = createModels(); // 你应用里已配置好的 Models 实例
const model = models.getModel("anthropic", "claude-opus-4-7");
if (!model) throw new Error("请先配置 provider 与模型");

const fileSystem = new NodeExecutionEnv({ cwd: process.cwd() });
const repo = new JsonlSessionRepo({ fileSystem, sessionsRoot: ".sessions" });
const session = await repo.create({ cwd: process.cwd() }, BACKGROUND_CONTEXT);

const { harness } = await AgentHarness.create({ session, models, model }, BACKGROUND_CONTEXT);
const lane = await harness.lane("main", BACKGROUND_CONTEXT);
await lane.prompt("Hello", undefined, BACKGROUND_CONTEXT);
```

## 来源

抽取自 [`earendil-works/pi`](https://github.com/earendil-works/pi) 的 **`v0.99.2`** 标签，
对应包为 `@earendil-works/pi-agent-core`（`packages/agent`）。上游为 MIT，© Mario Zechner ——
见 `LICENSE.upstream`。内置的 shim 在 `src/shims/` 中有标注。

Pi 1.0 从 `pi-agent-core` 中移除了 `AgentHarness`、session/storage 层、compaction、skills、
prompt templates 以及整个 `./harness/*` 接口，改由 `pi-durable` 取代。本包在不依赖已停更
版本的前提下，让旧接口继续可用。

## 收录范围

| 内容 | 是否在本包中 |
|---|---|
| `AgentHarness`、agent loop、lanes、hooks | 是 |
| `JsonlSessionRepo` 及 session/storage 层 | 是 |
| Compaction、branch summarization | 是 |
| Skills、prompt templates、工具（`read`/`write`/`edit`） | 是 |
| Telemetry span 与 schema —— 见 [`docs/telemetry-schema.md`](./docs/telemetry-schema.md) | 是 |
| `NodeExecutionEnv` 及其他 execution env | 是 |
| pico3（实验性 harness） | 是 |
| 你自己的 session/permission/protocol 层 | 否 —— 留在你的应用里 |

导出映射与旧 `pi-agent-core` 的子路径一一对应（`.`、`./node`、`./harness/context`、
`./harness/session`、`./harness/env/nodejs`、`./harness/runtime/reducer`、
`./harness/session/testing`、`./experimental/pico3`），因此切换过来只是改 import，
不需要重新设计。

## 依赖

pi 基础包是 **peer** 依赖，精确固定为经过验证的版本组合：

```jsonc
"peerDependencies": {
  "@earendil-works/pi-ai": "1.5.2",
  "@earendil-works/chord": "1.5.2",
  "@earendil-works/pi-telemetry": "1.5.2"
}
```

0.2.0 版本要求 pi-ai、chord 和 pi-telemetry 为经过验证的 1.5.2，请将三个 peer 保持在同一组版本。
`withTelemetryContext()` 继续接受 recorder 或活动 span；活动 span 可与 chord 的
`withTelemetry()` 互通。使用 recorder 发起模型调用时，会创建覆盖响应消费阶段的
`pi.harness.model_request` 父 span。自实现 chord `Context` 的调用方需提供 `telemetry` 属性。
实验性 pico3 的持久化 system message 工具参数必须为 JSON 对象；`Stored<T>` 仍使用 chord
原有的 `JsonRepresentation<T>` 投影。已有 JSONL 文件无需迁移。实验性 `experimental/pico3` 的 Chord 视图桥现在接受宿主提供的同步发布器，不再暴露 Chord v1 的 `ReplicatedState` 类型。

刻意**不**依赖 `@earendil-works/pi-agent-core`（任何版本都不依赖 —— 1.x 已无 harness），
也**不**依赖 `@earendil-works/pi-durable`（那是另一条迁移路线）。

这里冻结的是 **harness/session API 与 JSONL 格式**。**模型栈通过经过验证的 harness 发版跟随上游**；
请同步升级本包和它声明的 Pi peer 版本，获取模型、鉴权及 provider 修复。其他版本（包括
1.5.3 这样的新补丁）不满足精确 peer 要求，npm 可能以 `ERESOLVE` 拒绝安装。
这是有意阻挡未经验证的上游 API 变化。

## 实验性 Pico3 视图迁移

Chord 1.5.1 移除了 v1 的 `replicatedState()` API。`attachChordView()` 仍接受工厂函数，
但返回值现在需实现导出的 `ConversationViewPublisher`：`value` 为当前
`PublishedConversationView`，`change(context, mutate)` 原子发布一次同步的
`Draft<PublishedConversationView>` 修改。发布器应保留旧快照，并在修改回调抛错时丢弃该次修改。

视图桥会保留工厂返回值的具体类型，包括宿主自己的订阅方法；
`createPicoConversationService()` 同样保留传入视图的类型。显式标注
`ChordViewBridge` / `PicoConversationService` 时只暴露最小视图契约；需要订阅方法时，
请将发布器类型作为泛型参数传入。关闭桥会停止 Pico watch，发布器的生命周期仍由宿主管理。

此改动调整的是实验性发布边界，未内置 Chord v2 host 适配器。可以直接使用内置原子发布器：

```ts
import { attachChordView, createConversationViewPublisher } from "@taco-ai/pi-harness/experimental/pico3";

const bridge = await attachChordView(conversation, createConversationViewPublisher, context);
const unsubscribe = bridge.view.subscribe((view, context, delivery) => {
  // 观察后续更新；当前快照为 bridge.view.value。
});
```

`createConversationViewPublisher()` 会回滚失败修改并保留旧快照。订阅按序接收后续更新，
回调同步启动，异步结果不阻塞发布；监听器失败交给可选的 `onError` 回调。
桥接层信任自定义发布器实现同样的原子契约：如果修改抛错后仍保留部分状态，
桥关闭时可能留下不一致的视图。

默认类型的 `PicoConversationService.view.value` 现在为 `PublishedConversationView | undefined`；
读取 entries 前需要判空，或通过推断/泛型参数保留具体发布器类型。参见
[0.2.0 发版说明](./docs/releases/0.2.0.md)。主 `AgentHarness` API 和已有 JSONL 文件均无需迁移。

## 内置 shim

harness 需要的两个上游 API 已从基础包中移除。两者都内置在 `src/shims/` 下 —— 除 import
外保持原样 —— 而不是把整个包固定在旧的基础包版本上：

| Shim | 移除自 | 为什么内置是安全的 |
|---|---|---|
| `assistant-message-frame.ts` | `pi-ai@1.3.0` | `AssistantMessageFrame`、`AssistantMessageFrameEncoder` 和 `reduceAssistantMessageFrames` 被以「未使用」为由移除 —— 原因正是 harness 正在被删除。这些 frame 是磁盘会话格式的一部分，重新实现会破坏会话兼容性。属于有意冻结。 |
| `define-service.ts` | `chord@1.x` | Chord 整个丢弃了 facet/service 子系统。`defineService` 原是一个冻结的身份描述符（`Object.freeze({ id, local })`），与 chord 内核没有运行时耦合，本包也没有任何地方把描述符交给 chord host。`chord/object` 中的新 `Service` 是另一个概念，不能作为直接替代。 |

两个 shim 都标注了它们来自哪个上游版本，并注明不要「顺手修好」它们。

## 会话兼容性

JSONL 会话格式与 0.99.2 **逐字节兼容**。既有会话目录可直接打开并继续使用，无需迁移。
`test/harness/memory-conformance.test.ts` 是一致性校验，运行方式：

```bash
pnpm run test:session:conformance
```

## 维护规则

- **只修破坏性问题，不追新功能。** 针对新基础包版本的编译与运行时修复在范围内；
  从 `pi-durable` 移植 harness 功能不在范围内。
- **不要解冻 shim。** 会话兼容性依赖它们。
- **退出条件：** 维护到 `@earendil-works/pi-durable` 去掉不稳定标记、API 转为稳定为止。
  之后这条线不再接受新工作 —— 迁移目标已经就位，使用方应当迁移过去。

## 开发

```bash
pnpm install
pnpm build                              # tsc -p tsconfig.build.json
pnpm test                               # 全量测试（900 通过，1 跳过）
pnpm test:harness                       # harness 测试（810 通过，1 跳过）
pnpm run test:session:conformance       # JSONL 一致性校验
pnpm docs:telemetry                     # 重新生成 docs/telemetry-schema.md
pnpm docs:telemetry:check               # 检查生成文档是否已过期
pnpm check:package                      # 打包并消费所有公开入口
```

`pnpm check:package` 先重新构建 `dist/`，再在隔离消费者中安装 tarball，以 `skipLibCheck: false` 检查所有公开入口，
并执行一次 faux 模型请求。严格检查环境额外安装 `@modelcontextprotocol/sdk@1.30.0`，
同时启用 TypeScript 的 `DOM` 类型库：`pi-ai` 上游的 `@google/genai` 声明无条件引用了
这些可选 SDK 和浏览器类型。需要检查依赖声明的消费者也需提供这些类型前提；仅安装上述 Pi
peer 的纯 Node 类型环境仍会遇到上游 GenAI 声明错误。这些是严格类型检查的环境要求，
不是 harness 新增的运行时要求。

测试从 `node_modules` 解析 `@earendil-works/pi-ai`、`chord` 和 `pi-telemetry` ——
用的是已发布的 1.x 构建，而不是同仓库 monorepo 的源码。这正是本包的要点：
测试套件就是「冻结的 harness 能跑在最新基础包上」的证据。

`docs/telemetry-schema.md` 由导出的 telemetry schema 生成，请用 `pnpm docs:telemetry`
重新生成，不要手工编辑；`docs:telemetry:check` 会校验仓库内的副本是否最新。`docs/` 会随
npm 包一起分发。

## 许可证

MIT。见 `LICENSE`（本包）与 `LICENSE.upstream`（Earendil Works 原始条款）。

[`earendil-works/pi`](https://github.com/earendil-works/pi) 为 MIT © Mario Zechner。

## 参与贡献

安全相关的报告，建议私下发送至 `niuma1024@outlook.com`。其余问题 —— bug、想法、
疑问 —— 欢迎提 GitHub issue。
