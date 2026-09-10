# xpi-diagram

**English**: [README.md](./README.md)

> Pi Coding Agent 的轻量、低干扰扩展（`pi-extension` / `pi-package`）。

> 无构建步骤、直接加载 TypeScript 源码、严格质量门禁。

[快速开始](#快速开始) · [命令列表](#命令列表) · [开发命令](#开发命令) · [目录结构](#目录结构) · [设计规范](#设计规范)

---

## 项目简介

**`@fx-pi/xpi-diagram`** 是一个运行在 Pi 主进程内的 Pi Coding Agent 扩展。

设计要点：

- **无构建步骤**：Pi 直接加载 `./src/index.ts` TS 源码，不提交编译产物（`dist/` 或 bundle）。
- **Pi 原生 UI**：使用 `ctx.ui.*` 与 `@earendil-works/pi-tui` 进行渲染，绝不劫持终端或引入竞争性终端库。
- **零重度运行时依赖**：依赖宿主提供的 API 与严格类型定义（`@sinclair/typebox`、TypeScript strict）。
- **严格质量门禁**：TypeScript strict + Biome + Vitest，任何修改必须三绿通过。


## 图表审阅流程

- `create_diagram` 会先校验并保存版本，再打开所配置的预览。两种预览模式均为只读：Glimpse 窗口与系统浏览器只负责展示已保存图表，版本选择、确认与反馈全部在 Pi 编辑器面板完成。确认即接受该版本，取消或关闭不代表确认。工具结果包含审阅状态、版本和完整反馈原文。
- Agent 根据表达目的选择图表类型与布局，并遵循选定的 `diagram-design` 类型规范及其可访问性、连接线、复杂度、颜色、字体、密度和动效规则。Glimpse 窗口主题与图表样式分开，不新增样式选择器，也不自行创建品牌 profile。
- `/xpi-diagram` 负责预览配置（启用/禁用，预览模式 `glimpse`/`browser`），并可重开最近保存的图表，但命令本身不等待审阅。浏览器预览通过平台原生命令（`open`/`xdg-open`/`start`）打开已保存 HTML 并立即返回。没有待返回工具时，反馈由宿主在空闲时投递、忙碌时 steer；预览关闭、无界面、平台不支持或启动失败时直接返回已保存结果，图表文件不会丢失。
## 技术栈

- [Node.js](https://nodejs.org/) + [pnpm](https://pnpm.io/)，版本锁定在 [`mise.toml`](./mise.toml)
- [Pi Coding Agent API](https://github.com/earendil-works/pi-coding-agent) (`@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`)
- TypeScript strict（`target: ES2024`，`module: NodeNext`）
- [Biome](https://biomejs.dev/)（lint + format）
- [Vitest](https://vitest.dev/)（测试运行器）

## 快速开始

### 环境准备

使用 [mise](https://mise.jdx.dev/) 安装锁定版本的 Node.js 与 pnpm：

```bash
mise install
```

### 安装依赖

```bash
pnpm install
```

### 冒烟测试

直接将扩展加载到 Pi 中进行快速测试：

```bash
pi -e ./src/index.ts
```

### 本地日常开发

软链到本地 Pi 扩展目录以进行实时测试：

```bash
ln -s "$(pwd)" ~/.pi/agent/extensions/xpi-diagram
```

在运行中的 Pi 会话中，输入 `/reload` 即可热载本扩展。

## 命令列表

| 命令 | 说明 |
| :--- | :--- |
| `/xpi-diagram` | 配置图表预览（启用/禁用，`glimpse`/`browser` 模式）或重开最近的图表 |

## 开发命令

| 命令 | 说明 |
| :--- | :--- |
| `pnpm typecheck` | `tsc --noEmit`，严格类型检查 |
| `pnpm -w run lint` | Biome 全仓代码与格式检查 |
| `pnpm test` | Vitest 测试运行器 (`vitest run --passWithNoTests`) |

提交前三条门禁（`typecheck`、`lint`、`test`）必须全部通过。

## 目录结构

```
.
├── mise.toml / package.json / biome.jsonc / tsconfig.json / pnpm-workspace.yaml
├── AGENTS.md / CONTEXT.md / DESIGN.md
├── docs/                      # Git 工作流与仓库约束
└── src/
    └── index.ts               # 扩展入口 (register 函数)
```

## 设计规范

本项目遵循 [Google Labs DESIGN.md 规范](https://github.com/google-labs-code/design.md)，并专门为终端 TUI 场景定制。详见 [`DESIGN.md`](./DESIGN.md) 查看终端设计 Token（颜色、等宽字阶、间距网格与组件定义）。

## 约定与约束

- **术语表**：[`CONTEXT.md`](./CONTEXT.md) 定义了本仓库的统一语言，代码、文档与提交中禁止术语漂移。
- **Git 纪律**：提交/推送/发布前先读 [`docs/GIT-WORKFLOW.md`](./docs/GIT-WORKFLOW.md) 与 [`docs/GITHUB-GUARD.md`](./docs/GITHUB-GUARD.md)。默认不直推 `main`，使用小粒度 Conventional Commits。
- **Token 安全**：密钥与 Token 绝不写入代码、日志、示例或文档。
