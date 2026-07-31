import { describe, it, expect } from "vitest";
import {
  EmailFormatError,
  OTP_MAX_PER_IDENTIFIER_PER_HOUR,
  OTP_MAX_PER_IP_PER_HOUR,
  OTP_RESEND_COOLDOWN_SECONDS,
  OtpRateLimitError,
  emailTarget,
  isValidEmail,
  normalizeEmail,
  normalizeOtpTarget,
  otpFailureMessage,
  otpRateLimitVerdict,
  otpRetryAfterMinutes,
  otpRowMatchesTarget,
  otpThrottleFromRows,
  phoneTarget,
  type OtpTarget,
} from "@/lib/auth/otp";

/**
 * Email is now the credential a customer signs in with, so this file guards the
 * three things that decide whether the right person gets in.
 *
 * First, normalisation: the address is the account key, and a key that changes
 * with the shift key is an account nobody can reach. Second, channel
 * separation: a code that went to a phone must not open an email challenge, or
 * the number quietly becomes a second, weaker way into the same account. Third,
 * the ceilings, which are the only thing standing between a six-digit code and
 * someone with a script.
 *
 * All of it is pure. Nothing here touches a database, so it runs on every
 * commit rather than on the days someone has Postgres up.
 */

const EMAIL = "thandi@example.co.za";
const PHONE = "+27821234567";

describe("normalizeEmail", () => {
  it("trims and lowercases, so one address is one account", () => {
    expect(normalizeEmail("  Thandi@Example.co.za \n")).toBe(EMAIL);
    expect(normalizeEmail("THANDI@EXAMPLE.CO.ZA")).toBe(EMAIL);
  });

  it("is idempotent, so a stored address normalises to itself", () => {
    expect(normalizeEmail(normalizeEmail("Thandi@Example.co.za"))).toBe(EMAIL);
  });

  it("keeps the local part intact apart from case", () => {
    expect(normalizeEmail("first.last+needd@example.com")).toBe(
      "first.last+needd@example.com"
    );
  });

  it("refuses what we could never post a code to", () => {
    const bad = [
      "",
      "thandi",
      "thandi@",
      "@example.com",
      "thandi@example",
      "thandi@@example.com",
      "thandi@example..com",
      "thandi example@example.com",
      "thandi@example.com, other@example.com",
      "Thandi <thandi@example.com>",
      ".thandi@example.com",
      "thandi.@example.com",
      "thandi@-example.com",
      `${"a".repeat(250)}@example.com`,
    ];
    for (const input of bad) {
      expect(() => normalizeEmail(input), input).toThrow(EmailFormatError);
      expect(isValidEmail(input), input).toBe(false);
    }
  });

  it("accepts the ordinary shapes South African customers actually type", () => {
    for (const input of [
      "thandi@gmail.com",
      "thandi@webmail.co.za",
      "t@ex.co",
      "thandi_m@my-isp.net",
    ]) {
      expect(isValidEmail(input), input).toBe(true);
    }
  });
});

describe("normalizeOtpTarget", () => {
  it("normalises each channel with its own rules", () => {
    expect(
      normalizeOtpTarget({ channel: "email", identifier: " A@B.com " })
    ).toEqual({ channel: "email", identifier: "a@b.com" });
    expect(
      normalizeOtpTarget({ channel: "phone", identifier: "082 123 4567" })
    ).toEqual({ channel: "phone", identifier: PHONE });
  });

  it("never treats a phone number as an address, or the reverse", () => {
    expect(() => normalizeEmail(PHONE)).toThrow(EmailFormatError);
    expect(() =>
      normalizeOtpTarget({ channel: "phone", identifier: EMAIL })
    ).toThrow();
  });

  it("gives the same target from either constructor", () => {
    expect(emailTarget(" Thandi@Example.co.za ")).toEqual({
      channel: "email",
      identifier: EMAIL,
    });
    expect(phoneTarget("0821234567")).toEqual({
      channel: "phone",
      identifier: PHONE,
    });
  });
});

describe("otpRowMatchesTarget", () => {
  const emailChallenge: OtpTarget = { channel: "email", identifier: EMAIL };
  const phoneChallenge: OtpTarget = { channel: "phone", identifier: PHONE };

  it("accepts a code from the channel it was sent on", () => {
    expect(
      otpRowMatchesTarget(
        { channel: "email", identifier: EMAIL },
        emailChallenge
      )
    ).toBe(true);
    expect(
      otpRowMatchesTarget(
        { channel: "phone", identifier: PHONE },
        phoneChallenge
      )
    ).toBe(true);
  });

  it("refuses a phone code against an email challenge", () => {
    // The same person, the same moment, a code they really did receive: still
    // no. Otherwise anyone who can intercept an SMS is inside the account that
    // email was supposed to protect.
    expect(
      otpRowMatchesTarget(
        { channel: "phone", identifier: PHONE },
        emailChallenge
      )
    ).toBe(false);
    expect(
      otpRowMatchesTarget(
        { channel: "phone", identifier: EMAIL },
        emailChallenge
      )
    ).toBe(false);
  });

  it("refuses an email code against a phone challenge", () => {
    expect(
      otpRowMatchesTarget(
        { channel: "email", identifier: EMAIL },
        phoneChallenge
      )
    ).toBe(false);
    expect(
      otpRowMatchesTarget(
        { channel: "email", identifier: PHONE },
        phoneChallenge
      )
    ).toBe(false);
  });

  it("refuses a different person on the right channel", () => {
    expect(
      otpRowMatchesTarget(
        { channel: "email", identifier: "someone.else@example.com" },
        emailChallenge
      )
    ).toBe(false);
  });
});

describe("otpFailureMessage across channels", () => {
  it("names the email address when there is no email code waiting", () => {
    const message = otpFailureMessage({
      ok: false,
      status: "none",
      identifier: EMAIL,
      channel: "email",
      alreadyUsed: false,
    });
    expect(message).toContain("no code waiting for that email address");
    expect(message).not.toContain("number");
  });

  it("still says number on the phone channel", () => {
    expect(
      otpFailureMessage({
        ok: false,
        status: "none",
        identifier: PHONE,
        channel: "phone",
        alreadyUsed: false,
      })
    ).toContain("no code waiting for that number");
  });

  it("never leaks the address the code belongs to", () => {
    for (const channel of ["email", "phone"] as const) {
      const message = otpFailureMessage({
        ok: false,
        status: "mismatch",
        identifier: channel === "email" ? EMAIL : PHONE,
        channel,
        attemptsRemaining: 3,
      });
      expect(message).not.toContain(EMAIL);
      expect(message).not.toContain(PHONE);
      // House rule: no em dashes anywhere a customer can read.
      expect(message).not.toContain(String.fromCharCode(0x2014));
    }
  });
});

describe("otpRateLimitVerdict", () => {
  it("lets an ordinary request through", () => {
    expect(
      otpRateLimitVerdict({ identifierInLastHour: 0, ipInLastHour: 0 })
    ).toEqual({ limited: false });
    expect(
      otpRateLimitVerdict({
        identifierInLastHour: OTP_MAX_PER_IDENTIFIER_PER_HOUR - 1,
        ipInLastHour: OTP_MAX_PER_IP_PER_HOUR - 1,
      })
    ).toEqual({ limited: false });
  });

  it("stops at the per-identifier ceiling, not one past it", () => {
    expect(
      otpRateLimitVerdict({
        identifierInLastHour: OTP_MAX_PER_IDENTIFIER_PER_HOUR,
        ipInLastHour: 0,
      })
    ).toEqual({ limited: true, scope: "identifier" });
  });

  it("stops at the per-IP ceiling even when this address is fresh", () => {
    // One machine working through a list of addresses: each address looks new,
    // the connection does not.
    expect(
      otpRateLimitVerdict({
        identifierInLastHour: 0,
        ipInLastHour: OTP_MAX_PER_IP_PER_HOUR,
      })
    ).toEqual({ limited: true, scope: "ip" });
  });

  it("blames the address first when both ceilings are hit", () => {
    expect(
      otpRateLimitVerdict({
        identifierInLastHour: OTP_MAX_PER_IDENTIFIER_PER_HOUR,
        ipInLastHour: OTP_MAX_PER_IP_PER_HOUR,
      })
    ).toEqual({ limited: true, scope: "identifier" });
  });

  it("skips the IP ceiling when we could not read an IP", () => {
    expect(
      otpRateLimitVerdict({ identifierInLastHour: 1, ipInLastHour: null })
    ).toEqual({ limited: false });
  });
});

describe("OtpRateLimitError", () => {
  it("says address or number depending on the channel", () => {
    expect(new OtpRateLimitError("identifier", "email", 12).message).toContain(
      "this email address"
    );
    expect(new OtpRateLimitError("identifier", "phone", 12).message).toContain(
      "this number"
    );
  });

  it("names the wait when it knows it, and stays vague when it does not", () => {
    expect(new OtpRateLimitError("identifier", "email", 1).message).toContain(
      "about 1 minute."
    );
    expect(new OtpRateLimitError("identifier", "email", 12).message).toContain(
      "about 12 minutes."
    );
    expect(
      new OtpRateLimitError("identifier", "email", null).message
    ).toContain("a bit later");
  });

  it("blames the connection, not the person, on the IP ceiling", () => {
    const message = new OtpRateLimitError("ip", "email").message;
    expect(message).toContain("this connection");
    expect(message).not.toContain("email address");
  });

  it("carries the scope and channel for callers that branch on them", () => {
    const err = new OtpRateLimitError("identifier", "email", 5);
    expect(err.scope).toBe("identifier");
    expect(err.channel).toBe("email");
    expect(err.retryAfterMinutes).toBe(5);
    expect(err).toBeInstanceOf(Error);
  });
});

describe("otpRetryAfterMinutes", () => {
  const NOW = Date.UTC(2026, 6, 31, 12, 0, 0);
  const minutesAgo = (n: number) => new Date(NOW - n * 60_000);

  it("has nothing to say when no codes were sent", () => {
    expect(otpRetryAfterMinutes([], NOW)).toBe(null);
  });

  it("ignores codes that have already aged out of the window", () => {
    expect(otpRetryAfterMinutes([minutesAgo(61), minutesAgo(90)], NOW)).toBe(
      null
    );
  });

  it("counts from the oldest code that is still blocking", () => {
    // Five codes, the ceiling. The first frees a slot 60 minutes after it was
    // sent, so someone who sent one 50 minutes ago waits 10 more.
    const sent = [50, 40, 30, 20, 10].map(minutesAgo);
    expect(otpRetryAfterMinutes(sent, NOW)).toBe(10);
  });

  it("does not care what order the rows arrive in", () => {
    const sent = [10, 50, 30, 20, 40].map(minutesAgo);
    expect(otpRetryAfterMinutes(sent, NOW)).toBe(10);
  });

  it("never promises zero, because zero reads as go ahead", () => {
    expect(otpRetryAfterMinutes([minutesAgo(59.99)], NOW)).toBeGreaterThan(0);
  });
});

describe("otpThrottleFromRows", () => {
  const NOW = Date.UTC(2026, 6, 31, 12, 0, 0);
  const secondsAgo = (n: number) => new Date(NOW - n * 1000);
  const live = (sentSecondsAgo: number) => ({
    createdAt: secondsAgo(sentSecondsAgo),
    consumedAt: null,
    expiresAt: new Date(NOW + 60_000),
  });

  it("lets a first-time sender through", () => {
    expect(otpThrottleFromRows([], NOW)).toEqual({
      resendInSeconds: 0,
      liveCodeSentSecondsAgo: null,
      hourlyLimitReached: false,
    });
  });

  it("counts down the cooldown on a code that just went out", () => {
    const state = otpThrottleFromRows([live(15)], NOW);
    expect(state.liveCodeSentSecondsAgo).toBe(15);
    expect(state.resendInSeconds).toBe(OTP_RESEND_COOLDOWN_SECONDS - 15);
  });

  it("frees the button once the cooldown has run out", () => {
    expect(
      otpThrottleFromRows([live(OTP_RESEND_COOLDOWN_SECONDS)], NOW)
        .resendInSeconds
    ).toBe(0);
  });

  it("does not hold someone to a code that has been used", () => {
    const used = {
      createdAt: secondsAgo(5),
      consumedAt: secondsAgo(4),
      expiresAt: new Date(NOW + 60_000),
    };
    expect(otpThrottleFromRows([used], NOW)).toMatchObject({
      resendInSeconds: 0,
      liveCodeSentSecondsAgo: null,
    });
  });

  it("does not hold someone to a code that has expired", () => {
    const expired = {
      createdAt: secondsAgo(600),
      consumedAt: null,
      expiresAt: secondsAgo(300),
    };
    expect(otpThrottleFromRows([expired], NOW).resendInSeconds).toBe(0);
  });

  it("reports the hourly ceiling once it is reached", () => {
    const rows = Array.from(
      { length: OTP_MAX_PER_IDENTIFIER_PER_HOUR },
      (_, i) => ({
        createdAt: secondsAgo(600 + i * 60),
        consumedAt: null,
        expiresAt: secondsAgo(300 + i * 60),
      })
    );
    expect(otpThrottleFromRows(rows, NOW).hourlyLimitReached).toBe(true);
    expect(otpThrottleFromRows(rows.slice(1), NOW).hourlyLimitReached).toBe(
      false
    );
  });

  it("does not count codes older than an hour towards the ceiling", () => {
    const rows = Array.from(
      { length: OTP_MAX_PER_IDENTIFIER_PER_HOUR },
      () => ({
        createdAt: new Date(NOW - 61 * 60_000),
        consumedAt: null,
        expiresAt: new Date(NOW - 60 * 60_000),
      })
    );
    expect(otpThrottleFromRows(rows, NOW).hourlyLimitReached).toBe(false);
  });
});
