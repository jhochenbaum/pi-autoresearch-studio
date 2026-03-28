import { randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

const COOKIE_NAME = "_ars_token";

/** Generate a crypto-random session token. */
export function generateToken(): string {
  return randomBytes(32).toString("hex");
}

/** Set the auth cookie on a response. */
export function setAuthCookie(res: ServerResponse, token: string): void {
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Strict; Path=/`);
}

/** Parse the auth cookie from a request. Returns the token or null. */
export function getAuthCookie(req: IncomingMessage): string | null {
  const cookie = req.headers.cookie;
  if (!cookie) {
    return null;
  }
  const match = cookie.split(";").find((c) => c.trim().startsWith(`${COOKIE_NAME}=`));
  if (!match) {
    return null;
  }
  return match.trim().slice(COOKIE_NAME.length + 1);
}

/** Timing-safe token comparison helper. */
export function verifyToken(candidate: string | null, token: string): boolean {
  if (!candidate || candidate.length !== token.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(candidate), Buffer.from(token));
}

/** Verify the request has a valid auth cookie. Uses timing-safe comparison. */
export function verifyAuth(req: IncomingMessage, token: string): boolean {
  return verifyToken(getAuthCookie(req), token);
}

/** Send a 401 response. */
export function sendUnauthorized(res: ServerResponse): void {
  res.writeHead(401, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Unauthorized" }));
}
