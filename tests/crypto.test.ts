import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
const { decrypt, encrypt, safeEqual } = await import("@/lib/crypto");

describe("token encryption", () => {
  it("round-trips and is not plaintext", () => {
    const enc = encrypt("EAAB-token");
    expect(enc).not.toContain("EAAB");
    expect(decrypt(enc)).toBe("EAAB-token");
  });

  it("detects tampering", () => {
    const enc = encrypt("abc");
    const parts = enc.split(".");
    parts[3] = Buffer.from("xyz").toString("base64");
    expect(() => decrypt(parts.join("."))).toThrow();
  });

  it("compares safely", () => {
    expect(safeEqual("a", "a")).toBe(true);
    expect(safeEqual("a", "b")).toBe(false);
    expect(safeEqual("a", "ab")).toBe(false);
  });
});
