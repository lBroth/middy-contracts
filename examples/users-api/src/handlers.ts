import middy from "@middy/core";
import { type InferOutput } from "middy-contracts";
import { contractValidator, validatedInput } from "middy-contracts/middy";
import { problemDetailsHandler } from "middy-problem-details";
import { CreateUser, GetUser } from "./contracts.ts";

type GetUserOutput = InferOutput<typeof GetUser>;

const seed = (): Map<number, { id: number; email: string }> =>
  new Map([[1, { id: 1, email: "ada@example.com" }]]);

let users = seed();

/** Test hook: restores the initial in-memory state. */
export function resetUsers(): void {
  users = seed();
}

export const createUser = middy(async (event: { body: unknown }) => {
  // Typed, no cast: contractValidator validated and wrote the parsed body
  // back before the handler runs.
  const { body } = validatedInput(CreateUser, event);

  if ([...users.values()].some((user) => user.email === body.email)) {
    throw Object.assign(new Error(`User with email ${body.email} already exists`), {
      statusCode: 409,
      expose: true,
    });
  }

  const id = users.size + 1;
  users.set(id, { id, email: body.email });
  return { statusCode: 201, body: { id: String(id), email: body.email } };
})
  .use(contractValidator(CreateUser, { responseValidation: "hard" }))
  .use(problemDetailsHandler());

export const getUser = middy(async (event: { pathParameters: unknown }) => {
  const { params } = validatedInput(GetUser, event);

  const user = users.get(params.id);
  if (!user) {
    throw Object.assign(new Error(`No user with id ${params.id}`), {
      statusCode: 404,
      expose: true,
    });
  }
  const body: GetUserOutput = { ...user };
  return { statusCode: 200, body };
})
  .use(contractValidator(GetUser, { responseValidation: "hard" }))
  .use(problemDetailsHandler());
