import assert from "node:assert/strict";
import { test } from "node:test";
import { defineContract } from "./index.ts";
import { fakeSchema } from "./test-support.ts";

test("defineContract returns frozen inert data", () => {
  const contract = defineContract("users.create", {
    input: fakeSchema<{ email: string; age: number }>(),
    output: fakeSchema<{ id: string }>(),
    http: { method: "POST", path: "/users" },
  });

  assert.equal(contract.name, "users.create");
  assert.equal(contract.http.method, "POST");
  assert.deepEqual(contract.errors, []);
  assert.ok(Object.isFrozen(contract));
  assert.ok(Object.isFrozen(contract.http));
  assert.ok(Object.isFrozen(contract.errors));
  assert.ok(Object.isFrozen(contract.input));
});

test("invalid successStatus fails at definition time", () => {
  for (const successStatus of [201.5, 42, Number.NaN]) {
    assert.throws(
      () =>
        defineContract("bad.status", {
          http: { method: "GET", path: "/x", successStatus },
        }),
      RangeError,
      String(successStatus),
    );
  }
});

test("bare input schema normalizes to { body: schema }", () => {
  const schema = fakeSchema<{ email: string }>();
  const asShorthand = defineContract("users.create", {
    input: schema,
    http: { method: "POST", path: "/users" },
  });
  const asParts = defineContract("users.create", {
    input: { body: schema },
    http: { method: "POST", path: "/users" },
  });

  assert.equal(asShorthand.input?.body, schema);
  assert.equal(asParts.input?.body, schema);
});

test("defineContract preserves declared errors", () => {
  const contract = defineContract("users.create", {
    errors: [{ code: "USER_EXISTS", status: 409 }],
    http: { method: "POST", path: "/users" },
  });

  assert.equal(contract.errors.length, 1);
  assert.equal(contract.errors[0]?.code, "USER_EXISTS");
  assert.ok(Object.isFrozen(contract.errors[0]));
});
