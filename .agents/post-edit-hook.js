const path = require("path");
const { readStdinJson, getWorkspaceRoot, isSubPath, checkFileSyntax } = require("./hook-utils");

(async () => {
  const payload = await readStdinJson();
  const args = (payload.toolCall && payload.toolCall.args) || {};
  const rawTarget = args.Path || args.TargetFile || args.path || "";

  if (rawTarget && typeof rawTarget === "string") {
    const workspaceRoot = getWorkspaceRoot(payload);
    const resolved = path.resolve(workspaceRoot, rawTarget);
    if (isSubPath(workspaceRoot, resolved)) {
      const rel = path.relative(workspaceRoot, resolved);
      const top = rel.split(path.sep)[0];
      if (top !== ".backups" && top !== ".git" && top !== "node_modules") {
        const errMsg = checkFileSyntax(resolved);
        if (errMsg) {
          process.stderr.write(`[syntax-guard] ${rel}: ${errMsg}\n`);
        }
      }
    }
  }

  process.stdout.write("{}");
})();
