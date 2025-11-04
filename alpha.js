const express = require('express')
const { PORT } = require('./config')
const logger = require('./logger')
const router = require('./routes')
const { startPolling } = require('./services/dataService')

const app = express()

// 静态资源
app.use(express.static('public'))

// 路由
app.use('/', router)

app.listen(PORT, () => {
  logger.info(`服务器运行在 http://localhost:${PORT}`)
  startPolling()
})


