import { z } from "zod";
import { defineContract } from "middy-contracts";

/** Bare schema shorthand: the schema is the JSON body. */
export const CreateUser = defineContract("users.create", {
  input: z.object({
    email: z.email(),
    age: z.number().min(18),
  }),
  output: z.object({
    id: z.string(),
    email: z.email(),
  }),
  errors: [{ code: "USER_EXISTS", status: 409 }],
  http: { method: "POST", path: "/users", successStatus: 201 },
});

/** Per-part input: path params and query are validated and coerced. */
export const GetUser = defineContract("users.get", {
  input: {
    params: z.object({ id: z.coerce.number().int() }),
    query: z.object({ expand: z.coerce.boolean().default(false) }),
  },
  output: z.object({
    id: z.number(),
    email: z.email(),
    profile: z.object({ bio: z.string() }).optional(),
  }),
  errors: [{ code: "USER_NOT_FOUND", status: 404 }],
  http: { method: "GET", path: "/users/:id" },
});
