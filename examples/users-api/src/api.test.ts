import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { createUser, getUser, resetUsers } from "./handlers.ts";

const context = {} as never;

beforeEach(() => resetUsers());

interface ProblemResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

test("valid creation returns 201 with the declared output shape", async () => {
  const response = (await createUser(
    { body: JSON.stringify({ email: "grace@example.com", age: 34 }) } as never,
    context,
  )) as { statusCode: number; body: { id: string; email: string } };

  assert.equal(response.statusCode, 201);
  assert.equal(response.body.email, "grace@example.com");
  assert.equal(typeof response.body.id, "string");
});

test("invalid body returns 400 problem+json listing every issue", async () => {
  const response = (await createUser(
    { body: JSON.stringify({ email: "not-an-email", age: 15 }) } as never,
    context,
  )) as ProblemResponse;

  assert.equal(response.statusCode, 400);
  assert.equal(response.headers["Content-Type"], "application/problem+json");
  const body = JSON.parse(response.body) as { errors: Array<{ part: string; path: string }> };
  assert.equal(body.errors.length, 2);
  assert.deepEqual(
    body.errors.map((issue) => issue.path).sort(),
    ["age", "email"],
  );
});

test("duplicate email returns the declared 409 with detail", async () => {
  const response = (await createUser(
    { body: JSON.stringify({ email: "ada@example.com", age: 40 }) } as never,
    context,
  )) as ProblemResponse;

  assert.equal(response.statusCode, 409);
  const body = JSON.parse(response.body) as { title: string; detail: string };
  assert.equal(body.title, "Conflict");
  assert.ok(body.detail.includes("ada@example.com"));
});

test("path params are coerced before the handler runs", async () => {
  const response = (await getUser(
    { pathParameters: { id: "1" } } as never,
    context,
  )) as { statusCode: number; body: { id: number } };

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.id, 1);
});

test("unknown user returns 404 problem+json", async () => {
  const response = (await getUser(
    { pathParameters: { id: "999" } } as never,
    context,
  )) as ProblemResponse;

  assert.equal(response.statusCode, 404);
  assert.equal(response.headers["Content-Type"], "application/problem+json");
  assert.equal((JSON.parse(response.body) as { title: string }).title, "Not Found");
});
