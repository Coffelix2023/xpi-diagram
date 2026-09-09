## Purpose

为图表预览行为提供可发现、可回退的项目级配置入口，同时保持生成流程与 Glimpse 审阅面板的默认行为一致。


## Requirements


### Requirement: The xpi-diagram command exposes preview configuration
The system SHALL provide `/xpi-diagram` as a command that can show current status, configure Glimpse automatic preview, and reopen the latest saved diagram.

#### Scenario: User opens configuration
- **WHEN** the user invokes `/xpi-diagram`
- **THEN** the system SHALL present the current preview setting and available diagram actions through Pi UI

#### Scenario: User disables automatic preview
- **WHEN** the user sets Glimpse automatic preview to disabled
- **THEN** subsequent diagrams SHALL still be generated and saved, but SHALL NOT automatically open a Glimpse panel

#### Scenario: User re-enables automatic preview
- **WHEN** the user sets Glimpse automatic preview to enabled
- **THEN** the next validated saved diagram SHALL open in Glimpse when UI is available

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
