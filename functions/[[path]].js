// Cloudflare Pages Functions
// 说明：
// - 仅拦截 /fetch-data 与 /last-update 两个接口
// - 其他路径使用 next() 交给 Pages 静态资源处理
// - 使用全局变量作为轻量缓存（每个 Worker 实例独立、可能会重置）

let cachedData = null
let lastFetchTime = null
let previousDataHash = null

function getEnvNumber(env, key, fallback) {
  const v = env && env[key]
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

function getEnvString(env, key, fallback) {
  const v = env && env[key]
  return typeof v === 'string' && v.length > 0 ? v : fallback
}

function generateDataHash(data) {
  if (!data || !Array.isArray(data.airdrops)) return null
  const airdrops = data.airdrops.map(a => ({
    token: a.token,
    status: a.status,
    date: a.date,
    time: a.time
  }))
  return JSON.stringify(airdrops)
}

function processAirdropStatus(airdrops) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return airdrops.map(airdrop => {
    const processed = { ...airdrop }
    if (processed.phase === 2 && processed.date) {
      const base = new Date(processed.date + (processed.time ? 'T' + processed.time : 'T00:00'))
      base.setHours(base.getHours() + 18)
      processed.date = base.toISOString().slice(0, 10)
      processed.time = base.toTimeString().slice(0, 5)
    }
    if (processed.date) {
      const d = new Date(processed.date)
      d.setHours(0, 0, 0, 0)
      if (d < today) {
        processed.status = 'completed'
        processed.original_status = airdrop.status
      } else if (d.getTime() === today.getTime()) {
        if (processed.time) {
          const [h, m] = processed.time.split(':').map(Number)
          const dt = new Date(processed.date)
          dt.setHours(h || 0, m || 0, 0, 0)
          if (dt <= new Date()) {
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

async function fetchDataOnce(apiUrl, requestTimeoutMs) {
  const ctrl = new AbortController()
  const id = setTimeout(() => ctrl.abort('timeout'), requestTimeoutMs)
  try {
    const resp = await fetch(apiUrl, {
      headers: {
        accept: 'application/json, text/plain, */*',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'cache-control': 'no-cache',
        pragma: 'no-cache',
        referer: 'https://alpha123.uk/',
        'user-agent': 'Mozilla/5.0 (compatible; Cloudflare-Worker)'
      },
      signal: ctrl.signal
    })
    if (!resp.ok) throw new Error(`status ${resp.status}`)
    const data = await resp.json()
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
  } finally {
    clearTimeout(id)
  }
}

async function fetchDataWithRetry(apiUrl, timeoutMs, retryCount, retryDelayMs) {
  let attempt = 0
  // 简单线性重试
  while (attempt < retryCount) {
    try {
      attempt++
      return await fetchDataOnce(apiUrl, timeoutMs)
    } catch (err) {
      if (attempt >= retryCount) throw err
      await new Promise(r => setTimeout(r, retryDelayMs))
    }
  }
}

function shouldUseCache(cacheTtlMs) {
  if (!cachedData || !lastFetchTime) return false
  return Date.now() - lastFetchTime.getTime() < cacheTtlMs
}

function detectDataChanges(newData) {
  const newHash = generateDataHash(newData)
  const changed = previousDataHash && newHash !== previousDataHash
  previousDataHash = newHash
  return !!changed
}

export async function onRequest(context) {
  const { request, next, env } = context
  const url = new URL(request.url)

  // 环境变量与默认值
  const API_URL = getEnvString(
    env,
    'API_URL',
    'https://alpha123.uk/api/data?t=1751632712002&fresh=1'
  )
  const REQUEST_TIMEOUT_MS = getEnvNumber(env, 'REQUEST_TIMEOUT_MS', 30000)
  const RETRY_COUNT = getEnvNumber(env, 'RETRY_COUNT', 3)
  const RETRY_DELAY_MS = getEnvNumber(env, 'RETRY_DELAY_MS', 1500)
  const CACHE_TTL_MS = getEnvNumber(env, 'CACHE_TTL_MS', 5 * 60 * 1000)

  if (request.method === 'GET' && url.pathname === '/fetch-data') {
    try {
      if (shouldUseCache(CACHE_TTL_MS)) {
        return new Response(JSON.stringify(cachedData), {
          headers: {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store'
          }
        })
      }
      const data = await fetchDataWithRetry(
        API_URL,
        REQUEST_TIMEOUT_MS,
        RETRY_COUNT,
        RETRY_DELAY_MS
      )
      const hasChanges = detectDataChanges(data)
      cachedData = data
      lastFetchTime = new Date()
      const responseData = { ...data, hasChanges, lastUpdateTime: lastFetchTime.toISOString() }
      return new Response(JSON.stringify(responseData), {
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
      })
    } catch (error) {
      const body = {
        error: error.message,
        details: { type: error.name, timestamp: new Date().toISOString() }
      }
      return new Response(JSON.stringify(body), {
        status: 500,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
      })
    }
  }

  if (request.method === 'GET' && url.pathname === '/last-update') {
    const body = {
      lastFetchTime: lastFetchTime ? lastFetchTime.toISOString() : null,
      hasCachedData: !!cachedData
    }
    return new Response(JSON.stringify(body), {
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
    })
  }

  // 非 API 路由交给 Pages 处理静态资源
  return next()
}
