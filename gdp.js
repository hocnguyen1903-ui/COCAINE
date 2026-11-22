#!/usr/bin/env node
const { execSync } = require("child_process");
execSync(
  'npx clasp push && npx clasp deploy -i AKfycbxaJkfAEWLuPfw8n3J0kGCpcGHAX2WgC9qQ6Mdh6eCXA4hwzbHCfhkmphOf-uxYKg0 -d "Quick update"',
  { stdio: "inherit" }
);
