import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import type { StateData } from '../types.js'

const ROOT_DIR = join(homedir(), '.byk')
const STATE_DIR = join(ROOT_DIR, 'state')
const PLUGINS_DIR = join(ROOT_DIR, 'plugins')

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

export class StateStore {
  readonly path: string

  constructor(path: string) {
    ensureDir(dirname(path))
    this.path = path
  }

  load(): StateData {
    if (!existsSync(this.path)) {
      return {}
    }
    try {
      const raw = readFileSync(this.path, 'utf-8')
      const data = JSON.parse(raw)
      return typeof data === 'object' && data !== null && !Array.isArray(data)
        ? (data as StateData)
        : {}
    } catch {
      return {}
    }
  }

  save(data: StateData): StateData {
    ensureDir(dirname(this.path))
    const tmp = this.path + '.tmp.' + Date.now()
    writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8')
    renameSync(tmp, this.path)
    return data
  }

  get<T = unknown>(key: string, defaultValue?: T): T | undefined {
    const data = this.load()
    return (data[key] as T) ?? defaultValue
  }

  set(key: string, value: unknown): StateData {
    const data = this.load()
    data[key] = value
    return this.save(data)
  }

  update(values: Record<string, unknown>): StateData {
    const data = this.load()
    Object.assign(data, values)
    return this.save(data)
  }

  delete(key: string): StateData {
    const data = this.load()
    delete data[key]
    return this.save(data)
  }

  clear(): StateData {
    return this.save({})
  }
}

export function getPluginStateStore(pluginName: string, stateName: string = 'state'): StateStore {
  return new StateStore(join(PLUGINS_DIR, pluginName, `${stateName}.json`))
}

export { ROOT_DIR, STATE_DIR, PLUGINS_DIR }