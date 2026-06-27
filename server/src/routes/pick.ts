import { Router, type Request, type Response } from 'express'
import type { PickService } from '../services/pick.service.js'
import type { AppConfig } from '../types.js'

export function registerPickRoutes(router: Router, service: PickService, getConfig: () => AppConfig): void {
  router.post('/api/pick', (_req: Request, res: Response) => {
    const data = service.loadItemsData()
    const items = data.items || []
    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: 'no items available' })
      return
    }
    const selected = service.pickRandomItem(items)
    res.json({ item: selected, items })
  })

  router.get('/api/info', (_req: Request, res: Response) => {
    res.json({
      files_mode: getConfig().filesRoot !== null,
    })
  })
}