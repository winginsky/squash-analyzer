import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { UserRecord } from "../db";
import { authenticateRequest } from "./auth";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: UserRecord | null;
};

export async function createContext(opts: CreateExpressContextOptions): Promise<TrpcContext> {
  let user: UserRecord | null = null;

  try {
    user = await authenticateRequest(opts.req);
  } catch {
    user = null;
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}
