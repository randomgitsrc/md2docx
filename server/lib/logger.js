/**
 * logger.js — 轻量日志
 */

function ts() {
  return new Date().toISOString();
}

const logger = {
  info: (...a) => console.log(`[${ts()}] [info]`, ...a),
  warn: (...a) => console.warn(`[${ts()}] [warn]`, ...a),
  error: (...a) => console.error(`[${ts()}] [error]`, ...a),
  debug: (...a) => {
    if (process.env.DEBUG || process.env.NODE_ENV === 'development') {
      console.log(`[${ts()}] [debug]`, ...a);
    }
  },
};

module.exports = logger;
