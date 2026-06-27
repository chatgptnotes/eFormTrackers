const pool = require('../db/pool');
const { syncJotformMailSender } = require('../lib/jotform-mail-sender');
const { getDefaultProfile } = require('../lib/profiles');

function argVal(name) {
  const prefix = `--${name}=`;
  const found = process.argv.find(arg => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : '';
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

(async () => {
  const result = await syncJotformMailSender({
    profileId: argVal('profile') || getDefaultProfile().id,
    limit: hasFlag('all') ? 0 : (argVal('limit') ? parseInt(argVal('limit'), 10) : undefined),
    full: hasFlag('full'),
  });
  console.log(JSON.stringify(result, null, 2));
})()
  .catch(err => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await pool.end();
    } catch {}
  });
