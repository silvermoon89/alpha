const express = require('express')
const path = require('path')
const logger = require('../logger')
const { updateData, getData, getLastUpdate } = require('../services/dataService')

const router = express.Router()

router.get('/fetch-data', async (req, res) => {
  try {
    const cache = getData()
    if (cache.data) {
      logger.info('命中缓存，直接返回')
      return res.json(cache.data)
    }
    const { data, hasChanges, lastUpdateTime } = await updateData()
    return res.json({ ...data, hasChanges, lastUpdateTime })
  } catch (error) {
    logger.error('获取数据失败', error.message)
    return res.status(500).json({
      error: error.message,
      details: { type: error.name, timestamp: new Date().toISOString() }
    })
  }
})

router.get('/last-update', (req, res) => {
  return res.json({
    lastFetchTime: getLastUpdate(),
    hasCachedData: !!getData().data
  })
})

// 主页（保留 /alpha 兼容，同时提供 /）
router.get(['/alpha', '/'], (req, res) => {
  res.sendFile(path.join(process.cwd(), 'public', 'index.html'))
})

module.exports = router
