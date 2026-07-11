import assert from "node:assert/strict";
import { test } from "node:test";
import middy from "@middy/core";
import { problemDetailsHandler } from "middy-problem-details";
import { z } from "zod";
import { defineContract, type InferInput } from "../contract/index.ts";
import { contractValidator } from "./index.ts";

const CreateUser = defineContract("users.create", {
  input: z.object({ email: z.email(), age: z.number().min(18) }),
  output: z.object({ id: z.string() }),
  http: { method: "POST", path: "/users" },
});

type ParsedBody = InferInput<typeof CreateUser>["body"];

const handler = middy(async (event: { body: unknown }) => {
  const body = event.body as ParsedBody;
  return { statusCode: 201, body: { id: `user-${body.age}` } };
})
  .use(contractValidator(CreateUser, { responseValidation: "hard" }))
  .use(problemDetailsHandler());

const context = {} as never;

test("e2e: valid request flows through parse, validate, handler, response check", async () => {
  const response = (await handler(
    { body: JSON.stringify({ email: "a@b.com", age: 30 }) } as never,
    context,
  )) as { statusCode: number; body: { id: string } };

  assert.equal(response.statusCode, 201);
  assert.deepEqual(response.body, { id: "user-30" });
});

test("e2e: hard-mode response violation becomes an opaque 500 problem", async () => {
  const broken = middy(async () => ({ statusCode: 201, body: { id: 42 } }))
    .use(contractValidator(CreateUser, { responseValidation: "hard" }))
    .use(problemDetailsHandler());

  const response = (await broken(
    { body: JSON.stringify({ email: "a@b.com", age: 30 }) } as never,
    context,
  )) as { statusCode: number; headers: Record<string, string>; body: string };

  assert.equal(response.statusCode, 500);
  assert.equal(response.headers["Content-Type"], "application/problem+json");
  const body = JSON.parse(response.body) as { title: string; detail?: string };
  assert.equal(body.title, "Internal Server Error");
  assert.equal(body.detail, undefined);
  assert.ok(!response.body.includes("id"), "schema internals must not leak to clients");
});

test("e2e: invalid request becomes an RFC 9457 response via problemDetailsHandler", async () => {
  const response = (await handler(
    { body: JSON.stringify({ email: "nope", age: 15 }) } as never,
    context,
  )) as { statusCode: number; headers: Record<string, string>; body: string };

  assert.equal(response.statusCode, 400);
  assert.equal(response.headers["Content-Type"], "application/problem+json");

  const body = JSON.parse(response.body) as {
    title: string;
    status: number;
    errors: Array<{ part: string; path: string; message: string }>;
  };
  assert.equal(body.title, "Validation failed");
  assert.equal(body.status, 400);
  assert.equal(body.errors.length, 2);
  assert.ok(body.errors.every((issue) => issue.part === "body"));
});
