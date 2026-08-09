// Screenshots the bare face in all 12 emotions via the dev-only /dev/faces page.
// Spawns a production server (`next start`) on a free port, shoots, kills it.
// Usage: node scripts/shoot-emotions.mjs <outDir> [port]
// Requires a prior `pnpm build`.
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

const OUT = process.argv[2] || '/tmp'
const PORT = Number(process.argv[3] || 4188)
const BASE = `http://localhost:${PORT}`

const EMOTIONS = [
  'neutral', 'thinking', 'speaking', 'happy', 'alert', 'sad',
  'angry', 'surprised', 'confused', 'sleepy', 'love', 'glitch',
]

const server = spawn('node_modules/.bin/next', ['start', '-p', String(PORT)], {
  cwd: new URL('..', import.meta.url).pathname,
  stdio: ['ignore', 'pipe', 'pipe'],
})
server.stderr.on('data', (d) => process.stderr.write(d))

const waitForServer = async () => {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${BASE}/dev/faces`)
      if (res.ok) return
    } catch {}
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`server never came up on :${PORT}`)
}

const errors = []
try {
  await waitForServer()

  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=metal', '--enable-webgl', '--ignore-gpu-blocklist'],
  })
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } })
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message))

  for (const emotion of EMOTIONS) {
    await page.goto(`${BASE}/dev/faces?emotion=${emotion}`, { waitUntil: 'domcontentloaded' })
    // let the particle cloud assemble and the morph settle
    await page.waitForTimeout(3500)
    const path = `${OUT}/face-${emotion}.png`
    await page.screenshot({ path })
    console.log(`shot ${emotion} -> ${path}`)
  }

  await browser.close()
  console.log('CONSOLE_ERRORS:', errors.length ? JSON.stringify(errors.slice(0, 6), null, 2) : 'none')
} finally {
  server.kill('SIGTERM')
  await new Promise((r) => setTimeout(r, 500))
  if (!server.killed) server.kill('SIGKILL')
}
process.exit(errors.length ? 1 : 0)
