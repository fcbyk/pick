import { Router, type Request, type Response } from 'express'
import type { PickService } from '../services/pick.service.js'
import type { AppConfig } from '../types.js'

export function registerAdminRoutes(router: Router, service: PickService, getConfig: () => AppConfig): void {
  function requireAdminAuth(req: Request, res: Response): boolean {
    const password = getConfig().adminPassword
    if (!password) {
      res.status(500).json({ error: 'admin password not set' })
      return false
    }
    const reqPassword = req.headers['x-admin-password'] || ''
    if (reqPassword !== password) {
      res.status(401).json({ error: 'unauthorized' })
      return false
    }
    return true
  }

  router.post('/api/admin/login', (req: Request, res: Response) => {
    const adminPassword = getConfig().adminPassword
    if (!adminPassword) {
      res.status(500).json({ error: 'admin password not set' })
      return
    }
    const data = req.body || {}
    const password = String(data.password || '')
    if (password !== adminPassword) {
      res.status(401).json({ error: 'invalid password' })
      return
    }
    res.json({ success: true })
  })

  router.get('/api/admin/codes', (req: Request, res: Response) => {
    if (!requireAdminAuth(req, res)) return
    const codesList = [...service.redeemCodes.entries()].map(([code, used]) => ({
      code,
      used,
    }))
    const total = codesList.length
    const used = codesList.filter((c) => c.used).length
    res.json({
      codes: codesList,
      total_codes: total,
      used_codes: used,
      left_codes: total - used,
    })
  })

  router.post('/api/admin/codes/add', (req: Request, res: Response) => {
    if (!requireAdminAuth(req, res)) return
    const data = req.body || {}
    const code = String(data.code || '').trim().toUpperCase()
    if (!code) {
      res.status(400).json({ error: '兑换码不能为空' })
      return
    }
    if (!/^[A-Z0-9]+$/.test(code)) {
      res.status(400).json({ error: '兑换码只能包含字母和数字' })
      return
    }
    if (service.redeemCodes.has(code)) {
      res.status(400).json({ error: '兑换码已存在' })
      return
    }
    service.redeemCodes.set(code, false)
    try {
      service.addRedeemCodeToStorage(code)
    } catch { /* ignore */ }
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19)
    console.log(`[${timestamp}] Admin added new redeem code: ${code}`)
    res.json({
      success: true,
      code,
      message: `成功新增兑换码: ${code}`,
    })
  })

  router.post('/api/admin/codes/gen', (req: Request, res: Response) => {
    if (!requireAdminAuth(req, res)) return
    const data = req.body || {}
    const count = data.count
    const n = parseInt(String(count), 10)
    if (isNaN(n)) {
      res.status(400).json({ error: 'count must be int' })
      return
    }
    if (n <= 0) {
      res.status(400).json({ error: 'count must be > 0' })
      return
    }
    if (n > 100) {
      res.status(400).json({ error: 'count max is 100' })
      return
    }
    let newCodes: string[] = []
    try {
      newCodes = service.generateAndAddRedeemCodesToStorage(n)
    } catch (e) {
      res.status(500).json({ error: `failed to generate codes: ${e}` })
      return
    }
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19)
    console.log(`[${timestamp}] Admin generated redeem codes: requested=${n} generated=${newCodes.length}`)
    res.json({
      success: true,
      requested: n,
      generated_count: newCodes.length,
      generated: newCodes,
    })
  })

  router.delete('/api/admin/codes/:code', (req: Request, res: Response) => {
    if (!requireAdminAuth(req, res)) return
    const code = String(req.params.code || '').trim().toUpperCase()
    if (!code) {
      res.status(400).json({ error: 'invalid code' })
      return
    }
    if (!service.redeemCodes.has(code)) {
      res.status(404).json({ error: 'code not found' })
      return
    }
    const wasUsed = Boolean(service.redeemCodes.get(code))
    try {
      service.redeemCodes.delete(code)
    } catch { /* ignore */ }
    try {
      service.deleteRedeemCodeFromStorage(code)
    } catch { /* ignore */ }
    try {
      service.codeResults.delete(code)
    } catch { /* ignore */ }
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19)
    console.log(`[${timestamp}] Admin deleted redeem code: ${code}`)
    res.json({ success: true, code, was_used: wasUsed })
  })

  router.post('/api/admin/codes/clear', (req: Request, res: Response) => {
    if (!requireAdminAuth(req, res)) return
    const data = req.body || {}
    const confirm = Boolean(data.confirm)
    if (!confirm) {
      res.status(400).json({ error: 'confirm required' })
      return
    }
    const before = service.redeemCodes.size
    service.redeemCodes = new Map()
    service.codeResults = new Map()
    try {
      service.clearRedeemCodesInStorage()
    } catch { /* ignore */ }
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19)
    console.log(`[${timestamp}] Admin cleared redeem codes: ${before}`)
    res.json({ success: true, cleared: before })
  })

  router.post('/api/admin/codes/:code/reset', (req: Request, res: Response) => {
    if (!requireAdminAuth(req, res)) return
    const code = String(req.params.code || '').trim().toUpperCase()
    if (!code) {
      res.status(400).json({ error: 'invalid code' })
      return
    }
    if (!service.redeemCodes.has(code)) {
      res.status(404).json({ error: 'code not found' })
      return
    }
    service.redeemCodes.set(code, false)
    let ok: boolean | null = null
    try {
      ok = service.resetRedeemCodeUnusedInStorage(code)
    } catch {
      ok = null
    }
    try {
      service.codeResults.delete(code)
    } catch { /* ignore */ }
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19)
    console.log(`[${timestamp}] Admin reset redeem code to unused: ${code}`)
    res.json({ success: true, code, storage_reset: Boolean(ok) })
  })

  router.get('/api/admin/codes/export', (req: Request, res: Response) => {
    if (!requireAdminAuth(req, res)) return
    const onlyUnused = String(req.query.only_unused || '').trim() === '1'
    const fmt = String(req.query.format || '').trim().toLowerCase()
    let exported: Array<{ code: string; used: boolean }> = []
    try {
      exported = service.exportRedeemCodesFromStorage(onlyUnused)
    } catch (e) {
      res.status(500).json({ error: `export failed: ${e}` })
      return
    }
    if (fmt === 'text') {
      const lines = exported.map((item) => item.code).filter(Boolean)
      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      res.send(lines.join('\n'))
      return
    }
    const total = exported.length
    const used = exported.filter((c) => c.used).length
    res.json({
      codes: exported,
      total_codes: total,
      used_codes: used,
      left_codes: total - used,
    })
  })
}