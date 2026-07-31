import { describe, it, expect } from "vitest";
import {
  otpFailureMessage,
  OTP_TTL_SECONDS,
  OTP_MAX_VERIFY_ATTEMPTS,
  type OtpVerifyFailure,
} from "@/lib/auth/otp";

/**
 * The wording a customer reads when a code is refused.
 *
 * Sign-in, checkout and quote acceptance all call this, so a change here is a
 * change to three screens at once. What is being pinned down is that each of
 * the four verdicts produces a distinguishable, true sentence: the whole point
 * of the exercise was that "That code didn't match" was being shown to someone
 * whose code had actually expired, or who had run out of tries, and they kept
 * retyping the same correct digits.
 */

const PHONE = "+27821234567";
const CHANNEL = "phone" as const;

describe("otpFailureMessage", () => {
  it("counts the tries left on a mistyped code", () => {
    expect(
      otpFailureMessage({
        ok: false,
        status: "mismatch",
        identifier: PHONE,
        channel: CHANNEL,
        attemptsRemaining: 3,
      })
    ).toBe("That code is not right. 3 tries left before you need a new code.");
  });

  it("says try, not tries, on the last one", () => {
    const message = otpFailureMessage({
      ok: false,
      status: "mismatch",
      identifier: PHONE,
      channel: CHANNEL,
      attemptsRemaining: 1,
    });
    expect(message).toContain("1 try left");
    expect(message).not.toContain("1 tries");
  });

  it("tells someone out of tries that a new code is the way out", () => {
    const message = otpFailureMessage({
      ok: false,
      status: "locked",
      identifier: PHONE,
      channel: CHANNEL,
      attemptsRemaining: 0,
    });
    expect(message).toContain("last try");
    expect(message).toContain("Send a new code");
    // Never "that code is not right": it may well have been right.
    expect(message).not.toContain("not right");
  });

  it("names the real lifetime on an expired code", () => {
    const minutes = Math.round(OTP_TTL_SECONDS / 60);
    expect(
      otpFailureMessage({
        ok: false,
        status: "expired",
        identifier: PHONE,
        channel: CHANNEL,
      })
    ).toBe(
      `That code has expired, codes last ${minutes} minute${minutes === 1 ? "" : "s"}. Send a new code.`
    );
  });

  it("separates a code already used from one never sent", () => {
    const used = otpFailureMessage({
      ok: false,
      status: "none",
      identifier: PHONE,
      channel: CHANNEL,
      alreadyUsed: true,
    });
    const never = otpFailureMessage({
      ok: false,
      status: "none",
      identifier: PHONE,
      channel: CHANNEL,
      alreadyUsed: false,
    });
    expect(used).toContain("already been used");
    expect(never).toContain("no code waiting");
    expect(used).not.toBe(never);
  });

  it("gives every verdict its own sentence", () => {
    const verdicts: OtpVerifyFailure[] = [
      {
        ok: false,
        status: "mismatch",
        identifier: PHONE,
        channel: CHANNEL,
        attemptsRemaining: 2,
      },
      {
        ok: false,
        status: "locked",
        identifier: PHONE,
        channel: CHANNEL,
        attemptsRemaining: 0,
      },
      { ok: false, status: "expired", identifier: PHONE, channel: CHANNEL },
      {
        ok: false,
        status: "none",
        identifier: PHONE,
        channel: CHANNEL,
        alreadyUsed: true,
      },
      {
        ok: false,
        status: "none",
        identifier: PHONE,
        channel: CHANNEL,
        alreadyUsed: false,
      },
    ];
    const messages = verdicts.map(otpFailureMessage);
    expect(new Set(messages).size).toBe(verdicts.length);
    for (const message of messages) {
      expect(message.length).toBeGreaterThan(0);
      // House rule: no em dashes anywhere a customer can read. Built from its
      // code point so the character itself never appears in the source either.
      expect(message).not.toContain(String.fromCharCode(0x2014));
    }
  });

  it("never leaks the number the code belongs to", () => {
    const message = otpFailureMessage({
      ok: false,
      status: "mismatch",
      identifier: PHONE,
      channel: CHANNEL,
      attemptsRemaining: 4,
    });
    expect(message).not.toContain(PHONE);
  });

  it("counts down from the attempt ceiling the library enforces", () => {
    // One failed try on a fresh code leaves ceiling-minus-one, and the copy
    // has to agree with the number verifyOtp actually stops at.
    const remaining = OTP_MAX_VERIFY_ATTEMPTS - 1;
    expect(
      otpFailureMessage({
        ok: false,
        status: "mismatch",
        identifier: PHONE,
        channel: CHANNEL,
        attemptsRemaining: remaining,
      })
    ).toContain(`${remaining} tries left`);
  });
});
