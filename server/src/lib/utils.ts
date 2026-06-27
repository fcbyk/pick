import { randomBytes } from 'node:crypto'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { FileMeta } from '../types.js'

const CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

export function generateRandomString(length: number = 4): string {
  const chars: string[] = []
  const bytes = randomBytes(length)
  for (let i = 0; i < length; i++) {
    chars.push(CHARSET[bytes[i] % CHARSET.length])
  }
  return chars.join('')
}

export function getFilesMetadata(rootPath: string): FileMeta[] {
  if (!rootPath || !existsSync(rootPath)) {
    return []
  }

  const stat = statSync(rootPath)
  if (stat.isFile()) {
    return [
      {
        name: basename(rootPath),
        path: rootPath,
        size: stat.size,
      },
    ]
  }

  const files: FileMeta[] = []
  try {
    const names = readdirSync(rootPath).sort()
    for (const name of names) {
      const fullPath = join(rootPath, name)
      const fileStat = statSync(fullPath)
      if (fileStat.isFile()) {
        files.push({
          name,
          path: fullPath,
          size: fileStat.size,
        })
      }
    }
  } catch {
    return []
  }
  return files
}