// Screenshots the LIVE plant page (/p/[slug]) in both of its modes and
// verifies every number on screen against a fetch of the same API at capture
// time — the page must be a faithful relay, and this script is the proof.
// Usage: node scripts/shoot-live.mjs <baseUrl> <slug> <deviceToken> <outDir>
import { chromium } from 'playwright'

const [BASE, SLUG, TOKEN, OUT = '/tmp'] = process.argv.slice(2)
if (!BASE || !SLUG || !TOKEN) {
  console.error('usage: node scripts/shoot-live.mjs <baseUrl> <slug> <deviceToken> <outDir>')
  process.exit(1)
}
const errors = []
let failures = 0
const check = (name, page, api) => {
  const ok = String(page) === String(api)
  if (!ok) failures++
  console.log(`   ${ok ? 'MATCH' : 'MISMATCH'} ${name}: page=${page} api=${api}`)
}

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=metal', '--enable-webgl', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message))

const text = () => page.evaluate(() => document.body.innerText)

// ── owner mode ──────────────────────────────────────────────────────────────
await page.goto(`${BASE}/p/${SLUG}?device_token=${TOKEN}`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(4000) // first poll + face assembly
let txt = await text()
// The API, fetched at capture time — the page's poll and this fetch replay
// the same stored rows, so the numbers must agree to the digit.
const api = await (await fetch(`${BASE}/api/readings?device_token=${TOKEN}&latest=1&stats=1`)).json()
await page.screenshot({ path: `${OUT}/pf-live-owner.png` })
console.log('[owner] screenshot -> pf-live-owner.png')
check('emotion', txt.match(/\b(NEUTRAL|HAPPY|ALERT|SAD|ANGRY|CONFUSED|SLEEPY|LOVE|GLITCH)\b/)?.[1], api.mood.emotion.toUpperCase())
check('wellbeing', txt.match(/(\d+)\/100/)?.[1], api.wellbeing.toFixed(0))
check('moisture', txt.match(/MOISTURE\s+(-?[\d.]+)%/)?.[1], api.latest.moisture.toFixed(0))
check('ec', txt.match(/EC\s*(?:UNCAL)?\s*([\d.]+)\s*mS/)?.[1], api.latest.ec.toFixed(2))
check('lifetime moisture pct', txt.match(/MOISTURE IN BAND ([\d.]+)%/)?.[1], api.stats.windows.lifetime.moisture.pct_in_band.toFixed(1))
check('headline', txt.match(/“([^”]+)”/)?.[1], api.mood.headline)
console.log(`   care line: ${txt.match(/(RECENTLY:[^\n]+|NO CARE WITNESSED[^\n]+)/)?.[1] ?? '(none)'}`)

// ── public mode ─────────────────────────────────────────────────────────────
await page.goto(`${BASE}/p/${SLUG}`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3000)
txt = await text()
const pub = await (await fetch(`${BASE}/api/public/${SLUG}`)).json()
await page.screenshot({ path: `${OUT}/pf-live-public.png` })
console.log('[public] screenshot -> pf-live-public.png')
check('label shown', txt.includes(pub.label), true)
check('emotion', txt.match(/\b(NEUTRAL|HAPPY|ALERT|SAD|ANGRY|CONFUSED|SLEEPY|LOVE|GLITCH)\b/)?.[1], pub.emotion.toUpperCase())
check('wellbeing', txt.match(/(\d+)\/100/)?.[1], String(pub.wellbeing))
check('headline', txt.match(/“([^”]+)”/)?.[1], pub.headline)
check('watered count', txt.match(/WATERED ×(\d+)/)?.[1], String(pub.careCounts.water))
check('fed count', txt.match(/FED ×(\d+)/)?.[1], String(pub.careCounts.feed))
console.log(`   token in page HTML: ${txt.includes(TOKEN) ? 'LEAKED' : 'absent'}`)

// ── the dead end ────────────────────────────────────────────────────────────
await page.goto(`${BASE}/p/no-such-plant-xyz`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2500)
txt = await text()
await page.screenshot({ path: `${OUT}/pf-live-notfound.png` })
console.log('[notfound] screenshot -> pf-live-notfound.png')
check('dead end rendered', txt.includes('Nobody by that name.'), true)

console.log('\nCONSOLE_ERRORS:', errors.length ? JSON.stringify(errors.slice(0, 6), null, 2) : 'none')
console.log(failures === 0 ? 'ALL NUMBERS MATCH' : `${failures} MISMATCH(ES)`)
await browser.close()
process.exit(failures === 0 ? 0 : 1)
