import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { defineContract } from "../contract/index.ts";
import { asyncFakeSchema } from "../contract/test-support.ts";
import {
  ContractValidationError,
  ContractResponseError,
  contractValidator,
  type MiddyLikeRequest,
} from "./index.ts";

const orders = defineContract("orders.get", {
  input: {
    query: z.object({ limit: z.coerce.number().default(10) }),
    params: z.object({ id: z.coerce.number() }),
  },
  output: z.object({ total: z.number() }),
  http: { method: "GET", path: "/orders/:id" },
});

const users = defineContract("users.create", {
  input: z.object({ email: z.email(), age: z.number().min(18) }),
  http: { method: "POST", path: "/users" },
});

test("before: parses JSON body and validates the body schema", async () => {
  const request: MiddyLikeRequest = {
    event: { body: JSON.stringify({ email: "a@b.com", age: 30 }) },
  };
  await contractValidator(users).before(request);
  assert.deepEqual(request.event.body, { email: "a@b.com", age: 30 });
});

test("before: validates query and params, writing back coerced values", async () => {
  const request: MiddyLikeRequest = {
    event: {
      queryStringParameters: { limit: "5" },
      pathParameters: { id: "42" },
    },
  };
  await contractValidator(orders).before(request);
  assert.deepEqual(request.event.queryStringParameters, { limit: 5 });
  assert.deepEqual(request.event.pathParameters, { id: 42 });
});

test("before: missing query falls back to {} so defaults apply", async () => {
  const request: MiddyLikeRequest = {
    event: { pathParameters: { id: "42" } },
  };
  await contractValidator(orders).before(request);
  assert.deepEqual(request.event.queryStringParameters, { limit: 10 });
});

test("before: collects issues across parts into one 400 problem", async () => {
  const request: MiddyLikeRequest = {
    event: {
      queryStringParameters: { limit: "not-a-number" },
      pathParameters: { id: "not-a-number" },
    },
  };
  await assert.rejects(
    () => contractValidator(orders).before(request),
    (error: unknown) => {
      assert.ok(error instanceof ContractValidationError);
      assert.equal(error.statusCode, 400);
      assert.equal(error.problem.status, 400);
      const parts = error.issues.map((issue) => issue.part).sort();
      assert.deepEqual(parts, ["params", "query"]);
      return true;
    },
  );
});

test("before: malformed JSON body is a validation issue, not a crash", async () => {
  const request: MiddyLikeRequest = { event: { body: "{nope" } };
  await assert.rejects(
    () => contractValidator(users).before(request),
    (error: unknown) => {
      assert.ok(error instanceof ContractValidationError);
      assert.equal(error.issues[0]?.message, "Request body is not valid JSON");
      return true;
    },
  );
});

test("before: on failure the event is left untouched", async () => {
  const request: MiddyLikeRequest = {
    event: {
      queryStringParameters: { limit: "5" },
      pathParameters: { id: "not-a-number" },
    },
  };
  await assert.rejects(() => contractValidator(orders).before(request), ContractValidationError);
  assert.deepEqual(request.event.queryStringParameters, { limit: "5" });
});

test("after: hard mode throws an opaque 500 on contract violation", async () => {
  const request: MiddyLikeRequest = {
    event: {},
    response: { total: "not-a-number" },
  };
  await assert.rejects(
    () => contractValidator(orders, { responseValidation: "hard" }).after(request),
    (error: unknown) => {
      assert.ok(error instanceof ContractResponseError);
      assert.equal(error.statusCode, 500);
      assert.equal(error.expose, false);
      return true;
    },
  );
});

test("after: warn mode logs contract name and issues, leaves the response alone", async () => {
  const logged: Array<[string, unknown]> = [];
  const request: MiddyLikeRequest = {
    event: {},
    response: { total: "not-a-number" },
  };
  await contractValidator(orders, {
    responseValidation: "warn",
    logger: (message, details) => logged.push([message, details]),
  }).after(request);

  assert.equal(logged.length, 1);
  const [message, details] = logged[0]!;
  assert.ok(message.includes("orders.get"));
  const issues = details as Array<{ part: string; path: string }>;
  assert.equal(issues[0]?.part, "response");
  assert.equal(issues[0]?.path, "total");
  assert.deepEqual(request.response, { total: "not-a-number" });
});

test("after: valid response passes and envelope bodies are handled", async () => {
  const request: MiddyLikeRequest = {
    event: {},
    response: { statusCode: 200, body: { total: 3 } },
  };
  await contractValidator(orders, { responseValidation: "hard" }).after(request);
  assert.deepEqual(request.response, { statusCode: 200, body: { total: 3 } });
});

test("after: off mode never validates", async () => {
  const request: MiddyLikeRequest = {
    event: {},
    response: { total: "not-a-number" },
  };
  await contractValidator(orders, { responseValidation: "off" }).after(request);
  assert.deepEqual(request.response, { total: "not-a-number" });
});

test("after: output schema strips undeclared fields on valid responses", async () => {
  const request: MiddyLikeRequest = {
    event: {},
    response: { statusCode: 200, body: { total: 3, passwordHash: "s3cret" } },
  };
  await contractValidator(orders, { responseValidation: "hard" }).after(request);
  assert.deepEqual(request.response, { statusCode: 200, body: { total: 3 } });
  assert.ok(!JSON.stringify(request.response).includes("s3cret"));
});

test("after: already-serialized string bodies are skipped, byte-identical", async () => {
  const serialized = '{"totally":"wrong shape"}';
  const request: MiddyLikeRequest = {
    event: {},
    response: { statusCode: 200, body: serialized },
  };
  await contractValidator(orders, { responseValidation: "hard" }).after(request);
  assert.equal((request.response as { body: string }).body, serialized);
});

test("after: raw payload legitimately containing statusCode is not treated as envelope", async () => {
  const probe = defineContract("probe.url", {
    output: z.object({ url: z.string(), statusCode: z.number() }),
    http: { method: "GET", path: "/probe" },
  });
  const request: MiddyLikeRequest = {
    event: {},
    response: { url: "https://example.com", statusCode: 503 },
  };
  await contractValidator(probe, { responseValidation: "hard" }).after(request);
  assert.deepEqual(request.response, { url: "https://example.com", statusCode: 503 });
});

test("before: missing headers fall back to {} so defaults apply", async () => {
  const withDefault = defineContract("ping", {
    input: { headers: z.object({ "x-api-version": z.string().default("1") }) },
    http: { method: "GET", path: "/ping" },
  });
  const request: MiddyLikeRequest = { event: {} };
  await contractValidator(withDefault).before(request);
  assert.deepEqual(request.event.headers, { "x-api-version": "1" });
});

test("before: missing required header fails with part headers", async () => {
  const required = defineContract("secure.op", {
    input: { headers: z.object({ "x-api-key": z.string() }) },
    http: { method: "GET", path: "/secure" },
  });
  const request: MiddyLikeRequest = { event: {} };
  await assert.rejects(
    () => contractValidator(required).before(request),
    (error: unknown) => {
      assert.ok(error instanceof ContractValidationError);
      assert.equal(error.issues[0]?.part, "headers");
      return true;
    },
  );
});

test("async validators work end to end in before and after", async () => {
  const asyncContract = defineContract("async.op", {
    input: asyncFakeSchema<{ ok: boolean }>((value) => (value as { ok?: unknown }).ok === true),
    output: asyncFakeSchema<{ done: boolean }>(
      (value) => (value as { done?: unknown }).done === true,
    ),
    http: { method: "POST", path: "/async" },
  });

  const good: MiddyLikeRequest = { event: { body: JSON.stringify({ ok: true }) } };
  await contractValidator(asyncContract).before(good);
  assert.deepEqual(good.event.body, { ok: true });

  const bad: MiddyLikeRequest = { event: { body: JSON.stringify({ ok: false }) } };
  await assert.rejects(
    () => contractValidator(asyncContract).before(bad),
    ContractValidationError,
  );

  const badResponse: MiddyLikeRequest = { event: {}, response: { done: false } };
  await assert.rejects(
    () =>
      contractValidator(asyncContract, { responseValidation: "hard" }).after(badResponse),
    ContractResponseError,
  );
});

test("before: undeclared query params and headers survive validation", async () => {
  const withHeaders = defineContract("orders.get", {
    input: {
      query: z.object({ limit: z.coerce.number() }),
      headers: z.object({ "x-api-key": z.string() }),
    },
    http: { method: "GET", path: "/orders" },
  });
  const request: MiddyLikeRequest = {
    event: {
      queryStringParameters: { limit: "5", undeclared: "kept" },
      headers: { "X-Api-Key": "secret", Accept: "application/json" },
    },
  };
  await contractValidator(withHeaders).before(request);
  assert.deepEqual(request.event.queryStringParameters, { limit: 5, undeclared: "kept" });
  assert.deepEqual(request.event.headers, {
    "x-api-key": "secret",
    accept: "application/json",
  });
});

test("before: header keys are lowercased so v1 and v2 events validate identically", async () => {
  const withHeaders = defineContract("ping", {
    input: { headers: z.object({ "x-api-version": z.string().default("1") }) },
    http: { method: "GET", path: "/ping" },
  });
  const request: MiddyLikeRequest = {
    event: { headers: { "X-Api-Version": "2" } },
  };
  await contractValidator(withHeaders).before(request);
  assert.equal((request.event.headers as Record<string, string>)["x-api-version"], "2");
});

test("before: base64-encoded body is decoded before JSON parsing", async () => {
  const payload = { email: "a@b.com", age: 30 };
  const request: MiddyLikeRequest = {
    event: {
      body: Buffer.from(JSON.stringify(payload), "utf8").toString("base64"),
      isBase64Encoded: true,
    },
  };
  await contractValidator(users).before(request);
  assert.deepEqual(request.event.body, payload);
});

test("before: repeated query params surface as arrays via the multi-value map", async () => {
  const withTags = defineContract("items.list", {
    input: { query: z.object({ tag: z.array(z.string()), limit: z.coerce.number() }) },
    http: { method: "GET", path: "/items" },
  });
  const request: MiddyLikeRequest = {
    event: {
      queryStringParameters: { tag: "b", limit: "5" },
      multiValueQueryStringParameters: { tag: ["a", "b"], limit: ["5"] },
    },
  };
  await contractValidator(withTags).before(request);
  assert.deepEqual(request.event.queryStringParameters, { tag: ["a", "b"], limit: 5 });
});

test("before: header issue messages are redacted by default, paths kept", async () => {
  const withAuth = defineContract("secure.op", {
    input: { headers: z.object({ authorization: z.string().startsWith("Bearer ") }) },
    http: { method: "GET", path: "/secure" },
  });
  const request: MiddyLikeRequest = {
    event: { headers: { Authorization: "super-secret-token" } },
  };
  await assert.rejects(
    () => contractValidator(withAuth).before(request),
    (error: unknown) => {
      assert.ok(error instanceof ContractValidationError);
      assert.equal(error.issues[0]?.message, "Value does not satisfy schema");
      assert.equal(error.issues[0]?.path, "authorization");
      assert.ok(!JSON.stringify(error.problem).includes("super-secret-token"));
      return true;
    },
  );
});

test("before: redactedParts: [] keeps validator messages", async () => {
  const withAuth = defineContract("secure.op", {
    input: { headers: z.object({ authorization: z.string().startsWith("Bearer ") }) },
    http: { method: "GET", path: "/secure" },
  });
  const request: MiddyLikeRequest = {
    event: { headers: { authorization: "nope" } },
  };
  await assert.rejects(
    () => contractValidator(withAuth, { redactedParts: [] }).before(request),
    (error: unknown) => {
      assert.ok(error instanceof ContractValidationError);
      assert.notEqual(error.issues[0]?.message, "Value does not satisfy schema");
      return true;
    },
  );
});

test("before: v2 rehydrated cookie survives strip-by-default header schemas", async () => {
  const stripHeaders = defineContract("secure.op", {
    input: { headers: z.object({ "x-api-key": z.string() }) },
    http: { method: "GET", path: "/secure" },
  });
  const request: MiddyLikeRequest = {
    event: {
      headers: { "X-Api-Key": "k1" },
      cookies: ["session=abc", "theme=dark"],
    },
  };
  await contractValidator(stripHeaders).before(request);
  assert.deepEqual(request.event.headers, {
    "x-api-key": "k1",
    cookie: "session=abc; theme=dark",
  });
});

test("before: v2 cookies are rehydrated into the headers part", async () => {
  const withCookie = defineContract("session.read", {
    input: { headers: z.object({ cookie: z.string() }) },
    http: { method: "GET", path: "/session" },
  });
  const request: MiddyLikeRequest = {
    event: { headers: { accept: "application/json" }, cookies: ["a=1", "b=2"] },
  };
  await contractValidator(withCookie).before(request);
  assert.equal((request.event.headers as Record<string, string>).cookie, "a=1; b=2");
});

test("after: non-2xx envelopes are not validated against the success schema", async () => {
  const request: MiddyLikeRequest = {
    event: {},
    response: { statusCode: 404, body: { message: "not found" } },
  };
  await contractValidator(orders, { responseValidation: "hard" }).after(request);
  assert.deepEqual(request.response, { statusCode: 404, body: { message: "not found" } });
});

test("after: successStatus narrows which envelope gets validated", async () => {
  const created = defineContract("users.create", {
    output: z.object({ id: z.string() }),
    http: { method: "POST", path: "/users", successStatus: 201 },
  });
  const wrong: MiddyLikeRequest = {
    event: {},
    response: { statusCode: 201, body: { id: 42 } },
  };
  await assert.rejects(
    () => contractValidator(created, { responseValidation: "hard" }).after(wrong),
    ContractResponseError,
  );

  const other: MiddyLikeRequest = {
    event: {},
    response: { statusCode: 200, body: { id: 42 } },
  };
  await contractValidator(created, { responseValidation: "hard" }).after(other);
});
