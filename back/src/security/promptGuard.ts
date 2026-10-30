interface SuspiciousPattern {
  label: string;
  pattern: RegExp;
}

const SUSPICIOUS_PATTERNS: SuspiciousPattern[] = [
  {
    label: "instruction_override",
    pattern: /\b(ignore|disregard|forget)\b[\s\S]{0,30}\b(previous|prior|above|all)\b[\s\S]{0,30}\b(instructions?|rules?|prompt)\b/i,
  },
  {
    label: "system_prompt_extraction",
    pattern: /\b(system prompt|reveal|print|show me|repeat)\b[\s\S]{0,30}\b(instructions?|prompt|rules?|guidelines)\b/i,
  },
  {
    label: "role_override",
    pattern: /\b(you are now|act as|pretend (to be|you('re| are))|roleplay as|new persona|developer mode|dan mode)\b/i,
  },
  {
    label: "jailbreak_keyword",
    pattern: /\b(jailbreak|\bDAN\b)\b/i,
  },
  {
    label: "unauthorized_override",
    pattern: /\b(override|bypass)\b[\s\S]{0,30}\b(instructions?|rules?|restrictions?|policy)\b/i,
  },
  {
    label: "credential_probe",
    pattern: /\b(api[ _-]?key|secret key|env(ironment)? variable|\.env|anthropic_api_key)\b/i,
  },
];

/**
 * Returns the labels of any suspicious/malicious patterns found in a passenger
 * message (prompt injection, jailbreak attempts, system-prompt extraction,
 * credential probing). Empty array if nothing matched.
 */
export function detectSuspiciousPrompt(message: string): string[] {
  return SUSPICIOUS_PATTERNS.filter(({ pattern }) => pattern.test(message)).map(
    ({ label }) => label
  );
}
