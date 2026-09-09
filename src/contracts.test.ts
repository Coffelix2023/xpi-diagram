import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import {
  diagramArtifactSchema,
  diagramResultSchema,
  reviewEventSchema,
} from "./contracts.js";

const artifact = {
  diagramId: "checkout-flow",
  html: "<!doctype html><html><body><svg></svg></body></html>",
  simplificationNotes: [],
  type: "sequence",
};

describe("diagram contracts", () => {
  it("accepts supported artifact input", () => {
    expect(Value.Check(diagramArtifactSchema, artifact)).toBe(true);
  });

  it.each([
    "../escape",
    "has/slash",
    "UPPER",
    "space id",
    "",
  ])("rejects unsafe diagram ID %j", (diagramId) => {
    expect(
      Value.Check(diagramArtifactSchema, {
        ...artifact,
        diagramId,
      }),
    ).toBe(false);
  });

  it("rejects unsupported diagram types and extra input fields", () => {
    expect(
      Value.Check(diagramArtifactSchema, {
        ...artifact,
        type: "gantt",
      }),
    ).toBe(false);
    expect(
      Value.Check(diagramArtifactSchema, {
        ...artifact,
        extra: true,
      }),
    ).toBe(false);
  });

  it("accepts bounded success results", () => {
    expect(
      Value.Check(diagramResultSchema, {
        diagnostics: [],
        diagramId: artifact.diagramId,
        path: ".pi/diagram/checkout-flow/v1.html",
        previewStatus: "not-attempted",
        simplificationNotes: [],
        type: artifact.type,
        validationStatus: "passed",
        version: 1,
      }),
    ).toBe(true);
  });

  it("accepts bounded terminal review results", () => {
    expect(
      Value.Check(diagramResultSchema, {
        diagnostics: [],
        diagramId: artifact.diagramId,
        path: ".pi/diagram/checkout-flow/v1.html",
        previewStatus: "opened",
        simplificationNotes: [],
        type: artifact.type,
        validationStatus: "passed",
        version: 1,
        review: {
          feedback: "Increase contrast.",
          status: "changes_requested",
          version: 1,
        },
      }),
    ).toBe(true);
  });

  it.each([
    "closed",
    "cancelled",
    "superseded",
    "failed",
  ] as const)("accepts %s terminal review results", (status) => {
    expect(
      Value.Check(diagramResultSchema, {
        diagnostics: [],
        diagramId: artifact.diagramId,
        path: ".pi/diagram/checkout-flow/v1.html",
        previewStatus: "opened",
        simplificationNotes: [],
        type: artifact.type,
        validationStatus: "passed",
        version: 1,
        review: {
          status,
          version: 1,
        },
      }),
    ).toBe(true);
  });

  it("rejects invalid versions and statuses", () => {
    const result = {
      diagnostics: [],
      diagramId: artifact.diagramId,
      path: "file.html",
      previewStatus: "unknown",
      simplificationNotes: [],
      type: artifact.type,
      validationStatus: "ok",
      version: 0,
    };
    expect(Value.Check(diagramResultSchema, result)).toBe(false);
  });
});

describe("review event contract", () => {
  it.each([
    "confirm",
    "request_changes",
    "select_version",
    "close",
  ])("accepts %s events", (action) => {
    expect(
      Value.Check(reviewEventSchema, {
        action,
        diagramId: artifact.diagramId,
        version: 1,
      }),
    ).toBe(true);
  });

  it("requires bounded feedback only for submit_feedback", () => {
    expect(
      Value.Check(reviewEventSchema, {
        action: "submit_feedback",
        diagramId: artifact.diagramId,
        feedback: "Move the API boundary left.",
        version: 1,
      }),
    ).toBe(true);
    expect(
      Value.Check(reviewEventSchema, {
        action: "submit_feedback",
        diagramId: artifact.diagramId,
        version: 1,
      }),
    ).toBe(false);
    expect(
      Value.Check(reviewEventSchema, {
        action: "confirm",
        diagramId: artifact.diagramId,
        feedback: "unexpected",
        version: 1,
      }),
    ).toBe(false);
  });
});
