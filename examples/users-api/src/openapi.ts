import { toOpenAPI } from "middy-contracts/openapi";
import { CreateUser, GetUser } from "./contracts.ts";

const document = toOpenAPI([CreateUser, GetUser], {
  title: "Users API",
  version: "1.0.0",
  description: "Generated from the same contracts that validate at runtime.",
});

console.log(JSON.stringify(document, null, 2));
