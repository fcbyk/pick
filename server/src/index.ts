#!/usr/bin/env node
import { Command } from 'commander'
import { resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { createApp } from './app.js'
import { PickService } from './services/pick.service.js'
import { getPluginStateStore } from './lib/state-store.js'
import { getPrivateNetworks, isPortAvailable } from './lib/network.js'
import { generateRandomString } from './lib/utils.js'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

function copyToClipboard(text: string): boolean {
  try {
    if (process.platform === 'darwin') {
      execSync('pbcopy', { input: text })
    } else if (process.platform === 'win32') {
      execSync('clip', { input: text })
    } else {
      execSync('xclip -selection clipboard', { input: text })
    }
    return true
  } catch {
    return false
  }
}

async function openBrowser(url: string): Promise<void> {
  try {
    const { default: open } = await import('open')
    await open(url)
  } catch {
    console.log(' Note: Could not auto-open browser, please visit the URL above')
  }
}

function echoNetworkUrls(networks: ReturnType<typeof getPrivateNetworks>, port: number): void {
  for (const host of ['localhost', '127.0.0.1']) {
    console.log(` Local: http://${host}:${port}`)
  }
  for (const net of networks) {
    if (net.virtual) continue
    for (const ip of net.ips) {
      if (ip === '127.0.0.1') continue
      console.log(` [${net.iface}] Network URL: http://${ip}:${port}`)
    }
  }
}

async function waitForServerReady(port: number, host: string = '127.0.0.1', timeout: number = 10): Promise<boolean> {
  const url = `http://${host}:${port}/`
  const deadline = Date.now() + timeout * 1000
  while (Date.now() < deadline) {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 500)
      const resp = await fetch(url, { signal: controller.signal })
      clearTimeout(timeoutId)
      if (resp.status === 200) return true
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 50))
  }
  return false
}

async function promptPassword(): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  })
  return new Promise((resolve) => {
    rl.question('Admin password (press Enter to use default: 123456): ', (answer) => {
      rl.close()
      resolve(answer.trim() || '123456')
    })
  })
}

const program = new Command()

program
  .name('pick')
  .description('Start web picker server')
  .option('-p, --port <number>', 'Port for web server', '80')
  .option('--no-browser', 'Do not auto-open browser')
  .option('-f, --files <path>', 'Start web file picker with given file/directory')
  .option('-pw, --password', 'Prompt to set admin password')
  .action(async (options) => {
    const port = parseInt(options.port, 10)

    const available = await isPortAvailable(port)
    if (!available) {
      console.error(` Error: Port ${port} is already in use (or you don't have permission).`)
      console.error(` Please choose another port (e.g. --port ${port + 1}).`)
      process.exit(1)
    }

    let adminPassword = '123456'
    if (options.password) {
      adminPassword = await promptPassword()
    }

    const stateStore = getPluginStateStore('byk-pick')
    const service = new PickService(stateStore)
    service.redeemCodes = service.loadRedeemCodesFromStorage()

    const filesRoot = options.files ? resolve(options.files) : null

    if (filesRoot && service.redeemCodes.size === 0) {
      try {
        const newCodes = service.generateAndAddRedeemCodesToStorage(5)
        if (newCodes.length > 0) {
          console.log(` Auto-generated ${newCodes.length} redeem codes: ${newCodes.join(', ')}`)
        }
      } catch {
        /* ignore */
      }
    }

    const staticDir = resolve(__dirname, 'public')
    const staticDirFinal = existsSync(staticDir) ? staticDir : resolve(__dirname, '../dist/public')
    const app = createApp(
      {
        filesRoot,
        adminPassword,
        staticDir: staticDirFinal,
      },
      service,
    )

    const networks = getPrivateNetworks()
    const localIp = networks.length > 0 ? networks[0].ips[0] : '127.0.0.1'
    const urlNetwork = `http://${localIp}:${port}`

    console.log()
    echoNetworkUrls(networks, port)
    console.log(` Admin URL: ${urlNetwork}/admin`)
    if (filesRoot) {
      console.log(` Files root: ${filesRoot}`)
    }

    const copied = copyToClipboard(urlNetwork)
    if (copied) {
      console.log(' URL has been copied to clipboard')
    }
    console.log()

    const server = app.listen(port, '0.0.0.0', async () => {
      if (!options.browser) return

      if (await waitForServerReady(port)) {
        try {
          await openBrowser(urlNetwork)
          console.log(' Attempted to open picker page in browser')
        } catch {
          console.log(' Note: Could not auto-open browser, please visit the URL above')
        }
      } else {
        console.log(' Note: Server didn\'t respond in time, please open the URL above manually')
      }
    })

    process.on('SIGINT', () => {
      server.close()
      process.exit(0)
    })
    process.on('SIGTERM', () => {
      server.close()
      process.exit(0)
    })
  })

program.parse()