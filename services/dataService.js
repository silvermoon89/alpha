const axios = require('axios')
const { API_URL, REQUEST_TIMEOUT_MS, RETRY_COUNT, RETRY_DELAY_MS, POLL_INTERVAL_MS, CACHE_TTL_MS } = require('../config')
const logger = require('../logger')

let cachedData = null
let lastFetchTime = null
let previousDataHash = null
let pollingTimer = null

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function generateDataHash(data) {
  if (!data || !data.airdrops) return null
  const airdrops = data.airdrops.map(airdrop => ({
    token: airdrop.token,
    status: airdrop.status,
    date: airdrop.date,
    time: airdrop.time
  }))
  return JSON.stringify(airdrops)
}

function processAirdropStatus(airdrops) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return airdrops.map(airdrop => {
    const processed = { ...airdrop }
    if (processed.phase === 2 && processed.date) {
      const baseDate = new Date(processed.date + (processed.time ? 'T' + processed.time : 'T00:00'))
      baseDate.setHours(baseDate.getHours() + 18)
      processed.date = baseDate.toISOString().slice(0, 10)
      processed.time = baseDate.toTimeString().slice(0, 5)
    }
    if (processed.date) {
      const airdropDate = new Date(processed.date)
      airdropDate.setHours(0, 0, 0, 0)
      if (airdropDate < today) {
        processed.status = 'completed'
        processed.original_status = airdrop.status
      } else if (airdropDate.getTime() === today.getTime()) {
        if (processed.time) {
          const [hours, minutes] = processed.time.split(':').map(Number)
          const airdropDateTime = new Date(processed.date)
          airdropDateTime.setHours(hours || 0, minutes || 0, 0, 0)
          if (airdropDateTime <= new Date()) {
            processed.status = 'completed'
            processed.original_status = airdrop.status
          } else {
            processed.status = 'announced'
            processed.original_status = airdrop.status
          }
        } else {
          processed.status = 'announced'
          processed.original_status = airdrop.status
        }
      } else {
        processed.status = 'announced'
        processed.original_status = airdrop.status
      }
    }
    return processed
  })
}

async function fetchDataOnce() {
  const response = await axios.get(API_URL, {
    headers: {
      'accept': 'application/json, text/plain, */*',
      'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'cache-control': 'no-cache',
      'pragma': 'no-cache',
      'referer': 'https://alpha123.uk/',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    },
    timeout: REQUEST_TIMEOUT_MS
  })
  const data = response.data || {}
  const airdrops = Array.isArray(data.airdrops) ? data.airdrops : []
  const processedAirdrops = processAirdropStatus(airdrops).sort((a, b) => {
    const dateA = a.date || ''
    const dateB = b.date || ''
    if (dateA !== dateB) return dateB.localeCompare(dateA)
    if (!a.time && b.time) return -1
    if (a.time && !b.time) return 1
    if (a.time && b.time) return b.time.localeCompare(a.time)
    return 0
  })
  return { ...data, airdrops: processedAirdrops }
}

async function fetchDataWithRetry() {
  let attempt = 0
  while (true) {
    try {
      attempt += 1
      logger.info(`请求数据，尝试 ${attempt}/${RETRY_COUNT}`)
      return await fetchDataOnce()
    } catch (err) {
      if (attempt >= RETRY_COUNT) {
        logger.error('数据请求失败，已达最大重试次数', err.message)
        throw err
      }
      logger.warn(`请求失败：${err.message}，${RETRY_DELAY_MS}ms 后重试`)
      await sleep(RETRY_DELAY_MS)
    }
  }
}

function detectDataChanges(newData) {
  const newHash = generateDataHash(newData)
  if (previousDataHash && newHash !== previousDataHash) {
    logger.info('检测到数据变化')
    previousDataHash = newHash
    return true
  }
  previousDataHash = newHash
  return false
}

async function updateData() {
  try {
    const data = await fetchDataWithRetry()
    const hasChanges = detectDataChanges(data)
    cachedData = data
    lastFetchTime = new Date()
    logger.info(`数据更新成功: ${lastFetchTime.toISOString()} 变化: ${hasChanges}`)
    return { data, hasChanges, lastUpdateTime: lastFetchTime.toISOString() }
  } catch (error) {
    logger.error('更新数据失败', error.message)
    throw error
  }
}

function getData() {
  if (cachedData && lastFetchTime && (Date.now() - lastFetchTime.getTime()) < CACHE_TTL_MS) {
    return { data: cachedData, fromCache: true }
  }
  return { data: null, fromCache: false }
}

function getLastUpdate() {
  return lastFetchTime ? lastFetchTime.toISOString() : null
}

function startPolling() {
  if (pollingTimer) return
  logger.info(`启动轮询，间隔 ${POLL_INTERVAL_MS}ms`)
  updateData().catch(() => {})
  pollingTimer = setInterval(() => {
    updateData().catch(() => {})
  }, POLL_INTERVAL_MS)
}

module.exports = {
  startPolling,
  updateData,
  getData,
  getLastUpdate
}


