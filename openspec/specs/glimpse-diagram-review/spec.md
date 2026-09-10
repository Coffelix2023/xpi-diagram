## Purpose
让用户在只读预览窗口（Glimpse 或系统浏览器）中查看图表，并通过 Pi 编辑器面板完成确认与反馈，使预览展示与审阅交互各司其职。


## Requirements


### Requirement: Valid diagrams open in the read-only preview
The system SHALL open a validated diagram in the configured read-only preview (Glimpse by default) when the runtime has dialog-capable UI and the preview setting is enabled.

#### Scenario: Default preview is enabled
- **WHEN** a validated diagram is saved in a UI-capable runtime
- **THEN** the system SHALL open the diagram in the configured preview mode automatically and show its diagram identifier and version

#### Scenario: Preview is unavailable
- **WHEN** Glimpse cannot be loaded or started, or the browser opener is unsupported or fails
- **THEN** the system SHALL preserve the saved artifact, report the preview failure, and provide its path without failing diagram generation

### Requirement: Review actions stay in the Pi editor panel
The Pi editor panel SHALL drive review via `ctx.ui.*`: version selection, confirm, and feedback entry. The preview window SHALL offer no confirm, feedback, or version actions.

#### Scenario: User confirms a version
- **WHEN** the user confirms a version in the Pi editor panel
- **THEN** the system SHALL record the confirmed diagram identifier and version and close the preview window

#### Scenario: User submits requested changes
- **WHEN** the user enters feedback in the Pi editor panel
- **THEN** the system SHALL send the feedback to the active Pi session with the diagram identifier and version, then keep or update the same review context for the next version

#### Scenario: User closes or cancels
- **WHEN** the user closes the preview window or cancels the panel prompt
- **THEN** the system SHALL close the preview only, retain all saved versions, and SHALL NOT interpret closure or cancellation as confirmation

### Requirement: Review messages are treated as untrusted content
The panel SHALL send only fixed action events plus escaped user feedback to the Pi session, and diagram HTML/SVG content SHALL NOT be executable as panel commands.

#### Scenario: Diagram contains instruction-like text
- **WHEN** generated diagram content includes text resembling a command or prompt instruction
- **THEN** the panel SHALL render it as inert diagram content and SHALL NOT execute or forward it as an action

### Requirement: Panel follows Glimpse design conventions
The panel SHALL follow the `glimpse-design` conventions for native window sizing, adaptive appearance, keyboard interaction, accessibility, dynamic content escaping, motion preferences, and graceful platform fallback.

#### Scenario: Keyboard review
- **WHEN** the panel is focused
- **THEN** Enter SHALL activate the focused action, Escape SHALL close or cancel the current input, and controls SHALL remain usable without pointer input

#### Scenario: Appearance changes
- **WHEN** the host reports dark mode, contrast preferences, or reduced-motion preferences
- **THEN** the panel SHALL adapt its surface and interaction behavior without hiding essential status or actions
