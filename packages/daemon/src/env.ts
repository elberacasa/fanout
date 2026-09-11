/*
 * The environment an agent CLI receives. It needs enough to run and to find its own sign-in (PATH, HOME, locale),
 * and nothing else: API keys, tokens and cloud credentials in the user's shell never reach an agent.
 * A CLI that needs a vendor variable (for example CODEX_HOME) gets it from its adapter, by name.
 */

export const ALLOWED_ENV = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "TMPDIR",
  "TZ",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "XDG_STATE_HOME",
] as const;

export function baseEnv(
  source: Readonly<Record<string, string | undefined>> = process.env,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of ALLOWED_ENV) {
    const value = source[name];
    if (value !== undefined && value !== "") env[name] = value;
  }
  return env;
}
