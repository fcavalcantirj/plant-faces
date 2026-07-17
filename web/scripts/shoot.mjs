// Drives the running demo through real scenarios and screenshots each one.
// Usage: node scripts/shoot.mjs <outDir>
import { chromium } from 'playwright'

const OUT = process.argv[2] || '/tmp'
const errors = []

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=metal', '--enable-webgl', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message))

await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2500)

const state = async () => {
  const txt = await page.evaluate(() => document.body.innerText)
  return {
    emotion: txt.match(/\b(NEUTRAL|THINKING|SPEAKING|HAPPY|ALERT|SAD|ANGRY|SURPRISED|CONFUSED|SLEEPY|LOVE|GLITCH)\b/)?.[1],
    quote: txt.match(/“([^”]+)”/)?.[1],
    well: txt.match(/(\d+)\/100/)?.[1],
    moisture: txt.match(/MOISTURE\s+(-?[\d.]+)%/)?.[1],
    ec: txt.match(/EC\s*(?:UNCAL)?\s*([\d.]+)\s*mS/)?.[1],
    record: txt.match(/CARE RECORD — ([^\n]+)/)?.[1],
  }
}

const shot = async (name, note) => {
  const s = await state()
  await page.screenshot({ path: `${OUT}/pf-${name}.png` })
  console.log(`[${name}] ${note}`)
  console.log(`   ${s.emotion} | well ${s.well} | moist ${s.moisture}% | EC ${s.ec} | ${s.record} | "${s.quote}"`)
  return s
}

const click = async (text, wait = 1000) => {
  await page.getByRole('button', { name: text }).first().click()
  await page.waitForTimeout(wait)
}

await click('PAUSE')
await click('POUR WATER IN')
await shot('watered', 'freshly watered, clock paused')

await click('FEED IT')
await shot('fed', 'fed once — EC rises, event marker appears')

await click('FLOOD IT')
await shot('drenched', 'overwatered on purpose')

await click('POUR WATER IN')
for (let i = 0; i < 8; i++) await click('12H PASS', 450)
await shot('neglected', 'four days no water — EC concentrates as it dries')

await click('POUR WATER IN')
await shot('rescued', 'watered right after')

// The time-lapse: 14 days of readings posted through /api/ingest.
await click('GOOD CARE', 10000)
await shot('fortnight-care', '14 days of good care (time-lapse)')

await click('NEGLECT', 10000)
await shot('fortnight-neglect', '14 days of neglect (time-lapse)')

console.log('\nCONSOLE_ERRORS:', errors.length ? JSON.stringify(errors.slice(0, 6), null, 2) : 'none')
await browser.close()
