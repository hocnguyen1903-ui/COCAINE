const path = require("path");
const { readStdinJson } = require("./hook-utils");

const SENSITIVE_FILE_PATTERNS = [
  /(^|[\\/])\.env(\..+)?$/i,
  /\.(pem|key|p12|pfx)$/i,
  /(^|[\\/])(credentials|service[-_]?account|secrets?)\.json$/i,
  /(^|[\\/])\.clasprc\.json$/i
];

const DENY_CMD_PATTERNS = [
  /\b(rm\s+-[a-z]*r[a-z]*f|rm\s+-[a-z]*f[a-z]*r)\s+([\/\\]|~|\$HOME|%USERPROFILE%|\.\.)\b/i,
  /\b(format|diskpart)\b/i,
  /\b(cat|type|get-content|gc|more|less|head|tail)\b[^\r\n]*(\.env\b|\.clasprc\.json|\.(pem|key)\b|service[-_]?account)/i
];

const FORCE_ASK_CMD_PATTERNS = [
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+-[a-z]*f/i,
  /\bgit\s+push\b[^\r\n]*(\s--force\b|\s-f\b|\s--force-with-lease\b)/i,
  /\bclasp\s+push\b[^\r\n]*(\s--force\b|\s-f\b)/i,
  /\brm\s+-[a-z]*r/i,
  /\b(rmdir|rd)\s+\/s/i,
  /\bdel\s+\/s/i,
  /\bRemove-Item\b[^\r\n]*-Recurse/i
];

function isSensitivePath(p) {
  if (!p || typeof p !== "string") return false;
  return SENSITIVE_FILE_PATTERNS.some((re) => re.test(p.trim()));
}

(async () => {
  const payload = await readStdinJson();
  const toolName = (payload.toolCall && payload.toolCall.name) || "";
  const args = (payload.toolCall && payload.toolCall.args) || {};

  if (toolName === "run_command") {
    const cmd = String(args.CommandLine || "");
    if (DENY_CMD_PATTERNS.some((re) => re.test(cmd))) {
      process.stdout.write(JSON.stringify({
        decision: "deny",
        reason: "Blocked potentially destructive command or secret exposure by safety-gate hook."
      }));
      return;
    }
    if (FORCE_ASK_CMD_PATTERNS.some((re) => re.test(cmd))) {
      process.stdout.write(JSON.stringify({
        decision: "force_ask",
        reason: "Destructive Git/file/deploy operation requires explicit confirmation."
      }));
      return;
    }
    process.stdout.write(JSON.stringify({ decision: "ask" }));
    return;
  }

  const targetPath = args.Path || args.TargetFile || args.path || "";
  if (isSensitivePath(targetPath)) {
    process.stdout.write(JSON.stringify({
      decision: "deny",
      reason: `Blocked access to sensitive file (${path.basename(targetPath)}) by safety-gate hook.`
    }));
    return;
  }

  process.stdout.write(JSON.stringify({ decision: "allow" }));
})();
