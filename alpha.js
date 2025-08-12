const express = require('express')
const axios = require('axios')
const path = require('path')

const app = express()
const PORT = 3000

// 设置静态文件服务
app.use(express.static('public'))

// 全局变量存储最新数据
let cachedData = null
let lastFetchTime = null
let previousDataHash = null // 用于检测数据变化

// 生成数据哈希值用于比较
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

// 检测数据变化
function detectDataChanges(newData) {
  const newHash = generateDataHash(newData)
  
  if (previousDataHash && newHash !== previousDataHash) {
    console.log('检测到数据变化，准备发送通知...')
    return true
  }
  
  previousDataHash = newHash
  return false
}

// 处理空投状态的时间判断逻辑
function processAirdropStatus(airdrops) {
  const today = new Date()
  today.setHours(0, 0, 0, 0) // 设置为今天的开始时间
  
  return airdrops.map(airdrop => {
    let processedAirdrop = { ...airdrop }
    
    // 1. 阶段2加18小时
    if (processedAirdrop.phase === 2) {
      if (processedAirdrop.date) {
        let baseDate = new Date(processedAirdrop.date + (processedAirdrop.time ? 'T' + processedAirdrop.time : 'T00:00'))
        baseDate.setHours(baseDate.getHours() + 18)
        // 更新date和time字段（date为加18小时后的日期，time为加18小时后的时间）
        processedAirdrop.date = baseDate.toISOString().slice(0,10)
        processedAirdrop.time = baseDate.toTimeString().slice(0,5)
      }
    }

    // 所有状态判断都基于加18小时后的date和time
    if (processedAirdrop.date) {
      const airdropDate = new Date(processedAirdrop.date)
      airdropDate.setHours(0, 0, 0, 0)
      if (airdropDate < today) {
        processedAirdrop.status = 'completed'
        processedAirdrop.original_status = airdrop.status
      } else if (airdropDate.getTime() === today.getTime()) {
        if (processedAirdrop.time) {
          const [hours, minutes] = processedAirdrop.time.split(':').map(Number)
          const airdropDateTime = new Date(processedAirdrop.date)
          airdropDateTime.setHours(hours || 0, minutes || 0, 0, 0)
          if (airdropDateTime <= new Date()) {
            processedAirdrop.status = 'completed'
            processedAirdrop.original_status = airdrop.status
          } else {
            processedAirdrop.status = 'announced'
            processedAirdrop.original_status = airdrop.status
          }
        } else {
          processedAirdrop.status = 'announced'
          processedAirdrop.original_status = airdrop.status
        }
      } else {
        processedAirdrop.status = 'announced'
        processedAirdrop.original_status = airdrop.status
      }
    }
    
    return processedAirdrop
  })
}

// 获取数据的核心函数
async function fetchDataFromAPI() {
  try {
    console.log('正在使用 axios 访问接口...')
    
    const url = 'https://alpha123.uk/api/data?t=1751632712002&fresh=1'
    
    const response = await axios.get(url, {
      headers: {
        'accept': 'application/json, text/plain, */*',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'cache-control': 'no-cache',
        'pragma': 'no-cache',
        'referer': 'https://alpha123.uk/',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      timeout: 30000
    })
    
    console.log('axios 成功获取数据：',response.data)
    
    // 处理时间状态
    let processedAirdrops = processAirdropStatus(response.data.airdrops)

    // 按时间降序排序，且同一天无time的排前，有time的排后
    processedAirdrops = processedAirdrops.sort((a, b) => {
      const dateA = a.date || ''
      const dateB = b.date || ''
      if (dateA !== dateB) {
        return dateB.localeCompare(dateA)
      }
      if (!a.time && b.time) return -1
      if (a.time && !b.time) return 1
      if (a.time && b.time) {
        return b.time.localeCompare(a.time)
      }
      return 0
    })

    const processedData = {
      ...response.data,
      airdrops: processedAirdrops
    }
    
    return processedData
    
  } catch (error) {
    console.error('获取数据失败:', error.message)
    throw new Error(`无法访问目标接口: ${error.message}`)
  }
}

// 定时轮询函数
async function startPolling() {
  console.log('启动定时轮询，每10分钟更新一次数据...')
  
  // 立即执行一次
  await updateData()
  
  // 设置定时器，每10分钟执行一次
  setInterval(async () => {
    console.log('执行定时更新...')
    await updateData()
  }, 10 * 60 * 1000) // 10分钟
}

// 更新数据的函数
async function updateData() {
  try {
    const data = await fetchDataFromAPI()
    
    // 检测数据变化
    const hasChanges = detectDataChanges(data)
    
    cachedData = data
    lastFetchTime = new Date()
    console.log(`数据更新成功，时间: ${lastFetchTime.toLocaleString()}`)
    
    // 如果有变化，记录变化信息
    if (hasChanges) {
      console.log('数据发生变化，将在前端通知用户')
    }
    
  } catch (error) {
    console.error('定时更新失败:', error.message)
  }
}

app.get('/fetch-data', async (req, res) => {
  try {
    // 如果有缓存数据且缓存时间不超过5分钟，直接返回缓存
    if (cachedData && lastFetchTime && (new Date() - lastFetchTime) < 5 * 60 * 1000) {
      console.log('返回缓存数据')
      return res.json(cachedData)
    }
    
    // 否则重新获取数据
    const data = await fetchDataFromAPI()
    
    // 检测数据变化
    const hasChanges = detectDataChanges(data)
    
    cachedData = data
    lastFetchTime = new Date()
    
    // 在响应中包含变化信息
    const responseData = {
      ...data,
      hasChanges: hasChanges,
      lastUpdateTime: lastFetchTime.toISOString()
    }
    
    res.json(responseData)
  } catch (error) {
    console.error('获取数据失败:', error.message)
    
    const errorResponse = {
      error: error.message,
      details: {
        type: error.name,
        timestamp: new Date().toISOString()
      }
    }
    
    res.status(500).json(errorResponse)
  }
})

// 获取最后更新时间
app.get('/last-update', (req, res) => {
  res.json({
    lastFetchTime: lastFetchTime ? lastFetchTime.toISOString() : null,
    hasCachedData: !!cachedData
  })
})

// 主页路由
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

app.listen(PORT, () => {
  console.log(`服务器运行在 http://localhost:${PORT}`)
  console.log('使用 axios 访问目标接口')
  console.log('启动定时轮询，每10分钟更新一次数据')
  
  // 启动定时轮询
  startPolling()
})

const express = require('express')
const axios = require('axios')
const path = require('path')

const app = express()
const PORT = 3000

// 设置静态文件服务
app.use(express.static('public'))

// 全局变量存储最新数据
let cachedData = null
let lastFetchTime = null
let previousDataHash = null // 用于检测数据变化

// 生成数据哈希值用于比较
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

// 检测数据变化
function detectDataChanges(newData) {
  const newHash = generateDataHash(newData)
  
  if (previousDataHash && newHash !== previousDataHash) {
    console.log('检测到数据变化，准备发送通知...')
    return true
  }
  
  previousDataHash = newHash
  return false
}

// 处理空投状态的时间判断逻辑
function processAirdropStatus(airdrops) {
  const today = new Date()
  today.setHours(0, 0, 0, 0) // 设置为今天的开始时间
  
  return airdrops.map(airdrop => {
    let processedAirdrop = { ...airdrop }
    
    // 1. 阶段2加18小时
    if (processedAirdrop.phase === 2) {
      if (processedAirdrop.date) {
        let baseDate = new Date(processedAirdrop.date + (processedAirdrop.time ? 'T' + processedAirdrop.time : 'T00:00'))
        baseDate.setHours(baseDate.getHours() + 18)
        // 更新date和time字段（date为加18小时后的日期，time为加18小时后的时间）
        processedAirdrop.date = baseDate.toISOString().slice(0,10)
        processedAirdrop.time = baseDate.toTimeString().slice(0,5)
      }
    }

    // 所有状态判断都基于加18小时后的date和time
    if (processedAirdrop.date) {
      const airdropDate = new Date(processedAirdrop.date)
      airdropDate.setHours(0, 0, 0, 0)
      if (airdropDate < today) {
        processedAirdrop.status = 'completed'
        processedAirdrop.original_status = airdrop.status
      } else if (airdropDate.getTime() === today.getTime()) {
        if (processedAirdrop.time) {
          const [hours, minutes] = processedAirdrop.time.split(':').map(Number)
          const airdropDateTime = new Date(processedAirdrop.date)
          airdropDateTime.setHours(hours || 0, minutes || 0, 0, 0)
          if (airdropDateTime <= new Date()) {
            processedAirdrop.status = 'completed'
            processedAirdrop.original_status = airdrop.status
          } else {
            processedAirdrop.status = 'announced'
            processedAirdrop.original_status = airdrop.status
          }
        } else {
          processedAirdrop.status = 'announced'
          processedAirdrop.original_status = airdrop.status
        }
      } else {
        processedAirdrop.status = 'announced'
        processedAirdrop.original_status = airdrop.status
      }
    }
    
    return processedAirdrop
  })
}

// 获取数据的核心函数
async function fetchDataFromAPI() {
  try {
    console.log('正在使用 axios 访问接口...')
    
    const url = 'https://alpha123.uk/api/data?t=1751632712002&fresh=1'
    
    const response = await axios.get(url, {
      headers: {
        'accept': 'application/json, text/plain, */*',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'cache-control': 'no-cache',
        'pragma': 'no-cache',
        'referer': 'https://alpha123.uk/',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      timeout: 30000
    })
    
    console.log('axios 成功获取数据：',response.data)
    
    // 处理时间状态
    let processedAirdrops = processAirdropStatus(response.data.airdrops)

    // 按时间降序排序，且同一天无time的排前，有time的排后
    processedAirdrops = processedAirdrops.sort((a, b) => {
      const dateA = a.date || ''
      const dateB = b.date || ''
      if (dateA !== dateB) {
        return dateB.localeCompare(dateA)
      }
      if (!a.time && b.time) return -1
      if (a.time && !b.time) return 1
      if (a.time && b.time) {
        return b.time.localeCompare(a.time)
      }
      return 0
    })

    const processedData = {
      ...response.data,
      airdrops: processedAirdrops
    }
    
    return processedData
    
  } catch (error) {
    console.error('获取数据失败:', error.message)
    throw new Error(`无法访问目标接口: ${error.message}`)
  }
}

// 定时轮询函数
async function startPolling() {
  console.log('启动定时轮询，每10分钟更新一次数据...')
  
  // 立即执行一次
  await updateData()
  
  // 设置定时器，每10分钟执行一次
  setInterval(async () => {
    console.log('执行定时更新...')
    await updateData()
  }, 10 * 60 * 1000) // 10分钟
}

// 更新数据的函数
async function updateData() {
  try {
    const data = await fetchDataFromAPI()
    
    // 检测数据变化
    const hasChanges = detectDataChanges(data)
    
    cachedData = data
    lastFetchTime = new Date()
    console.log(`数据更新成功，时间: ${lastFetchTime.toLocaleString()}`)
    
    // 如果有变化，记录变化信息
    if (hasChanges) {
      console.log('数据发生变化，将在前端通知用户')
    }
    
  } catch (error) {
    console.error('定时更新失败:', error.message)
  }
}

app.get('/fetch-data', async (req, res) => {
  try {
    // 如果有缓存数据且缓存时间不超过5分钟，直接返回缓存
    if (cachedData && lastFetchTime && (new Date() - lastFetchTime) < 5 * 60 * 1000) {
      console.log('返回缓存数据')
      return res.json(cachedData)
    }
    
    // 否则重新获取数据
    const data = await fetchDataFromAPI()
    
    // 检测数据变化
    const hasChanges = detectDataChanges(data)
    
    cachedData = data
    lastFetchTime = new Date()
    
    // 在响应中包含变化信息
    const responseData = {
      ...data,
      hasChanges: hasChanges,
      lastUpdateTime: lastFetchTime.toISOString()
    }
    
    res.json(responseData)
  } catch (error) {
    console.error('获取数据失败:', error.message)
    
    const errorResponse = {
      error: error.message,
      details: {
        type: error.name,
        timestamp: new Date().toISOString()
      }
    }
    
    res.status(500).json(errorResponse)
  }
})

// 获取最后更新时间
app.get('/last-update', (req, res) => {
  res.json({
    lastFetchTime: lastFetchTime ? lastFetchTime.toISOString() : null,
    hasCachedData: !!cachedData
  })
})

// 主页路由
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'))
})

app.listen(PORT, () => {
  console.log(`服务器运行在 http://localhost:${PORT}`)
  console.log('使用 axios 访问目标接口')
  console.log('启动定时轮询，每10分钟更新一次数据')
  
  // 启动定时轮询
  startPolling()
})
