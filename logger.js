function formatNow() {
  const now = new Date()
  const iso = now.toISOString()
  return iso
}

function logWith(level, args) {
  const prefix = `[${formatNow()}] [${level}]`
  // 保留 console 的原始格式化能力
  console.log(prefix, ...args)
}

module.exports = {
  info: (...args) => logWith('INFO', args),
  warn: (...args) => logWith('WARN', args),
  error: (...args) => logWith('ERROR', args)
}


