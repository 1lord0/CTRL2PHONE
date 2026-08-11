import { readE2eConfig } from "../src/config.mjs";
import { runCtrl2PhoneE2e } from "../src/e2e-runner.mjs";

const result = await runCtrl2PhoneE2e(readE2eConfig());
console.log(JSON.stringify(result));
