import assert from "node:assert/strict";
import { test } from "node:test";
import Joi from "joi";
import { z } from "zod";
import { defineContract } from "../contract/index.ts";
import { fakeSchema } from "../contract/test-support.ts";
import { toOpenAPI } from "./index.ts";

const info = { title: "Test API", version: "1.0.0" };

const createUser = defineContract("users.create", {
  input: z.object({ email: z.email(), age: z.number().min(18) }),
  output: z.object({ id: z.string() }),
  errors: [{ code: "USER_EXISTS", status: 409 }],
  http: { method: "POST", path: "/users", successStatus: 201 },
});

const getOrder = defineContract("orders.get", {
  input: {
    query: z.object({ limit: z.coerce.number().optional() }),
    params: z.object({ id: z.coerce.number() }),
    headers: z.object({ "x-api-key": z.string() }),
  },
  output: z.object({ total: z.number() }),
  http: { method: "GET", path: "/orders/:id" },
});

test("zod contract produces a full OpenAPI 3.1 operation", () => {
  const document = toOpenAPI([createUser], info);

  assert.equal(document.openapi, "3.1.0");
  const operation = document.paths["/users"]?.post as {
    operationId: string;
    requestBody: { required: boolean; content: Record<string, { schema: { type?: string } }> };
    responses: Record<string, { description: string; content?: Record<string, unknown> }>;
  };

  assert.equal(operation.operationId, "users.create");
  assert.equal(operation.requestBody.required, true);
  assert.equal(operation.requestBody.content["application/json"]?.schema.type, "object");
  assert.ok(operation.responses["201"]?.content?.["application/json"]);
  assert.equal(operation.responses["409"]?.description, "USER_EXISTS");
  const fallback = (
    operation.responses["409"]?.content?.["application/problem+json"] as {
      schema: { required?: string[] };
    }
  ).schema;
  assert.deepEqual(fallback.required, ["type", "title", "status"]);
});

test("declared error schemas convert; shared statuses merge with oneOf", () => {
  const contract = defineContract("things.get", {
    errors: [
      {
        code: "THING_NOT_FOUND",
        status: 404,
        schema: z.object({ status: z.number(), title: z.string(), thingId: z.string() }),
      },
      { code: "OWNER_NOT_FOUND", status: 404 },
    ],
    http: { method: "GET", path: "/things" },
  });
  const document = toOpenAPI([contract], info);

  const response = (document.paths["/things"]?.get as {
    responses: Record<string, { description: string; content: Record<string, { schema: { oneOf?: unknown[] } }> }>;
  }).responses["404"];

  assert.equal(response?.description, "THING_NOT_FOUND | OWNER_NOT_FOUND");
  assert.equal(response?.content["application/problem+json"]?.schema.oneOf?.length, 2);
});

test("generated documents never share the fallback problem schema object", () => {
  const contract = defineContract("a.op", {
    errors: [{ code: "NOPE", status: 404 }],
    http: { method: "GET", path: "/a" },
  });
  const first = toOpenAPI([contract], info);
  const second = toOpenAPI([contract], info);

  const schemaOf = (document: typeof first) =>
    (document.paths["/a"]?.get as {
      responses: Record<string, { content: Record<string, { schema: unknown }> }>;
    }).responses["404"]?.content["application/problem+json"]?.schema;

  assert.notEqual(schemaOf(first), schemaOf(second));
});

test("duplicate contract names fail loud: operationId must be unique", () => {
  const a = defineContract("same.name", { http: { method: "GET", path: "/a" } });
  const b = defineContract("same.name", { http: { method: "GET", path: "/b" } });
  assert.throws(() => toOpenAPI([a, b], info), /duplicate contract name "same\.name"/);
});

test("schemas converting to $ref/$defs fail loud instead of emitting broken refs", () => {
  const refSchema = {
    "~standard": {
      version: 1 as const,
      vendor: "test-ref",
      validate: (value: unknown) => ({ value }),
      jsonSchema: { input: () => ({ $ref: "#" }) },
    },
  };
  const contract = defineContract("recursive.op", {
    input: refSchema,
    http: { method: "POST", path: "/recursive" },
  });
  assert.throws(() => toOpenAPI([contract], info), /\$ref\/\$defs.*cannot embed/);
});

test("paths differing only in parameter names fail loud", () => {
  const a = defineContract("a", {
    input: { params: z.object({ id: z.string() }) },
    http: { method: "GET", path: "/users/:id" },
  });
  const b = defineContract("b", {
    input: { params: z.object({ userId: z.string() }) },
    http: { method: "POST", path: "/users/:userId" },
  });
  assert.throws(() => toOpenAPI([a, b], info), /differ only in parameter names/);
});

test("path template variable without a matching params field fails loud", () => {
  const noParams = defineContract("noParams", {
    http: { method: "GET", path: "/users/:id" },
  });
  assert.throws(
    () => toOpenAPI([noParams], info),
    /path-parameter-mismatch|no matching field in the "params" schema/,
  );
});

test("params field that is not in the path template fails loud", () => {
  const extra = defineContract("extra", {
    input: { params: z.object({ id: z.string(), stray: z.string() }) },
    http: { method: "GET", path: "/users/:id" },
  });
  assert.throws(() => toOpenAPI([extra], info), /do not appear in the path template/);
});

test("path template converts and parts explode into located parameters", () => {
  const document = toOpenAPI([getOrder], info);

  const operation = document.paths["/orders/{id}"]?.get as {
    parameters: Array<{ name: string; in: string; required: boolean; schema: unknown }>;
  };
  assert.ok(operation, "path template must use {id}");

  const byName = new Map(operation.parameters.map((parameter) => [parameter.name, parameter]));
  assert.equal(byName.get("id")?.in, "path");
  assert.equal(byName.get("id")?.required, true);
  assert.ok(byName.get("id")?.schema, "path parameter carries its property schema");
  assert.equal(byName.get("limit")?.in, "query");
  assert.equal(byName.get("limit")?.required, false);
  assert.equal(byName.get("x-api-key")?.in, "header");
  assert.equal(byName.get("x-api-key")?.required, true);
});

test("joi 18 contract converts through Standard JSON Schema", () => {
  const joiContract = defineContract("legacy.op", {
    input: Joi.object({ email: Joi.string().email().required() }),
    http: { method: "POST", path: "/legacy" },
  });
  const document = toOpenAPI([joiContract], info);

  const operation = document.paths["/legacy"]?.post as {
    requestBody: { content: Record<string, { schema: { type?: string } }> };
  };
  assert.equal(operation.requestBody.content["application/json"]?.schema.type, "object");
});

test("record of contracts is accepted in addition to arrays", () => {
  const document = toOpenAPI({ createUser, getOrder }, info);
  assert.ok(document.paths["/users"]);
  assert.ok(document.paths["/orders/{id}"]);
});

test("validator without Standard JSON Schema fails loud with context", () => {
  const contract = defineContract("no.jsonschema", {
    input: fakeSchema<{ a: string }>(),
    http: { method: "POST", path: "/x" },
  });
  assert.throws(
    () => toOpenAPI([contract], info),
    /body schema of contract "no\.jsonschema".*does not implement Standard JSON Schema/,
  );
});

test("duplicate method+path across contracts fails loud", () => {
  const a = defineContract("a", { http: { method: "GET", path: "/same" } });
  const b = defineContract("b", { http: { method: "GET", path: "/same" } });
  assert.throws(() => toOpenAPI([a, b], info), /duplicate operation GET \/same/);
});

test("nested objects and arrays survive conversion in body and response", () => {
  const nested = defineContract("nested.op", {
    input: z.object({
      user: z.object({ name: z.string(), tags: z.array(z.string()) }),
      items: z.array(z.object({ sku: z.string(), qty: z.number().int() })),
    }),
    output: z.object({ ids: z.array(z.string()) }),
    http: { method: "POST", path: "/nested" },
  });
  const document = toOpenAPI([nested], info);

  const operation = document.paths["/nested"]?.post as {
    requestBody: { content: Record<string, { schema: JsonLike }> };
    responses: Record<string, { content: Record<string, { schema: JsonLike }> }>;
  };

  const body = operation.requestBody.content["application/json"]!.schema;
  const user = properties(body).user as JsonLike;
  assert.equal((properties(user).tags as JsonLike).type, "array");
  assert.equal((properties(user).name as JsonLike).type, "string");

  const items = properties(body).items as JsonLike;
  assert.equal(items.type, "array");
  assert.equal((properties(items.items as JsonLike).sku as JsonLike).type, "string");

  const output = operation.responses["200"]!.content["application/json"]!.schema;
  assert.equal((properties(output).ids as JsonLike).type, "array");
});

/**
 * Request schemas must convert through `.input()` (wire types, pre-coercion)
 * and the output schema through `.output()` (parsed types). Swapping the two
 * would still emit a structurally valid document, so assert the direction
 * itself with a schema whose two conversions are distinguishable.
 */
const directionSchema = {
  "~standard": {
    version: 1 as const,
    vendor: "test-direction",
    validate: (value: unknown) => ({ value }),
    jsonSchema: {
      input: () => ({ type: "object", properties: { wire: { type: "string" } } }),
      output: () => ({ type: "object", properties: { parsed: { type: "number" } } }),
    },
  },
};

test("body converts with .input() and the response with .output()", () => {
  const contract = defineContract("direction.op", {
    input: directionSchema,
    output: directionSchema,
    http: { method: "POST", path: "/direction" },
  });
  const document = toOpenAPI([contract], info);

  const operation = document.paths["/direction"]?.post as {
    requestBody: { content: Record<string, { schema: JsonLike }> };
    responses: Record<string, { content: Record<string, { schema: JsonLike }> }>;
  };

  assert.deepEqual(
    Object.keys(properties(operation.requestBody.content["application/json"]!.schema)),
    ["wire"],
    "request body must use the .input() (wire) conversion",
  );
  assert.deepEqual(
    Object.keys(properties(operation.responses["200"]!.content["application/json"]!.schema)),
    ["parsed"],
    "response must use the .output() (parsed) conversion",
  );
});

test("query parameters also convert with .input()", () => {
  const contract = defineContract("direction.query", {
    input: { query: directionSchema },
    output: directionSchema,
    http: { method: "GET", path: "/direction-query" },
  });
  const document = toOpenAPI([contract], info);

  const operation = document.paths["/direction-query"]?.get as {
    parameters: Array<{ name: string; in: string }>;
  };
  assert.deepEqual(
    operation.parameters.map((parameter) => parameter.name),
    ["wire"],
  );
});

test("a contract without successStatus documents its response under 200", () => {
  const document = toOpenAPI([getOrder], info);
  const operation = document.paths["/orders/{id}"]?.get as {
    responses: Record<string, { description: string; content?: unknown }>;
  };

  assert.ok(operation.responses["200"]?.content, "default success status must be 200");
  assert.equal(operation.responses["200"]?.description, "Success");
});

test("a parameters part that converts to a non-object schema fails loud", () => {
  const scalarSchema = {
    "~standard": {
      version: 1 as const,
      vendor: "test-scalar",
      validate: (value: unknown) => ({ value }),
      jsonSchema: { input: () => ({ type: "string" }) },
    },
  };
  const contract = defineContract("scalar.query", {
    input: { query: scalarSchema },
    http: { method: "GET", path: "/scalar" },
  });
  assert.throws(
    () => toOpenAPI([contract], info),
    /the query schema of contract "scalar\.query" must convert to an object JSON Schema with properties/,
  );
});

type JsonLike = Record<string, unknown>;

function properties(schema: JsonLike): Record<string, unknown> {
  const value = schema.properties;
  assert.ok(typeof value === "object" && value !== null, "schema must carry properties");
  return value as Record<string, unknown>;
}
