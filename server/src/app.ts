import express, { type Express } from 'express'
import { resolve } from 'node:path'
import { existsSync } from 'node:fs'
import type { PickService } from './services/pick.service.js'
import type { AppConfig } from './types.js'
import { setupSpa } from './lib/spa.js'
import { registerItemsRoutes } from './routes/items.js'
import { registerFilesRoutes } from './routes/files.js'
import { registerAdminRoutes } from './routes/admin.js'
import { registerPickRoutes } from './routes/pick.js'

export function createApp(config: AppConfig, service: PickService): Express {
  const app = express()

  app.use(express.json())

  const getConfig = (): AppConfig => config

  registerItemsRoutes(app, service)
  registerFilesRoutes(app, service, getConfig)
  registerAdminRoutes(app, service, getConfig)
  registerPickRoutes(app, service, getConfig)

  const staticDir = resolve(config.staticDir)
  if (existsSync(staticDir)) {
    setupSpa(app, staticDir, ['/admin', '/f'])
  }

  return app
}