const { execFileSync } = require("child_process");
const { readStdinJson, getWorkspaceRoot } = require("./hook-utils");

function runGit(cwd, args) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch (_) {
    return "";
  }
}

(async () => {
  const payload = await readStdinJson();
  const workspaceRoot = getWorkspaceRoot(payload);

  const branch = runGit(workspaceRoot, ["branch", "--show-current"]) || "(detached/unknown)";
  const statusRaw = runGit(workspaceRoot, ["status", "--porcelain"]);
  const lines = statusRaw ? statusRaw.split(/\r?\n/).filter(Boolean) : [];

  const summaryLines = [
    `[SessionStart Hook] Git branch: ${branch} | Uncommitted changes: ${lines.length}`,
    "Active workspace hooks: auto-backup (.backups/), safety-gate, format-code, syntax-guard, stop-verify."
  ];

  if (lines.length > 0) {
    const preview = lines.slice(0, 12).join("; ");
    summaryLines.push(`Changed files: ${preview}${lines.length > 12 ? ` (+${lines.length - 12} more)` : ""}`);
  }

  process.stdout.write(
    JSON.stringify({
      injectSteps: [
        {
          systemMessage: {
            systemMessage: summaryLines.join("\n")
          }
        }
      ]
    })
  );
})();
