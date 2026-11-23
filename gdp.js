#!/usr/bin/env node
const { execSync } = require("child_process");

const DEPLOYMENT_ID = "AKfycbxaJkfAEWLuPfw8n3J0kGCpcGHAX2WgC9qQ6Mdh6eCXA4hwzbHCfhkmphOf-uxYKg0";

const pushOut = execSync("npx clasp push", { encoding: "utf8" });
process.stdout.write(pushOut);

if (/already up to date/i.test(pushOut)) {
  console.log("⏭️ Code không có gì thay đổi — bỏ qua bước deploy.");
  process.exit(0);
}

execSync(`npx clasp deploy -i ${DEPLOYMENT_ID} -d "Quick update"`, { stdio: "inherit" });
