## Purpose

让用户在 Glimpse 原生窗口中直接查看、确认和反馈图表，使图表审阅成为连续的可视化交互，而不是在终端与预览窗口之间往返。


## Requirements


### Requirement: Valid diagrams open in the Glimpse review panel
The system SHALL open a validated diagram in a Glimpse panel by default when the runtime has dialog-capable UI and the preview setting is enabled.

#### Scenario: Default preview is enabled
- **WHEN** a validated diagram is saved in a UI-capable runtime
- **THEN** the system SHALL open the diagram in Glimpse automatically and show its diagram identifier and version

#### Scenario: Glimpse is unavailable
- **WHEN** Glimpse cannot be loaded, started, or rendered
- **THEN** the system SHALL preserve the saved artifact, report the preview failure, and provide its path without failing diagram generation

### Requirement: Review actions stay inside Glimpse
The Glimpse panel SHALL provide preview, zoom, version navigation, confirm, request-changes, submit-feedback, and close actions without requiring terminal editor selection.

#### Scenario: User confirms a version
- **WHEN** the user selects Confirm in Glimpse
- **THEN** the system SHALL record the confirmed diagram identifier and version and SHALL not trigger another Agent turn

#### Scenario: User submits requested changes
- **WHEN** the user enters feedback and selects Submit feedback
- **THEN** the system SHALL send the feedback to the active Pi session with the diagram identifier and version, then keep or update the same review context for the next version

#### Scenario: User closes the panel
- **WHEN** the user selects Close or closes the window
- **THEN** the system SHALL close the preview only, retain all saved versions, and SHALL NOT interpret closure as confirmation

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
