const path = require("path");
const { execFileSync } = require("child_process");
const { readStdinJson, getWorkspaceRoot, checkFileSyntax } = require("./hook-utils");

function getChangedFiles(workspaceRoot) {
  try {
    const out = execFileSync("git", ["status", "--porcelain"], {
      cwd: workspaceRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    return out
      .split(/\r?\n/)
      .filter(Boolean)
      .filter((line) => !line.startsWith(" D") && !line.startsWith("D "))
      .map((line) => {
        const raw = line.slice(3).trim();
        const arrowIdx = raw.indexOf(" -> ");
        return arrowIdx !== -1 ? raw.slice(arrowIdx + 4).trim() : raw;
      })
      .map((p) => p.replace(/^"(.*)"$/, "$1"));
  } catch (_) {
    return [];
  }
}

(async () => {
  const payload = await readStdinJson();

  if (payload.continuationActive || (payload.terminationReason && payload.terminationReason !== "NO_TOOL_CALL")) {
    process.stdout.write(JSON.stringify({ decision: "stop" }));
    return;
  }

  const workspaceRoot = getWorkspaceRoot(payload);
  const changed = getChangedFiles(workspaceRoot);
  const errors = [];

  for (const rel of changed) {
    const top = rel.split(/[\\/]/)[0];
    if (top === ".backups" || top === ".git" || top === "node_modules") continue;
    const fullPath = path.join(workspaceRoot, rel);
    const errMsg = checkFileSyntax(fullPath);
    if (errMsg) {
      errors.push(`- ${rel}: ${errMsg}`);
    }
  }

  if (errors.length > 0) {
    process.stdout.write(JSON.stringify({
      decision: "continue",
      reason: `Stop-verify hook detected syntax error(s) in modified files:\n${errors.join("\n")}\nPlease fix these errors before finishing.`
    }));
    return;
  }

  process.stdout.write(JSON.stringify({ decision: "stop" }));
})();
