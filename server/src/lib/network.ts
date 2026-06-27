import { networkInterfaces } from 'node:os'
import net from 'node:net'

interface IfaceRule {
  keywords: string[]
  type: string
  virtual: boolean
  priority: number
}

interface NetworkInfo {
  iface: string
  ips: string[]
  type: string
  virtual: boolean
  priority: number
}

const IFACE_RULES: IfaceRule[] = [
  { keywords: ['vmware', 'vmnet'], type: 'vmware', virtual: true, priority: 30 },
  { keywords: ['vbox', 'virtualbox'], type: 'virtualbox', virtual: true, priority: 30 },
  { keywords: ['docker', 'wsl'], type: 'container', virtual: true, priority: 40 },
  { keywords: ['bluetooth'], type: 'bluetooth', virtual: true, priority: 60 },
  { keywords: ['ethernet', '以太网'], type: 'ethernet', virtual: false, priority: 10 },
  { keywords: ['wlan', 'wi-fi', '无线'], type: 'wifi', virtual: false, priority: 10 },
  { keywords: ['loopback'], type: 'loopback', virtual: true, priority: 100 },
]

function detectIfaceType(iface: string): { type: string; virtual: boolean; priority: number } {
  const lower = iface.toLowerCase()
  for (const rule of IFACE_RULES) {
    if (rule.keywords.some((k) => lower.includes(k))) {
      return { type: rule.type, virtual: rule.virtual, priority: rule.priority }
    }
  }
  return { type: 'unknown', virtual: false, priority: 50 }
}

function isPrivateIP(ip: string): boolean {
  if (ip.startsWith('10.')) return true
  if (ip.startsWith('192.168.')) return true
  if (ip.startsWith('172.')) {
    const second = parseInt(ip.split('.')[1], 10)
    return second >= 16 && second <= 31
  }
  return false
}

export function getPrivateNetworks(): NetworkInfo[] {
  const interfaces = networkInterfaces()
  const results: NetworkInfo[] = []

  for (const iface of Object.keys(interfaces)) {
    const addrs = interfaces[iface]
    if (!addrs) continue

    const ips: string[] = []
    const { type, virtual, priority } = detectIfaceType(iface)

    for (const addr of addrs) {
      if (addr.family !== 'IPv4') continue
      const ip = addr.address
      if (ip.startsWith('127.')) continue
      if (ip.startsWith('169.254.')) continue
      if (isPrivateIP(ip)) {
        ips.push(ip)
      }
    }

    if (ips.length > 0) {
      results.push({ iface, ips, type, virtual, priority })
    }
  }

  results.sort((a, b) => a.priority - b.priority)

  if (results.length === 0) {
    results.push({
      iface: 'localhost',
      ips: ['127.0.0.1'],
      type: 'loopback',
      virtual: true,
      priority: 100,
    })
  }

  return results
}

export function isPortAvailable(port: number, host: string = '0.0.0.0'): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.listen(port, host, () => {
      server.close(() => resolve(true))
    })
  })
}