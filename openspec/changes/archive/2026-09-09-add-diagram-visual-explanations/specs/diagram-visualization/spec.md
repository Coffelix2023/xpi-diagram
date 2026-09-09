## Purpose

让 Pi Agent 在适合视觉解释的场景中生成具有 `diagram-design` 设计语言的可访问图表，并以稳定文件和版本记录交付给用户审阅。

## ADDED Requirements

### Requirement: Agent can produce governed diagrams
The system SHALL support architecture, process, sequence, state-machine, and entity-relationship diagrams, and each generated diagram SHALL use the selected visual type, semantic hierarchy, typography, color roles, connector rules, and complexity budget defined by `diagram-design`.

#### Scenario: Visual explanation is appropriate
- **WHEN** the Agent determines that a visual explanation communicates the subject better than equivalent prose or a table
- **THEN** it SHALL generate one of the supported diagram types and identify the type in the artifact metadata or result summary

#### Scenario: Diagram exceeds the complexity budget
- **WHEN** the requested content exceeds the selected type's node, edge, lane, or other budget
- **THEN** the system SHALL split the content into an overview and detail diagram or report that the content cannot be faithfully represented within one diagram

### Requirement: Diagram output is accessible and self-contained
The system SHALL produce an HTML artifact with inline SVG, accessible SVG title and description metadata, no executable external content, and only approved font references where remote fonts are used.

#### Scenario: Artifact passes structural validation
- **WHEN** a diagram is generated
- **THEN** the system SHALL validate the accessible SVG contract, resource references, script restrictions, and required diagram structure before presenting it as ready

#### Scenario: Validation fails
- **WHEN** validation finds malformed SVG, unsafe references, missing accessibility metadata, or an invalid generated structure
- **THEN** the system SHALL retain the failed artifact for diagnosis, report the validation errors, and SHALL NOT present it as confirmed or ready

### Requirement: Diagram facts remain traceable
The system SHALL preserve the source facts and relationships supplied by the Agent and SHALL not invent components or relationships merely to fill a layout; simplifications, merges, and dropped details SHALL be reported with the result.

#### Scenario: Diagram is simplified
- **WHEN** the Agent reduces or merges source content to fit the visual type or complexity budget
- **THEN** the result SHALL identify the simplification and point to the generated diagram version

### Requirement: Diagram versions are stored under the project
The system SHALL save generated diagrams under the current project's `.pi/diagram/` directory, using a validated diagram identifier and monotonically ordered versions without overwriting prior versions.

#### Scenario: New diagram is generated
- **WHEN** a generated diagram passes validation
- **THEN** the system SHALL write it below `.pi/diagram/` and return its absolute or project-relative path, identifier, and version

#### Scenario: Diagram identifier is unsafe
- **WHEN** an identifier contains path traversal, separators, control characters, or unsupported characters
- **THEN** the system SHALL reject it or replace it with a generated safe identifier and SHALL keep the output inside `.pi/diagram/`
