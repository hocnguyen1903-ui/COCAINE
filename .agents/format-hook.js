const path = require("path");
const {
  readStdinJson,
  getWorkspaceRoot,
  isSubPath,
  isIgnoredRelPath,
  isFormattableFile,
  formatFileWithPrettier
} = require("./hook-utils");

(async () => {
  const payload = await readStdinJson();
  if (payload.error) {
    process.stdout.write("{}");
    return;
  }

  const args = (payload.toolCall && payload.toolCall.args) || {};
  const rawTarget = args.Path || args.TargetFile || args.path || "";

  if (rawTarget && typeof rawTarget === "string") {
    const workspaceRoot = getWorkspaceRoot(payload);
    const resolved = path.resolve(workspaceRoot, rawTarget);
    if (isSubPath(workspaceRoot, resolved)) {
      const rel = path.relative(workspaceRoot, resolved);
      if (!isIgnoredRelPath(rel) && isFormattableFile(resolved)) {
        const res = formatFileWithPrettier(resolved, workspaceRoot);
        if (!res.ok) {
          if (res.reason === "prettier-not-installed") {
            process.stderr.write(
              `[format-code] Prettier chưa được cài. Chạy "npm install -D prettier" để bật auto-format.\n`
            );
          } else {
            process.stderr.write(`[format-code] ${rel}: ${res.reason}\n`);
          }
        }
      }
    }
  }

  process.stdout.write("{}");
})();
