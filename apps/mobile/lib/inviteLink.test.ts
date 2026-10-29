import { describe, expect, it } from "vitest";
import { parseInviteParams } from "./inviteLink";

describe("parseInviteParams", () => {
  it("returns the token for an invite link", () => {
    expect(parseInviteParams({ token_hash: "abc123", type: "invite" })).toBe("abc123");
  });

  it("rejects other link types, so a recovery token is never verified as an invite", () => {
    expect(parseInviteParams({ token_hash: "abc123", type: "recovery" })).toBeNull();
  });

  it("rejects a missing, empty or non-string token", () => {
    expect(parseInviteParams({ type: "invite" })).toBeNull();
    expect(parseInviteParams({ token_hash: "", type: "invite" })).toBeNull();
    expect(parseInviteParams({ token_hash: ["a", "b"], type: "invite" })).toBeNull();
  });
});
