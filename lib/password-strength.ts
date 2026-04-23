/**
 * Lightweight password strength evaluator. Custom heuristic (no zxcvbn dep)
 * tuned for Indian B2B context — common Indian + global passwords blocklisted,
 * minimum 8 chars, 2-of-4 character classes.
 *
 * Future hardening (tracked in HARDENING.md): swap in zxcvbn if false-positive
 * rate becomes a problem, or call HaveIBeenPwned k-anonymity API for breach
 * checking. Both deferred to avoid 600KB+ bundle bloat for an MVP.
 */

export type PasswordStrength = "weak" | "ok" | "strong";

const COMMON_PASSWORDS = new Set<string>([
  // Top global breached passwords
  "password",
  "12345678",
  "123456789",
  "qwerty12",
  "qwerty123",
  "password1",
  "password123",
  "passw0rd",
  "p@ssw0rd",
  "admin123",
  "letmein1",
  "welcome1",
  "abc12345",
  "iloveyou",
  "monkey12",
  "football",
  "1234qwer",
  "1q2w3e4r",
  "trustno1",
  "sunshine",
  "master12",
  "shadow12",
  "ashley12",
  "michael1",
  "qwertyuiop",
  "asdfghjkl",
  "zxcvbnm12",
  // India-specific common patterns
  "india1947",
  "india2020",
  "india2024",
  "india2025",
  "india2026",
  "delhi123",
  "mumbai12",
  "chennai1",
  "bharat12",
  "cricket1",
  "bollywood",
  "namaste1",
  "ganesha1",
  "krishna1",
  "shiva123",
  // App-specific
  "awaazos1",
  "awaazos123",
  "awaaz123",
]);

export function isCommonPassword(pw: string): boolean {
  return COMMON_PASSWORDS.has(pw.toLowerCase());
}

export function passwordStrength(pw: string): {
  strength: PasswordStrength;
  score: number;
} {
  if (!pw) return { strength: "weak", score: 0 };
  let score = 0;
  if (pw.length >= 8) score += 1;
  if (pw.length >= 12) score += 1;
  if (pw.length >= 16) score += 1;
  if (/[a-z]/.test(pw)) score += 1;
  if (/[A-Z]/.test(pw)) score += 1;
  if (/[0-9]/.test(pw)) score += 1;
  if (/[^a-zA-Z0-9]/.test(pw)) score += 1;
  if (isCommonPassword(pw)) score = Math.min(score, 1);
  const strength: PasswordStrength = score >= 5 ? "strong" : score >= 3 ? "ok" : "weak";
  return { strength, score };
}

export type PasswordPolicyResult =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Hard policy enforced at registration. Errs gentle — we don't want to lock
 * out 60M small-vendor users with overly aggressive rules. Just block the
 * obvious foot-guns: too short, too long (DoS via expensive bcrypt),
 * single-class entropy, or top-50 common passwords.
 */
export function checkPasswordPolicy(pw: string): PasswordPolicyResult {
  if (typeof pw !== "string") return { ok: false, reason: "Password is required." };
  if (pw.length < 8) return { ok: false, reason: "Password must be at least 8 characters." };
  if (pw.length > 128) return { ok: false, reason: "Password must be at most 128 characters." };
  if (isCommonPassword(pw)) {
    return {
      ok: false,
      reason: "This password is too common. Please choose a unique one.",
    };
  }
  const classes = [
    /[a-z]/.test(pw),
    /[A-Z]/.test(pw),
    /[0-9]/.test(pw),
    /[^a-zA-Z0-9]/.test(pw),
  ].filter(Boolean).length;
  if (classes < 2) {
    return {
      ok: false,
      reason: "Use at least two of: lowercase, uppercase, digits, or symbols.",
    };
  }
  return { ok: true };
}
