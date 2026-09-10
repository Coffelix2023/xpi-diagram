## Purpose

为图表预览行为提供可发现、可回退的项目级配置入口，同时保持生成流程与默认 Glimpse 预览模式一致。


## Requirements

### Requirement: The xpi-diagram command exposes preview configuration
The system SHALL provide `/xpi-diagram` as a command that can show current status, configure automatic preview (enabled/disabled and preview mode `glimpse`/`browser`), and reopen the latest saved diagram. Writing one setting SHALL preserve the other.

#### Scenario: User opens configuration
- **WHEN** the user invokes `/xpi-diagram`
- **THEN** the system SHALL present the current preview setting, preview mode, and available diagram actions through Pi UI

#### Scenario: User disables automatic preview
- **WHEN** the user sets automatic preview to disabled
- **THEN** subsequent diagrams SHALL still be generated and saved, but SHALL NOT automatically open a preview

#### Scenario: User re-enables automatic preview
- **WHEN** the user sets automatic preview to enabled
- **THEN** the next validated saved diagram SHALL open in the configured preview mode when UI is available

#### Scenario: User selects a preview mode
- **WHEN** the user selects `glimpse` or `browser` in the command menu
- **THEN** the system SHALL persist the selected mode while keeping the current preview enabled/disabled setting unchanged

### Requirement: Both preview modes are read-only views
The Glimpse window and the system browser preview SHALL only display the saved diagram. Confirmation, feedback, and version selection SHALL happen only in the Pi editor panel via `ctx.ui.*`.

#### Scenario: Browser preview opens the saved artifact
- **WHEN** automatic preview is enabled with the `browser` mode and a diagram is saved
- **THEN** the system SHALL open the saved HTML through the platform's native opener (`open` on macOS, `xdg-open` on Linux, `start` on Windows) with the path passed as a single argument, and SHALL NOT wait for the browser to close

#### Scenario: Browser preview is unavailable
- **WHEN** the platform has no supported opener or the launch fails
- **THEN** the system SHALL keep the saved artifact, report a diagnostic with the absolute path, and return the diagram result without failing generation

#### Scenario: Preview failure never loses the diagram
- **WHEN** either preview mode is unavailable or fails for any reason
- **THEN** the diagram SHALL already be saved and the result SHALL report the saved path so the user can open it manually

### Requirement: Configuration is project-scoped and fail-closed
The system SHALL store project-level configuration in `.pi/xpi-diagram.json`, use documented defaults when the file is absent, and ignore malformed or unsupported values without escaping the project boundary.

#### Scenario: No configuration exists
- **WHEN** the project has no xpi-diagram configuration file
- **THEN** Glimpse automatic preview SHALL default to enabled

#### Scenario: Configuration is malformed
- **WHEN** the configuration file is invalid JSON or contains unsupported values
- **THEN** the system SHALL report the configuration issue, use safe defaults, and SHALL NOT execute file content

#### Scenario: Project is not trusted
- **WHEN** project-local configuration is read in an untrusted project context
- **THEN** the system SHALL not apply project configuration and SHALL use the runtime's safe defaults
