import type { StateStore } from '../lib/state-store.js'
import type { RedeemCodesData, ItemsData, StateData } from '../types.js'
import { generateRandomString, getFilesMetadata } from '../lib/utils.js'
import type { FileMeta } from '../types.js'

export class PickService {
  stateStore: StateStore | null

  ipDrawRecords: Map<string, string> = new Map()
  redeemCodes: Map<string, boolean> = new Map()
  ipFileHistory: Map<string, Set<string>> = new Map()
  codeResults: Map<string, { file: FileMeta; downloadUrl: string; timestamp: string }> = new Map()

  constructor(stateStore: StateStore | null) {
    this.stateStore = stateStore
  }

  listFiles(filesModeRoot: string): FileMeta[] {
    return getFilesMetadata(filesModeRoot)
  }

  pickFile(candidates: FileMeta[]): FileMeta {
    return candidates[Math.floor(Math.random() * candidates.length)]
  }

  pickRandomItem(items: string[]): string {
    return items[Math.floor(Math.random() * items.length)]
  }

  private loadRedeemCodesData(): RedeemCodesData {
    if (!this.stateStore) return { codes: {} }
    const data = this.stateStore.load()
    const codesData = data.redeem_codes
    if (!codesData || typeof codesData !== 'object' || Array.isArray(codesData)) {
      return { codes: {} }
    }
    const result: RedeemCodesData = {
      codes: {},
    }
    if (codesData.codes && typeof codesData.codes === 'object' && !Array.isArray(codesData.codes)) {
      result.codes = codesData.codes as Record<string, unknown> as RedeemCodesData['codes']
    }
    return result
  }

  private saveRedeemCodesData(data: RedeemCodesData): void {
    if (!this.stateStore) return
    const fullData = this.stateStore.load()
    fullData.redeem_codes = data
    this.stateStore.save(fullData)
  }

  loadRedeemCodesFromStorage(): Map<string, boolean> {
    const data = this.loadRedeemCodesData()
    const codes = data.codes || {}
    const out = new Map<string, boolean>()
    for (const [k, v] of Object.entries(codes)) {
      const code = String(k).trim().toUpperCase()
      if (!code) continue
      let used = false
      if (typeof v === 'object' && v !== null) {
        used = Boolean((v as RedeemCodesData['codes'][string] & { used?: boolean }).used)
      } else if (typeof v === 'boolean') {
        used = v
      }
      out.set(code, used)
    }
    return out
  }

  exportRedeemCodesFromStorage(onlyUnused: boolean = false): Array<{ code: string; used: boolean }> {
    const data = this.loadRedeemCodesData()
    const codes = data.codes || {}
    const out: Array<{ code: string; used: boolean }> = []
    const sortedKeys = Object.keys(codes).sort()
    for (const k of sortedKeys) {
      const code = String(k).trim().toUpperCase()
      if (!code) continue
      const v = codes[k]
      let used = false
      if (typeof v === 'object' && v !== null) {
        used = Boolean((v as { used?: boolean }).used)
      } else if (typeof v === 'boolean') {
        used = v
      }
      if (onlyUnused && used) continue
      out.push({ code, used })
    }
    return out
  }

  addRedeemCodeToStorage(code: string): boolean {
    code = (code || '').trim().toUpperCase()
    if (!code) return false
    const data = this.loadRedeemCodesData()
    const codes = data.codes || {}
    if (code in codes) return false
    codes[code] = { used: false }
    data.codes = codes
    this.saveRedeemCodesData(data)
    return true
  }

  deleteRedeemCodeFromStorage(code: string): boolean | null {
    code = (code || '').trim().toUpperCase()
    if (!code) return null
    const data = this.loadRedeemCodesData()
    const codes = data.codes || {}
    if (!(code in codes)) return false
    try {
      delete codes[code]
    } catch {
      return false
    }
    data.codes = codes
    this.saveRedeemCodesData(data)
    return true
  }

  clearRedeemCodesInStorage(): number {
    const data = this.loadRedeemCodesData()
    const codes = data.codes || {}
    const n = Object.keys(codes).length
    data.codes = {}
    this.saveRedeemCodesData(data)
    return n
  }

  resetRedeemCodeUnusedInStorage(code: string): boolean | null {
    code = (code || '').trim().toUpperCase()
    if (!code) return null
    const data = this.loadRedeemCodesData()
    const codes = data.codes || {}
    if (!(code in codes)) return false
    const v = codes[code]
    let used = false
    if (typeof v === 'object' && v !== null) {
      used = Boolean((v as { used?: boolean }).used)
    } else if (typeof v === 'boolean') {
      used = v
    }
    if (!used) return false
    codes[code] = { used: false }
    data.codes = codes
    this.saveRedeemCodesData(data)
    return true
  }

  markRedeemCodeUsedInStorage(code: string): boolean {
    code = (code || '').trim().toUpperCase()
    if (!code) return false
    const data = this.loadRedeemCodesData()
    const codes = data.codes || {}
    if (!(code in codes)) return false
    const v = codes[code]
    if (typeof v === 'object' && v !== null) {
      if ((v as { used?: boolean }).used) return false
      codes[code] = { used: true }
    } else if (typeof v === 'boolean') {
      if (v) return false
      codes[code] = true
    } else {
      codes[code] = { used: true }
    }
    data.codes = codes
    this.saveRedeemCodesData(data)
    return true
  }

  generateAndAddRedeemCodesToStorage(count: number, length: number = 4): string[] {
    const n = Math.floor(count)
    if (n <= 0) return []

    const data = this.loadRedeemCodesData()
    const codes = data.codes || {}
    const existed = new Set(
      Object.keys(codes)
        .map((k) => String(k).trim().toUpperCase())
        .filter(Boolean),
    )

    const newCodes: string[] = []
    let tries = 0
    const maxTries = Math.max(100, n * 50)
    let extra = 0
    let curLen = Math.max(length, 1)

    while (newCodes.length < n && tries < maxTries) {
      tries++
      const code = generateRandomString(curLen)
      if (!code || existed.has(code)) {
        extra++
        if (extra >= 20) {
          extra = 0
          curLen = Math.min(curLen + 1, 16)
        }
        continue
      }
      existed.add(code)
      newCodes.push(code)
      codes[code] = { used: false }
    }

    data.codes = codes
    this.saveRedeemCodesData(data)

    for (const c of newCodes) {
      this.redeemCodes.set(c, false)
    }

    return newCodes
  }

  loadItemsData(): ItemsData {
    if (!this.stateStore) return { items: [] }
    const data = this.stateStore.load()
    const itemsData = data.items
    if (!itemsData || typeof itemsData !== 'object' || Array.isArray(itemsData)) {
      return { items: [] }
    }
    const result: ItemsData = { items: [] }
    if (Array.isArray(itemsData.items)) {
      result.items = itemsData.items as string[]
    }
    return result
  }

  private saveItemsData(data: ItemsData): void {
    if (!this.stateStore) return
    const fullData = this.stateStore.load()
    fullData.items = data
    this.stateStore.save(fullData)
  }

  addItem(item: string): boolean {
    if (!item || !item.trim()) return false
    const trimmed = item.trim()
    const data = this.loadItemsData()
    const items = data.items || []
    if (items.includes(trimmed)) return false
    items.push(trimmed)
    data.items = items
    this.saveItemsData(data)
    return true
  }

  addItems(items: string[]): string[] {
    const duplicates: string[] = []
    const data = this.loadItemsData()
    const existingItems = new Set(data.items || [])
    const newItems: string[] = []
    for (const item of items) {
      if (!item || !item.trim()) continue
      const trimmed = item.trim()
      if (existingItems.has(trimmed)) {
        duplicates.push(trimmed)
      } else {
        newItems.push(trimmed)
        existingItems.add(trimmed)
      }
    }
    if (newItems.length > 0) {
      data.items = [...(data.items || []), ...newItems]
      this.saveItemsData(data)
    }
    return duplicates
  }

  removeItem(item: string): boolean {
    if (!item || !item.trim()) return false
    const trimmed = item.trim()
    const data = this.loadItemsData()
    const items = data.items || []
    const idx = items.indexOf(trimmed)
    if (idx === -1) return false
    items.splice(idx, 1)
    data.items = items
    this.saveItemsData(data)
    return true
  }

  clearItems(): number {
    const data = this.loadItemsData()
    const count = (data.items || []).length
    data.items = []
    this.saveItemsData(data)
    return count
  }

  updateItems(items: string[]): void {
    const data = this.loadItemsData()
    data.items = items
      .filter((item) => item && item.trim())
      .map((item) => item.trim())
    this.saveItemsData(data)
  }
}