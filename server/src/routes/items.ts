import { Router, type Request, type Response } from 'express'
import type { PickService } from '../services/pick.service.js'

export function registerItemsRoutes(router: Router, service: PickService): void {
  router.get('/api/items', (_req: Request, res: Response) => {
    const data = service.loadItemsData()
    const items = data.items || []
    res.json({ items: Array.isArray(items) ? items : [] })
  })

  router.post('/api/items/add', (req: Request, res: Response) => {
    const data = req.body || {}
    const item = String(data.item || '').trim()
    if (!item) {
      res.status(400).json({ error: '元素不能为空' })
      return
    }
    const success = service.addItem(item)
    if (!success) {
      res.status(400).json({ error: '元素已存在' })
      return
    }
    res.json({ success: true, item })
  })

  router.post('/api/items/batch', (req: Request, res: Response) => {
    const data = req.body || {}
    const itemsStr = String(data.items || '')
    if (!itemsStr) {
      res.status(400).json({ error: '元素列表不能为空' })
      return
    }
    const items = itemsStr
      .split(/[\n\r,;]+/)
      .map((s: string) => s.trim())
      .filter((s: string) => s)
    if (items.length === 0) {
      res.status(400).json({ error: '没有有效的元素' })
      return
    }
    const duplicates = service.addItems(items)
    res.json({
      success: true,
      added_count: items.length - duplicates.length,
      duplicates,
    })
  })

  router.delete('/api/items/remove', (req: Request, res: Response) => {
    const data = req.body || {}
    const item = String(data.item || '').trim()
    if (!item) {
      res.status(400).json({ error: '元素不能为空' })
      return
    }
    const success = service.removeItem(item)
    if (!success) {
      res.status(400).json({ error: '元素不存在' })
      return
    }
    res.json({ success: true, item })
  })

  router.delete('/api/items/clear', (_req: Request, res: Response) => {
    const count = service.clearItems()
    res.json({ success: true, cleared_count: count })
  })

  router.put('/api/items/update', (req: Request, res: Response) => {
    const data = req.body || {}
    const items = data.items
    if (!Array.isArray(items)) {
      res.status(400).json({ error: 'items 必须是列表' })
      return
    }
    service.updateItems(items)
    res.json({ success: true, count: items.length })
  })
}