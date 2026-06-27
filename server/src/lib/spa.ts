import { type Express, static as expressStatic } from 'express'
import { resolve } from 'node:path'
import { existsSync } from 'node:fs'

export function setupSpa(app: Express, staticDir: string, spaPages: string[] = []): void {
  const resolvedDir = resolve(staticDir)
  const assetsDir = resolve(resolvedDir, 'assets')

  if (existsSync(assetsDir)) {
    app.use('/assets', expressStatic(assetsDir))
  }

  app.use(expressStatic(resolvedDir, { index: false }))

  const indexPath = resolve(resolvedDir, 'index.html')

  const serveIndex = (_req: any, res: any) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
    res.setHeader('Pragma', 'no-cache')
    res.setHeader('Expires', '0')
    res.sendFile(indexPath)
  }

  app.get('/', serveIndex)

  for (const page of spaPages) {
    app.get(page, serveIndex)
  }
}