import { cookies } from "next/headers";

/**
 * Who is making the request.
 *
 * For now each browser gets an anonymous ID cookie (set in middleware.ts).
 * When this is merged into ShortcutVid, replace this function with
 * ShortcutVid's logged-in user ID — nothing else needs to change.
 */
export const USER_COOKIE = "scm_uid";

export async function getUserId(): Promise<string> {
  const id = (await cookies()).get(USER_COOKIE)?.value;
  if (!id) throw new Error("Missing user session");
  return id;
}
