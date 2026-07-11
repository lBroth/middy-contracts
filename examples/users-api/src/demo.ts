import { createUser, getUser } from "./handlers.ts";

const context = {} as never;

function show(label: string, response: unknown): void {
  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify(response, null, 2));
}

// 1. Valid creation: body parsed, validated, response checked against output schema.
show(
  "POST /users — valid",
  await createUser(
    { body: JSON.stringify({ email: "grace@example.com", age: 34 }) } as never,
    context,
  ),
);

// 2. Invalid body: one RFC 9457 response with every issue listed.
show(
  "POST /users — invalid body (400 problem+json)",
  await createUser(
    { body: JSON.stringify({ email: "not-an-email", age: 15 }) } as never,
    context,
  ),
);

// 3. Declared error path: duplicate email → 409, message exposed as detail.
show(
  "POST /users — duplicate email (409 problem+json)",
  await createUser(
    { body: JSON.stringify({ email: "ada@example.com", age: 40 }) } as never,
    context,
  ),
);

// 4. Path/query coercion: ":id" arrives as the string "1", handler sees number 1.
show(
  "GET /users/1 — params coerced",
  await getUser({ pathParameters: { id: "1" } } as never, context),
);

// 5. Not found → 404 problem+json via the error path; `after` (response
//    validation) never runs on thrown errors.
show(
  "GET /users/999 — not found (404 problem+json)",
  await getUser({ pathParameters: { id: "999" } } as never, context),
);
