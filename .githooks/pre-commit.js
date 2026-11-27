const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { isIgnoredRelPath, isFormattableFile, findPrettierBin, checkFileSyntax } = require("../.agents/hook-utils");

function runGit(cwd, args, options = {}) {
  return execFileSync("git", args, {
    cwd,
    encoding: options.encoding !== undefined ? options.encoding : "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 20 * 1024 * 1024
  });
}

function getStagedFiles(workspaceRoot) {
  const raw = runGit(workspaceRoot, ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"]);
  if (!raw) return [];
  return raw.split("\0").filter(Boolean);
}

function hasUnstagedChanges(workspaceRoot, relPath) {
  const out = runGit(workspaceRoot, ["diff", "--name-only", "-z", "--", relPath]);
  return Boolean(out && out.trim());
}

function checkStagedWithPrettier(prettierBin, workspaceRoot, relPath, fullPath) {
  const stagedContent = runGit(workspaceRoot, ["show", `:${relPath}`], { encoding: null });
  try {
    execFileSync(prettierBin, ["--check", "--stdin-filepath", fullPath], {
      cwd: workspaceRoot,
      input: stagedContent,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      shell: process.platform === "win32"
    });
    return { ok: true };
  } catch (err) {
    const out = `${err.stdout || ""}\n${err.stderr || ""}`.trim();
    return { ok: false, reason: out || "Staged content is not formatted." };
  }
}

function main() {
  const workspaceRoot = path.resolve(__dirname, "..");
  const stagedFiles = getStagedFiles(workspaceRoot).filter((rel) => !isIgnoredRelPath(rel));
  if (stagedFiles.length === 0) return;

  const prettierBin = findPrettierBin(workspaceRoot);
  if (!prettierBin) {
    process.stderr.write(
      '[pre-commit] Chưa cài Prettier. Chạy "npm install -D prettier" để bật auto-format khi commit.\n'
    );
  }

  const errors = [];
  const formattedFiles = [];

  for (const rel of stagedFiles) {
    const fullPath = path.join(workspaceRoot, rel);
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) continue;

    const partial = hasUnstagedChanges(workspaceRoot, rel);

    if (prettierBin && isFormattableFile(fullPath)) {
      if (partial) {
        const res = checkStagedWithPrettier(prettierBin, workspaceRoot, rel, fullPath);
        if (!res.ok) {
          errors.push(
            `- ${rel}: File có thay đổi chưa stage và bản staged chưa đúng chuẩn Prettier. Hãy format hoặc stage toàn bộ file trước khi commit.`
          );
        }
      } else {
        const before = fs.readFileSync(fullPath);
        try {
          execFileSync(prettierBin, ["--write", rel], {
            cwd: workspaceRoot,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
            shell: process.platform === "win32"
          });
          const after = fs.readFileSync(fullPath);
          if (!before.equals(after)) {
            runGit(workspaceRoot, ["add", "--", rel]);
            formattedFiles.push(rel);
          }
        } catch (err) {
          errors.push(`- ${rel}: Lỗi Prettier (${(err.stderr || err.message || "").trim()})`);
        }
      }
    }

    if (!partial) {
      const syntaxErr = checkFileSyntax(fullPath);
      if (syntaxErr) {
        errors.push(`- ${rel}: Lỗi cú pháp (${syntaxErr})`);
      }
    }
  }

  if (formattedFiles.length > 0) {
    process.stdout.write(`[pre-commit] Đã format & re-stage: ${formattedFiles.join(", ")}\n`);
  }

  if (errors.length > 0) {
    process.stderr.write(`[pre-commit] Commit bị chặn do lỗi:\n${errors.join("\n")}\n`);
    process.exit(1);
  }
}

main();
