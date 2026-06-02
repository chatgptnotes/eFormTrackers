/**
 * Top-level process guards. A stray rejected promise (failed JotForm fetch,
 * DB blip) would otherwise crash Node mid-test. We log and keep the process
 * alive; under IIS/iisnode the process is supervised, so an uncaught exception
 * still exits to let the host recycle a clean worker.
 */
let installed = false;

function installProcessGuards(logger) {
  if (installed) return;
  installed = true;

  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, '[process] unhandledRejection — keeping process alive');
  });

  process.on('uncaughtException', (err) => {
    logger.error({ err }, '[process] uncaughtException');
    // Synchronous, unrecoverable state — exit so the supervisor restarts a
    // clean worker. iisnode/PM2/systemd will relaunch.
    process.exit(1);
  });
}

module.exports = { installProcessGuards };
