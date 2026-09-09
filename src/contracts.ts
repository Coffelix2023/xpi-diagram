import { type Static, Type } from "typebox";

export const DIAGRAM_TYPES = [
  "architecture",
  "process",
  "sequence",
  "state-machine",
  "entity-relationship",
] as const;

export const VALIDATION_STATUSES = [
  "passed",
  "failed",
  "incomplete",
] as const;

export const PREVIEW_STATUSES = [
  "not-attempted",
  "disabled",
  "opened",
  "unavailable",
  "failed",
] as const;

const strictObject = {
  additionalProperties: false,
} as const;

export const diagramTypeSchema = Type.Enum(DIAGRAM_TYPES);
export const diagramIdSchema = Type.String({
  maxLength: 64,
  minLength: 1,
  pattern: "^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$",
});
export const diagramVersionSchema = Type.Integer({
  minimum: 1,
});
export const validationStatusSchema = Type.Enum(VALIDATION_STATUSES);
export const previewStatusSchema = Type.Enum(PREVIEW_STATUSES);
export const simplificationNotesSchema = Type.Array(
  Type.String({
    maxLength: 500,
    minLength: 1,
  }),
  {
    maxItems: 20,
  },
);

export const diagramArtifactSchema = Type.Object(
  {
    diagramId: diagramIdSchema,
    html: Type.String({
      maxLength: 1_000_000,
      minLength: 1,
    }),
    simplificationNotes: Type.Optional(simplificationNotesSchema),
    type: diagramTypeSchema,
  },
  strictObject,
);

export const validationDiagnosticSchema = Type.Object(
  {
    code: Type.String({
      maxLength: 64,
      minLength: 1,
    }),
    message: Type.String({
      maxLength: 500,
      minLength: 1,
    }),
  },
  strictObject,
);

export const diagramResultSchema = Type.Object(
  {
    diagnostics: Type.Array(validationDiagnosticSchema, {
      maxItems: 50,
    }),
    diagramId: diagramIdSchema,
    path: Type.String({
      maxLength: 4096,
      minLength: 1,
    }),
    previewStatus: previewStatusSchema,
    simplificationNotes: simplificationNotesSchema,
    type: diagramTypeSchema,
    validationStatus: validationStatusSchema,
    version: Type.Union([
      diagramVersionSchema,
      Type.Null(),
    ]),
  },
  strictObject,
);

const reviewContextSchema = {
  diagramId: diagramIdSchema,
  version: diagramVersionSchema,
};

export const reviewEventSchema = Type.Union([
  Type.Object(
    {
      action: Type.Literal("confirm"),
      ...reviewContextSchema,
    },
    strictObject,
  ),
  Type.Object(
    {
      action: Type.Literal("request_changes"),
      ...reviewContextSchema,
    },
    strictObject,
  ),
  Type.Object(
    {
      action: Type.Literal("submit_feedback"),
      ...reviewContextSchema,
      feedback: Type.String({
        maxLength: 4_000,
        minLength: 1,
      }),
    },
    strictObject,
  ),
  Type.Object(
    {
      action: Type.Literal("select_version"),
      ...reviewContextSchema,
    },
    strictObject,
  ),
  Type.Object(
    {
      action: Type.Literal("close"),
      ...reviewContextSchema,
    },
    strictObject,
  ),
]);

export type DiagramArtifact = Static<typeof diagramArtifactSchema>;
export type DiagramId = Static<typeof diagramIdSchema>;
export type DiagramResult = Static<typeof diagramResultSchema>;
export type DiagramType = Static<typeof diagramTypeSchema>;
export type DiagramVersion = Static<typeof diagramVersionSchema>;
export type PreviewStatus = Static<typeof previewStatusSchema>;
export type ReviewEvent = Static<typeof reviewEventSchema>;
export type ValidationDiagnostic = Static<typeof validationDiagnosticSchema>;
export type ValidationStatus = Static<typeof validationStatusSchema>;
