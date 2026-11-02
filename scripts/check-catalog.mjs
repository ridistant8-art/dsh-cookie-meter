const r = await fetch('https://awesome-dsh-plugin.com/plugins.json')
const j = JSON.parse(await r.text())
const list = Array.isArray(j) ? j : j.plugins || []
const x = list.find(p => JSON.stringify(p).includes('cookie-meter'))
console.log(JSON.stringify(x, null, 2).slice(0, 1600))

const p = await fetch('https://awesome-dsh-plugin.com/p/ridistant8-art/dsh-cookie-meter/')
const t = await p.text()
console.log('page HTTP ' + p.status + ' bytes=' + t.length)
const title = (t.match(/<title>([^<]+)<\/title>/) || [])[1]
console.log('title=' + title)
const m = t.match(/<meta name="description" content="([^"]+)"/)
console.log('meta=' + (m ? m[1] : '').slice(0, 220))
