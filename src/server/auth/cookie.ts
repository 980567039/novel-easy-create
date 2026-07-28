import type { NextResponse } from "next/server";

export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export function sessionCookieName() {
  return process.env.NODE_ENV === "production" ? "__Host-novel_session" : "novel_session";
}

export function setSessionCookie(response: NextResponse, token: string) {
  response.cookies.set(sessionCookieName(), token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set(sessionCookieName(), "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
    expires: new Date(0),
  });
}
