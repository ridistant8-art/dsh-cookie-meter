import { pathToFileURL } from 'node:url'

const entry = new URL('../index.js', import.meta.url).href
const mod = await import(entry)
console.log('name =', mod.name, '| apply =', typeof mod.apply)

const routes = []
const effectLabels = []
const ctx = {
  get() {
    return undefined
  },
  effect(cb, label) {
    effectLabels.push(label)
    const dispose = cb()
    return () => {
      if (typeof dispose === 'function') dispose()
    }
  },
  inject(deps, fn) {
    console.log('inject deps =', JSON.stringify(deps))
    fn({
      effect(cb, label) {
        effectLabels.push(label)
        cb()
      },
      webServer: {
        register(config) {
          routes.push(config)
          return () => undefined
        },
      },
    })
  },
}

mod.apply(ctx)
console.log('routes =', routes.map((r) => `${r.kind} ${r.path}`).join(', '))
console.log('effect labels =', JSON.stringify(effectLabels))

function fakeResponse() {
  return {
    status: 0,
    headers: {},
    body: '',
    writeHead(status, headers) {
      this.status = status
      this.headers = headers ?? {}
    },
    end(text) {
      this.body = text ?? ''
    },
  }
}

async function call(method, url, headers) {
  const res = fakeResponse()
  await routes[0].handler({ method, url, headers: headers ?? { host: '127.0.0.1:11916' } }, res)
  return res
}

const get = await call('GET', '/dsh-cookie-meter/api?force=1')
console.log('\nGET status', get.status, '| ct', get.headers['content-type'])
console.log('body', get.body)

const blocked = await call('GET', '/dsh-cookie-meter/api?force=1', {
  host: '127.0.0.1:11916',
  'sec-fetch-site': 'cross-site',
})
console.log('\ncross-site status', blocked.status, 'body', blocked.body)

const badHost = await call('GET', '/dsh-cookie-meter/api', { host: 'evil.example.com' })
console.log('bad host status', badHost.status, 'body', badHost.body)

const unknown = await call('POST', '/dsh-cookie-meter/api?action=nope')
console.log('\nunknown action status', unknown.status, 'body', unknown.body)

const put = await call('PUT', '/dsh-cookie-meter/api')
console.log('PUT status', put.status)

const second = await call('GET', '/dsh-cookie-meter/api')
console.log('\ncached body', second.body)
