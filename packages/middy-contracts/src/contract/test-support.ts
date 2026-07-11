import type { StandardSchemaV1 } from "@standard-schema/spec";

/** Minimal hand-rolled Standard Schema so contract-level tests don't need a real validator. */
export function fakeSchema<T>(): StandardSchemaV1<unknown, T> {
  return {
    "~standard": {
      version: 1,
      vendor: "middy-contracts-test",
      validate: (value) => ({ value: value as T }),
    },
  };
}

/** Async variant: validate returns a Promise, like validators with async refinements. */
export function asyncFakeSchema<T>(
  check: (value: unknown) => boolean,
): StandardSchemaV1<unknown, T> {
  return {
    "~standard": {
      version: 1,
      vendor: "middy-contracts-test-async",
      validate: async (value) =>
        check(value)
          ? { value: value as T }
          : { issues: [{ message: "async validation failed" }] },
    },
  };
}
