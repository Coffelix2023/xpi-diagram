# 任务备注 — add-diagram-visual-explanations

## 1. 打包资源与契约(Package Resources and Contracts)

- [ ] 1.1 将选定的 `diagram-design` skill、参考文档、模板及所需许可声明加入 Pi package manifest;验证 Pi 能发现该 skill,且包内路径无需复制无关的宿主插件文件即可正确解析。
- [ ] 1.2 为受支持的图表类型、HTML 产物、校验状态、图表 ID、版本号与审查事件定义 TypeBox schema 与共享结果契约;验证 `pnpm typecheck` 与 schema 拒绝测试通过。

## 2. 图表生成与存储(Diagram Generation and Storage)

- [ ] 2.1 注册面向 Agent 的图表 tool,附带 `promptSnippet` 与 `promptGuidelines`;验证 Pi 正确暴露该 tool,且其指引说明 Agent 何时应选择图表、如何套用 `diagram-design`,以及何时应改用普通文字或表格。
- [ ] 2.2 实现图表产物校验:可访问的 SVG 元数据、安全的引用、脚本限制、受支持的类型元数据,以及复杂度上限;验证代表性合法 fixture 通过,畸形或不安全 fixture 失败并给出可操作的诊断信息。
- [ ] 2.3 在 `.pi/diagram/<safe-id>/vN.html` 下实现项目作用域的版本化存储,采用原子写入且不覆盖;验证路径穿越 ID 被拒绝或归一化,版本号递增,且文件始终留在项目目录内。
- [ ] 2.4 返回有界的 tool 结果,包含图表 ID、类型、版本、路径、校验状态、简化说明与预览状态;验证大体量 HTML 不会被回显进 Pi transcript。

## 3. Glimpse 审查面板(Glimpse Review Panel)

- [ ] 3.1 为 Glimpse 添加可选的运行时加载与能力检测,覆盖 `ctx.hasUI` 与受支持的 Pi 模式;验证缺少 Glimpse、headless 模式以及 print/json 模式均不阻断生成,并返回可用的文件路径。
- [ ] 3.2 依照 `glimpse-design` 规范构建 Glimpse 审查面板:原生尺寸、自适应外观、无障碍访问、键盘控制、reduced motion 与动态内容转义;验证面板渲染 HTML 产物时不会执行图表内文本。
- [ ] 3.3 实现固定的审查事件协议:确认(confirm)、请求修改(request changes)、提交反馈(submit feedback)、版本选择与关闭(close);验证非法操作、超长反馈与过期版本被拒绝且不破坏状态。
- [ ] 3.4 实现同窗口版本更新与审查状态持久化;验证 Confirm 记录所选版本且不触发 Agent 轮次、Close 不确认、Submit feedback 将图表 ID 与版本发送至当前活跃的 Pi 会话。

## 4. 配置命令(Configuration Command)

- [ ] 4.1 实现 `.pi/xpi-diagram.json` 的 fail-closed 读取与写入,预览默认开启,并强制执行项目信任(Project Trust);验证文件缺失、格式错误、版本不支持与非受信项目四种情形均回落到安全默认值。
- [ ] 4.2 将 `/xpi-diagram` 升级为原生 Pi 的配置与最新图表命令;验证用户无需手动编辑 JSON 即可查看状态、切换 Glimpse 自动预览、重新打开最近保存的图表。
- [ ] 4.3 将配置应用于自动预览,同时保持文件生成本身独立;验证禁用预览时产物仍被保存,启用预览时校验通过后自动打开 Glimpse。

## 5. 验证与文档(Verification and Documentation)

- [ ] 5.1 为存储、校验、配置、tool 结果与面板协议添加聚焦测试;验证 `pnpm test` 通过。
- [ ] 5.2 运行代表性的 `diagram-design` fixture 检查及 package 级 lint/type 检查;验证 `pnpm typecheck`、`pnpm -w run lint` 与 `pnpm test` 全部通过。
- [ ] 5.3 运行 TUI 集成冒烟测试,覆盖生成、`.pi/diagram/` 持久化、Glimpse 自动预览、面板内确认、反馈往返与版本更新;单独验证 headless 回退,并记录尚无平台覆盖的项。

## 5.3 验证记录
- 已通过 `src/integration.test.ts` 的 TUI 链路冒烟测试：工具注册、生成与版本持久化、自动 Glimpse 预览、同窗口版本更新、确认、反馈往返。
- 已通过现有 headless/print/json/缺失 Glimpse 回退测试；当前环境未执行真实 GUI 窗口人工操作，平台覆盖限于 Vitest 模拟窗口与 Pi CLI 扩展加载冒烟。
