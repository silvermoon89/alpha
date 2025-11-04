// 基础配置与常量
module.exports = {
  PORT: Number(process.env.PORT) || 3000,
  API_URL: process.env.API_URL || 'https://alpha123.uk/api/data?t=1751632712002&fresh=1',
  REQUEST_TIMEOUT_MS: Number(process.env.REQUEST_TIMEOUT_MS) || 30000,
  RETRY_COUNT: Number(process.env.RETRY_COUNT) || 3,
  RETRY_DELAY_MS: Number(process.env.RETRY_DELAY_MS) || 1500,
  POLL_INTERVAL_MS: Number(process.env.POLL_INTERVAL_MS) || 10 * 60 * 1000,
  CACHE_TTL_MS: Number(process.env.CACHE_TTL_MS) || 5 * 60 * 1000
}
