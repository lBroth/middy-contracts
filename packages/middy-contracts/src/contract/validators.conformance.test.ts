import assert from "node:assert/strict";
import { test } from "node:test";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import Joi from "joi";
import { z } from "zod";
import { defineContract } from "./index.ts";

test("zod schema plugs in directly as StandardSchemaV1", async () => {
  const contract = defineContract("users.create", {
    input: z.object({ email: z.email(), age: z.number().min(18) }),
    http: { method: "POST", path: "/users" },
  });

  const schema = contract.input.body;
  const ok = await schema["~standard"].validate({ email: "a@b.com", age: 30 });
  assert.equal(ok.issues, undefined);
  assert.deepEqual((ok as { value: unknown }).value, { email: "a@b.com", age: 30 });

  const ko = await schema["~standard"].validate({ email: "nope", age: 30 });
  assert.ok(ko.issues && ko.issues.length > 0);
});

test("joi 18 schema plugs in directly as StandardSchemaV1", async () => {
  const contract = defineContract("users.create", {
    input: Joi.object({
      email: Joi.string().email().required(),
      age: Joi.number().min(18).required(),
    }),
    http: { method: "POST", path: "/users" },
  });

  const schema = contract.input.body;
  const ok = await schema["~standard"].validate({ email: "a@b.com", age: 30 });
  assert.equal(ok.issues, undefined);

  const ko = await schema["~standard"].validate({ email: "a@b.com", age: 15 });
  assert.ok(ko.issues && ko.issues.length > 0);
});

test("callable schemas (ArkType-style) normalize as schemas, not part objects", async () => {
  // ArkType types are functions carrying ~standard: the runtime guard must
  // classify them exactly like the type level does.
  const callable = Object.assign((value: unknown) => value, {
    "~standard": {
      version: 1 as const,
      vendor: "arktype-like-test",
      validate: (value: unknown): StandardSchemaV1.Result<{ email: string }> => ({
        value: value as { email: string },
      }),
    },
  });

  const contract = defineContract("users.create", {
    input: callable,
    http: { method: "POST", path: "/users" },
  });

  assert.equal(contract.input.body, callable);
  const ok = await contract.input.body["~standard"].validate({ email: "a@b.com" });
  assert.equal(ok.issues, undefined);
});

test("joi 18 exposes Standard JSON Schema for OpenAPI generation", () => {
  const schema = Joi.object({ email: Joi.string().email().required() });
  const jsonSchema = schema["~standard"].jsonSchema?.input({ target: "draft-2020-12" });
  assert.ok(jsonSchema);
  assert.equal((jsonSchema as { type?: string }).type, "object");
});
