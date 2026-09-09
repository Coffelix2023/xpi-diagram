## Context

当前扩展只有 `src/index.ts` 命令骨架，项目直接加载 TypeScript 源码，无构建产物。参考内容位于 `docs/references/diagram-design/`：它提供 Agent 技能、39 类图形参考、HTML/SVG 模板和 Python 自检脚本，但不是可调用的布局引擎。Pi 扩展 API 提供自定义工具、命令、消息发送、项目可信状态和 UI 能力；Glimpse 通过独立原生窗口承载 HTML，并用 `window.glimpse.send()` 将固定事件送回 Node。

## Goals / Non-Goals

**Goals:**

- 复用 `diagram-design` 的语义选择、视觉类型、设计令牌、SVG 可访问性与连线规则。
- 通过 Pi Agent 工具完成图表生成，通过扩展完成保存、校验、预览和反馈闭环。
- 将 HTML 图表安全地保存到 `.pi/diagram/<diagram-id>/vN.html`，不覆盖历史版本。
- 默认在 UI 可用且配置开启时打开 Glimpse 审阅面板，面板内完成确认和修改反馈。
- 让窗口复用同一图表会话，并用版本号阻止旧窗口提交过期操作。
- 对 Glimpse 缺失、无图形环境、非 TUI 模式和项目不可信状态提供明确降级。

**Non-Goals:**

- 不实现新的通用 SVG 自动布局引擎、拖拽编辑器或 Mermaid renderer。
- 不在首版覆盖全部 39 类图形、draw.io/Mermaid 导入或 PNG/SVG 导出命令。
- 不在面板内建立独立聊天系统、执行图表中的脚本或解析图表文本为指令。
- 不把 Glimpse 设为生成成功的必要条件。
- 不自动抓取网站品牌、不自动修改 `diagram-design` 安装目录中的工作副本。

## Decisions

### 1. 以 Pi custom tool 作为生成入口，skill 作为设计知识

注册一个面向 Agent 的图表工具，工具描述和 `promptSnippet` 明确适用场景，`promptGuidelines` 要求先判断表格/段落是否足够、选择五类首版图形、遵循设计预算，并将事实来源与简化说明放入结果。`diagram-design` 作为包内 skill 和精选 reference/template 资源加载，不复制其他宿主的插件命令。

备选方案是只提供 `/xpi-diagram` 命令，缺点是 Agent 不会自然调用；或构建布局引擎，成本高且会与上游设计语言分叉。工具仍接收最终 HTML 内容，因此不需要额外 DSL（领域专用语言）或第二套渲染器。

### 2. 生成、校验、保存、预览分成四个阶段

```text
Tool input
   |
   v
Validate request + diagram id
   |
   v
Validate HTML/SVG artifact
   |
   v
Write vN.html atomically under .pi/diagram
   |
   v
Open/reuse Glimpse review window
```

生成结果只在保存前通过结构校验；校验失败仍保留带失败状态的诊断产物或明确错误记录，但不得打开为可确认版本。目录和文件名由扩展组合，所有路径经 `resolve` 后确认仍位于当前项目的 `.pi/diagram/` 内。

校验优先复用随 `diagram-design` 提供的无第三方依赖 `self_check.py`；扩展侧补充文件大小、目录边界、版本元数据与需要的项目约束。若 Python 自检不可用，按产品选择定义降级策略：基础 HTML/SVG 安全检查可继续，结果标记为未完成完整校验，不得静默声称全部通过。

### 3. Glimpse 面板采用固定消息协议

面板只发送结构化、有限枚举的动作：`confirm`、`request_changes`、`submit_feedback`、`select_version`、`close`。用户反馈以字符串传回并在 Node 侧重新校验长度与版本上下文；HTML 内容只作为显示数据注入，并对动态文本进行 HTML 转义。确认事件记录到会话状态或版本元数据，不触发 Agent turn；反馈事件调用 Pi 的 `sendUserMessage()`，内容包含图表 ID、版本号和反馈正文。

同一图表的后续版本通过现有窗口的 `setHTML()` 更新，窗口只接受当前图表会话的版本。旧窗口或旧版本提交时返回过期提示，不覆盖最新状态。

### 4. 默认开启预览，使用项目级配置控制

默认配置为 `preview: true`，配置文件为 `.pi/xpi-diagram.json`。`/xpi-diagram` 用 Pi 原生 UI 提供状态、开启/关闭预览和重新打开最近图表。配置读取遵循 `ctx.isProjectTrusted()`；不可信项目不读取项目配置。JSON 解析失败使用默认值并报告诊断，未知字段忽略，预览目录不开放为用户可配置路径，减少路径穿越和配置复杂度。

### 5. Glimpse 是可选显示层，不进入核心数据模型

通过可选依赖或运行时动态加载使用 Glimpse，避免在无 GUI 环境中导致扩展加载失败。UI 能力判断使用 `ctx.hasUI`，运行模式判断遵循 Pi 类型。Glimpse 启动失败只影响预览，不影响图表文件。窗口采用 `glimpse-design` 规范：小型原生面板、适配暗色模式、键盘可操作、Escape 关闭/取消、Enter 执行聚焦动作、减弱动态效果时保持静态可读状态、控件和状态拥有可访问名称、动态内容全部转义。

### 6. 版本与确认状态只记录为最小元数据

每个图表目录保存 HTML 版本与一个小型状态文件，记录当前版本、确认版本、更新时间和必要的反馈摘要；不把完整用户反馈重复写入 HTML。写入使用临时文件加重命名，避免半文件被 Glimpse 读取。历史版本只追加，不删除或覆盖。

## Data Flow

```text
Agent -> diagram tool -> validator -> version store
                                  |
                                  v
                         review panel state
                                  |
             +--------------------+--------------------+
             |                                         |
          Confirm                              Feedback submit
             |                                         |
             v                                         v
      record confirmed                       sendUserMessage()
                                                       |
                                                       v
                                                Agent next turn
                                                       |
                                                       v
                                               new version -> setHTML()
```

## Error Handling

- 输入缺少 HTML/SVG 或图表类型不支持：工具返回可读错误，不写入可展示版本。
- 结构或安全校验失败：返回具体规则与文件位置，保存诊断信息，不自动打开确认面板。
- `.pi/diagram/` 无法创建或写入：不调用 Glimpse，返回权限或路径错误。
- Glimpse 模块/宿主不可用：保存成功后返回路径和降级状态。
- 面板反馈对应旧版本：拒绝提交并提示用户切换到当前版本。
- Pi 会话不可接收消息：保留反馈于状态记录，显示待发送状态，不丢弃用户输入。
- 配置损坏或项目不可信：使用默认开启配置，并报告未应用项目配置。

## Testing Strategy

- 单元测试：安全图表 ID、项目目录边界、版本递增、配置解析默认值与 fail-closed（失败即关闭）行为、固定面板事件协议。
- 资源测试：对代表性的架构、流程、时序、状态、实体关系样例运行 `self_check.py`，验证 accessible SVG（可访问 SVG）契约和脚本限制。
- 扩展测试：模拟工具调用、保存失败、Glimpse 缺失、confirm 不触发 turn、feedback 带版本上下文发送。
- 面板测试：验证确认、反馈、关闭、版本导航、键盘操作、动态文本转义与深色/浅色及 reduced-motion（减少动态效果）状态。
- 集成冒烟：在 TUI 中生成一张最小架构图，确认文件落在 `.pi/diagram/`、窗口打开、反馈能回到会话；在 print/json 模式确认不启动窗口且结果可解析。

## Migration Plan

扩展当前只有状态命令，不存在需要迁移的用户数据或旧 API。实现时保留原 `/xpi-diagram` 命令名，将其从状态通知升级为配置与最近图表入口；旧调用仍可执行。首次运行不创建配置文件，只有用户通过命令修改设置时才写入 `.pi/xpi-diagram.json`。回滚时移除新工具和面板调用即可，已生成的 `.pi/diagram/` 文件作为普通用户文件保留。

## Open Questions

- 首版 Glimpse 面板的“确认”是否在确认后自动关闭，还是保留面板显示已确认状态；不影响生成、保存和反馈协议，可在实现阶段按默认 UX 选择。
- 反馈是否需要持久化完整正文，还是只保留状态和发送时间；当前设计只要求不丢失，具体存储形式可在任务实现时确定。
