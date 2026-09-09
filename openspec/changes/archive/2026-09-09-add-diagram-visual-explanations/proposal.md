## Why

Pi Agent 能理解架构、流程和代码关系，但纯文本难以让用户快速验证复杂关系。`diagram-design` 已提供成熟的视觉类型、信息层级、SVG（可缩放矢量图）规范与模板；本变更将这些能力接入 Pi，生成可持久保存、可审阅、可迭代的图表，并让用户直接在 Glimpse 面板内确认或反馈。

## What Changes

- 增加面向 Pi Agent 的图表生成能力，复用 `diagram-design` 的设计规则、模板和校验方法，不另建通用绘图引擎。
- 首版覆盖架构、流程、时序、状态机和实体关系五类图表；默认输出自包含 HTML（网页文档）与内联 SVG。
- 生成的图表规范保存到项目 `.pi/diagram/`，使用图表 ID 与版本目录保留历史版本。
- 生成并通过基础校验后，默认打开 Glimpse 图表审阅面板。
- 在 Glimpse 面板中提供预览、缩放、版本浏览、确认、修改反馈和关闭操作；反馈送回当前 Pi 会话，不要求用户返回终端编辑器选择。
- 增加 `/xpi-diagram` 命令，用于配置 Glimpse 自动预览、重新打开最近图表和查看当前状态。
- Glimpse 不可用时保留文件并降级为终端路径提示；不因预览失败丢失图表。
- 遵循 `glimpse-design` 的原生面板、可访问性、键盘交互、深色/浅色适配和动态内容转义规范。

## Capabilities

### New Capabilities

- `diagram-visualization`: Agent 驱动的图表生成、设计约束、产物保存、版本管理和质量校验。
- `glimpse-diagram-review`: Glimpse 图表审阅面板、确认反馈交互、版本浏览和预览降级。
- `diagram-configuration`: `/xpi-diagram` 命令及项目级预览配置。

### Modified Capabilities

- None.

## Impact

- 扩展入口与新增图表领域模块、资源目录和测试。
- `package.json` 的 Pi manifest 需要加载新增 skill、prompt 或资源；运行时依赖保持最小，Glimpse 作为可选能力处理。
- 项目级配置写入 `.pi/xpi-diagram.json`；图表产物写入 `.pi/diagram/`。
- 需要保留 `diagram-design` 及其第三方图标许可声明，不复制无关宿主插件配置。
- 需要兼容 TUI（终端用户界面）、RPC（远程过程调用）、JSON/print 模式：只有具备 UI 的环境打开 Glimpse，其他模式返回可机器读取的结果。
