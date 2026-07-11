import assert from "node:assert/strict";
import { test } from "node:test";
import { problem, problemDetailsHandler, type ProblemDetails } from "./index.ts";

test("problem() defaults type to about:blank and keeps extensions", () => {
  const p = problem({ status: 409, title: "Conflict", userId: "42" });
  assert.equal(p.type, "about:blank");
  assert.equal(p.status, 409);
  assert.equal(p.userId, "42");
});

test("http-style error with expose keeps status and message as detail", () => {
  const request: { response?: unknown; error?: unknown } = {
    error: Object.assign(new Error("User already exists"), {
      statusCode: 409,
      expose: true,
    }),
  };
  problemDetailsHandler().onError(request);

  const response = request.response as {
    statusCode: number;
    headers: Record<string, string>;
    body: string;
  };
  assert.equal(response.statusCode, 409);
  assert.equal(response.headers["Content-Type"], "application/problem+json");
  const body = JSON.parse(response.body) as ProblemDetails;
  assert.equal(body.title, "Conflict");
  assert.equal(body.detail, "User already exists");
});

test("unexpected error becomes opaque 500 by default", () => {
  const request: { response?: unknown; error?: unknown } = {
    error: new Error("db password wrong"),
  };
  problemDetailsHandler().onError(request);

  const response = request.response as { statusCode: number; body: string };
  assert.equal(response.statusCode, 500);
  const body = JSON.parse(response.body) as ProblemDetails;
  assert.equal(body.title, "Internal Server Error");
  assert.equal(body.detail, undefined);
});

test("exposeInternalErrors surfaces the message on 500", () => {
  const request: { response?: unknown; error?: unknown } = {
    error: new Error("boom"),
  };
  problemDetailsHandler({ exposeInternalErrors: true }).onError(request);

  const body = JSON.parse((request.response as { body: string }).body) as ProblemDetails;
  assert.equal(body.detail, "boom");
});

test("errors carrying a well-formed problem emit it as-is", () => {
  const request: { response?: unknown; error?: unknown } = {
    error: Object.assign(new Error("x"), {
      problem: { type: "about:blank", title: "Validation failed", status: 400, errors: [] },
    }),
  };
  problemDetailsHandler().onError(request);
  const response = request.response as { statusCode: number; body: string };
  assert.equal(response.statusCode, 400);
  assert.equal((JSON.parse(response.body) as ProblemDetails).title, "Validation failed");
});

test("malformed carried problems fall through to the safe default mapping", () => {
  for (const problemValue of [
    { status: "500", title: "broken" },
    { status: 200, title: "relayed upstream success" },
    { status: 404 },
    "not-an-object",
  ]) {
    const request: { response?: unknown; error?: unknown } = {
      error: Object.assign(new Error("x"), { problem: problemValue }),
    };
    problemDetailsHandler().onError(request);
    const response = request.response as { statusCode: number; body: string };
    assert.equal(response.statusCode, 500, JSON.stringify(problemValue));
    assert.equal((JSON.parse(response.body) as ProblemDetails).detail, undefined);
  }
});

test("carried problems are re-serialized as plain data: toJSON dropped, type defaulted", () => {
  const request: { response?: unknown; error?: unknown } = {
    error: Object.assign(new Error("x"), {
      problem: {
        title: "Validation failed",
        status: 400,
        toJSON: () => ({ hijacked: true }),
      },
    }),
  };
  problemDetailsHandler().onError(request);
  const body = JSON.parse((request.response as { body: string }).body) as ProblemDetails;
  assert.equal(body.type, "about:blank");
  assert.equal(body.title, "Validation failed");
  assert.equal((body as { hijacked?: boolean }).hijacked, undefined);
});

test("non-integer statusCode falls through to the opaque 500", () => {
  for (const statusCode of [Number.NaN, 450.5, "404"]) {
    const request: { response?: unknown; error?: unknown } = {
      error: Object.assign(new Error("x"), { statusCode }),
    };
    problemDetailsHandler().onError(request);
    assert.equal((request.response as { statusCode: number }).statusCode, 500, String(statusCode));
  }
});

test("a response already set by an earlier onError middleware is left untouched", () => {
  const sentinel = { statusCode: 418, body: "handled elsewhere" };
  const request: { response?: unknown; error?: unknown } = {
    response: sentinel,
    error: new Error("x"),
  };
  problemDetailsHandler().onError(request);
  assert.equal(request.response, sentinel);
});

test("mapError overrides the default mapping", () => {
  const request: { response?: unknown; error?: unknown } = { error: new Error("x") };
  problemDetailsHandler({
    mapError: () => problem({ status: 418, title: "I'm a teapot" }),
  }).onError(request);

  const response = request.response as { statusCode: number };
  assert.equal(response.statusCode, 418);
});
