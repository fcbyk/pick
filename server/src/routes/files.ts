import { Router, type Request, type Response } from 'express'
import { existsSync, statSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import type { PickService } from '../services/pick.service.js'
import type { AppConfig } from '../types.js'

export function registerFilesRoutes(router: Router, service: PickService, getConfig: () => AppConfig): void {
  const SERVER_SESSION_ID = getConfig().filesRoot ? 'ts-' + Date.now().toString(36) : ''

  router.get('/api/files', (req: Request, res: Response) => {
    const config = getConfig()
    const filesRoot = config.filesRoot
    if (!filesRoot) {
      res.status(400).json({ error: 'files mode not enabled' })
      return
    }
    const files = service.listFiles(filesRoot)
    const resp: Record<string, unknown> = {
      files: files.map((f) => ({ name: f.name, size: f.size })),
      session_id: SERVER_SESSION_ID,
    }
    if (service.redeemCodes.size > 0) {
      const total = service.redeemCodes.size
      const used = [...service.redeemCodes.values()].filter(Boolean).length
      resp.mode = 'code'
      resp.total_codes = total
      resp.used_codes = used
      resp.draw_count = used
      resp.limit_per_code = 1
    } else {
      const clientIp = getClientIp(req)
      const picked = service.ipDrawRecords.get(clientIp)
      resp.mode = 'ip'
      resp.draw_count = service.ipDrawRecords.size
      resp.ip_picked = picked || null
      resp.limit_per_ip = 1
    }
    res.json(resp)
  })

  router.post('/api/files/pick', (req: Request, res: Response) => {
    const config = getConfig()
    const filesRoot = config.filesRoot
    if (!filesRoot) {
      res.status(400).json({ error: 'files mode not enabled' })
      return
    }
    const files = service.listFiles(filesRoot)
    if (files.length === 0) {
      res.status(400).json({ error: 'no files available' })
      return
    }
    const clientIp = getClientIp(req)

    if (service.redeemCodes.size > 0) {
      const data = req.body || {}
      const code = String(data.code || '').trim().toUpperCase()
      if (!code) {
        res.status(400).json({ error: '请输入兑换码' })
        return
      }
      if (!service.redeemCodes.has(code)) {
        res.status(400).json({ error: '兑换码无效' })
        return
      }
      if (service.redeemCodes.get(code)) {
        res.status(429).json({ error: '兑换码已被使用' })
        return
      }

      const usedByIp = service.ipFileHistory.get(clientIp) || new Set()
      const candidates = files.filter((f) => !usedByIp.has(f.name))
      if (candidates.length === 0) {
        res.status(400).json({ error: '本 IP 已无可抽取的文件' })
        return
      }

      const selected = service.pickFile(candidates)
      service.redeemCodes.set(code, true)
      try {
        service.markRedeemCodeUsedInStorage(code)
      } catch { /* ignore */ }
      if (!service.ipFileHistory.has(clientIp)) {
        service.ipFileHistory.set(clientIp, new Set())
      }
      service.ipFileHistory.get(clientIp)!.add(selected.name)
      const used = [...service.redeemCodes.values()].filter(Boolean).length
      const downloadUrl = buildDownloadUrl(req, selected.name)
      const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19)
      service.codeResults.set(code, {
        file: selected,
        downloadUrl,
        timestamp,
      })
      console.log(
        `[${timestamp}] ${clientIp} draw file: ${selected.name} successfully, redeem code: ${code} used, remaining redeem codes: ${service.redeemCodes.size - used}`,
      )
      res.json({
        file: { name: selected.name, size: selected.size },
        download_url: downloadUrl,
        mode: 'code',
        draw_count: used,
        total_codes: service.redeemCodes.size,
        used_codes: used,
        code,
      })
      return
    }

    if (service.ipDrawRecords.has(clientIp)) {
      res.status(429).json({
        error: 'already picked',
        picked: service.ipDrawRecords.get(clientIp),
      })
      return
    }

    const usedByIp = service.ipFileHistory.get(clientIp) || new Set()
    const candidates = files.filter((f) => !usedByIp.has(f.name))
    if (candidates.length === 0) {
      res.status(400).json({ error: '本 IP 已无可抽取的文件' })
      return
    }

    const selected = service.pickFile(candidates)
    service.ipDrawRecords.set(clientIp, selected.name)
    if (!service.ipFileHistory.has(clientIp)) {
      service.ipFileHistory.set(clientIp, new Set())
    }
    service.ipFileHistory.get(clientIp)!.add(selected.name)
    const downloadUrl = buildDownloadUrl(req, selected.name)
    res.json({
      file: { name: selected.name, size: selected.size },
      download_url: downloadUrl,
      mode: 'ip',
      draw_count: service.ipDrawRecords.size,
      ip_picked: selected.name,
    })
  })

  router.get('/api/files/result/:code', (req: Request, res: Response) => {
    const config = getConfig()
    if (!config.filesRoot) {
      res.status(400).json({ error: 'files mode not enabled' })
      return
    }
    const code = String(req.params.code || '').trim().toUpperCase()
    if (!service.codeResults.has(code)) {
      res.status(404).json({ error: '兑换码未使用或结果不存在' })
      return
    }
    const result = service.codeResults.get(code)!
    res.json({
      code,
      file: { name: result.file.name, size: result.file.size },
      download_url: result.downloadUrl,
      timestamp: result.timestamp,
    })
  })

  router.get('/api/files/download/:filename', (req: Request, res: Response) => {
    const config = getConfig()
    const filesRoot = config.filesRoot
    if (!filesRoot) {
      res.status(400).json({ error: 'files mode not enabled' })
      return
    }

    const filename = req.params.filename

    if (statSync(filesRoot).isFile()) {
      if (filename !== basename(filesRoot)) {
        res.status(404).json({ error: 'file not found' })
        return
      }
      res.download(filesRoot, filename)
      return
    }

    const safeRoot = resolve(filesRoot)
    const targetPath = resolve(join(safeRoot, filename))
    if (!targetPath.startsWith(safeRoot + '/') && targetPath !== safeRoot) {
      res.status(400).json({ error: 'invalid path' })
      return
    }
    if (!existsSync(targetPath) || !statSync(targetPath).isFile()) {
      res.status(404).json({ error: 'file not found' })
      return
    }
    res.download(targetPath, basename(targetPath))
  })
}

function getClientIp(req: Request): string {
  const xff = req.headers['x-forwarded-for']
  if (typeof xff === 'string') {
    return xff.split(',')[0].trim()
  }
  return req.ip || req.socket?.remoteAddress || 'unknown'
}

function buildDownloadUrl(req: Request, filename: string): string {
  const protocol = req.protocol || 'http'
  const host = req.get('host') || 'localhost'
  return `${protocol}://${host}/api/files/download/${encodeURIComponent(filename)}`
}