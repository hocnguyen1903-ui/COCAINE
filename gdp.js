#!/usr/bin/env node
const { execSync } = require("child_process");

const DEPLOYMENT_ID = "AKfycbxaJkfAEWLuPfw8n3J0kGCpcGHAX2WgC9qQ6Mdh6eCXA4hwzbHCfhkmphOf-uxYKg0";

execSync(
  `npx clasp push && npx clasp deploy -i ${DEPLOYMENT_ID} -d "Quick update"`,
  { stdio: "inherit" }
);
