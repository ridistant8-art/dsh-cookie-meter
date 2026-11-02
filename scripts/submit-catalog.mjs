// 投稿到 awesome-dsh-plugin：推图标 + 投稿 yml、建 Release v0.1.0 挂 tgz、提 PR。
// 用法（PowerShell）：
//   $env:GH_TOKEN='github_pat_xxx'; node scripts\submit-catalog.mjs
// 或把 token 放进仓库根目录的 .gh-token.txt（已在 .gitignore 里）。
// 幂等：文件已存在则带 sha 覆盖；release 已存在则复用；PR 已存在则只更新。
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const OWNER = 'ridistant8-art'
const REPO = 'dsh-cookie-meter'
const UPSTREAM_OWNER = 'awesome-dsh-plugin'
const UPSTREAM_REPO = 'awesome-dsh-plugin'
const ENTRY_PATH = `data/plugins/${OWNER}__${REPO}.yml`
const TAG = 'v0.1.0'
const ASSET = `${REPO}-0.1.0.tgz`
const BRANCH = 'add-dsh-cookie-meter'

const token = (process.env.GH_TOKEN || process.env.GITHUB_TOKEN || readTokenFile() || '').trim()
if (token === '') {
  console.error('缺少 token：请设置 $env:GH_TOKEN 或写入 .gh-token.txt')
  process.exit(2)
}

function readTokenFile() {
  const file = join(root, '.gh-token.txt')
  if (!existsSync(file)) return ''
  return readFileSync(file, 'utf8')
}

const API = 'https://api.github.com'

function headers(extra) {
  return {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${token}`,
    'user-agent': 'dsh-cookie-meter-submit',
    'x-github-api-version': '2022-11-28',
    ...extra,
  }
}

async function api(method, path, body, extraHeaders) {
  const res = await fetch(path.startsWith('http') ? path : API + path, {
    method,
    headers: headers(extraHeaders),
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let data = null
  try {
    data = text === '' ? null : JSON.parse(text)
  } catch {
    data = text
  }
  return { status: res.status, ok: res.ok, data }
}

function die(what, result) {
  const detail = result !== null && result.data !== null && typeof result.data === 'object'
    ? result.data.message || JSON.stringify(result.data)
    : String(result === null ? '' : result.data)
  console.error(`✗ ${what} (HTTP ${result === null ? '?' : result.status}): ${detail}`)
  process.exit(1)
}

async function putFile(path, localFile, message) {
  const content = readFileSync(localFile, 'utf8')
  const base64 = Buffer.from(content, 'utf8').toString('base64')
  const existing = await api('GET', `/repos/${OWNER}/${REPO}/contents/${path}`)
  const sha = existing.ok && existing.data !== null && existing.data.sha !== undefined ? existing.data.sha : undefined
  const body = { message, content: base64, branch: 'main' }
  if (sha !== undefined) body.sha = sha
  const res = await api('PUT', `/repos/${OWNER}/${REPO}/contents/${path}`, body)
  if (!res.ok) die(`push ${path}`, res)
  console.log(`✓ ${path} ${sha === undefined ? 'created' : 'updated'}`)
  return res
}

async function putBinary(path, localFile, mime, message) {
  const buf = readFileSync(localFile)
  const base64 = buf.toString('base64')
  const existing = await api('GET', `/repos/${OWNER}/${REPO}/contents/${path}`)
  const sha = existing.ok && existing.data !== null && existing.data.sha !== undefined ? existing.data.sha : undefined
  const body = { message, content: base64, branch: 'main' }
  if (sha !== undefined) body.sha = sha
  const res = await api('PUT', `/repos/${OWNER}/${REPO}/contents/${path}`, body)
  if (!res.ok) die(`push ${path}`, res)
  console.log(`✓ ${path} ${sha === undefined ? 'created' : 'updated'} (${buf.length} B, ${mime})`)
  return res
}

async function ensureRelease() {
  const list = await api('GET', `/repos/${OWNER}/${REPO}/releases/tags/${TAG}`)
  if (list.ok && list.data !== null && list.data.id !== undefined) {
    console.log(`✓ release ${TAG} 已存在 (id ${list.data.id})`)
    return list.data.id
  }
  const created = await api('POST', `/repos/${OWNER}/${REPO}/releases`, {
    tag_name: TAG,
    target_commitish: 'main',
    name: `${REPO} ${TAG}`,
    body: [
      '首个发行版：DSH 桌面版 cookie 占用百分表。',
      '',
      '- 浮窗显示 `dsh-auth` cookie 占请求头的百分比（16384 B 预算，每条约 228 B）',
      '- 超过 50% 数字变红；超过阈值提示清理',
      '- 「一键清理」：库被占用时自动改为「下次启动时清零」',
      '- 附件 `' + ASSET + '` 可直接 `dsh plugin --profile desktop add file:<tgz>` 安装，无需 git',
    ].join('\n'),
    draft: false,
    prerelease: false,
  })
  if (!created.ok) die(`create release ${TAG}`, created)
  console.log(`✓ release ${TAG} created (id ${created.data.id})`)
  return created.data.id
}

async function uploadAsset(releaseId) {
  const assets = await api('GET', `/repos/${OWNER}/${REPO}/releases/${releaseId}/assets`)
  if (assets.ok && Array.isArray(assets.data) && assets.data.some(a => a.name === ASSET)) {
    console.log(`✓ asset ${ASSET} 已存在`)
    return
  }
  const buf = readFileSync(join(root, ASSET))
  const url = `https://uploads.github.com/repos/${OWNER}/${REPO}/releases/${releaseId}/assets?name=${encodeURIComponent(ASSET)}`
  const res = await fetch(url, {
    method: 'POST',
    headers: headers({ 'content-type': 'application/gzip', 'content-length': String(buf.length) }),
    body: buf,
  })
  const text = await res.text()
  if (!res.ok) {
    console.error(`✗ upload asset (HTTP ${res.status}): ${text.slice(0, 300)}`)
    process.exit(1)
  }
  console.log(`✓ asset ${ASSET} uploaded (${buf.length} B)`)
}

async function ensureFork() {
  const get = await api('GET', `/repos/${OWNER}/${UPSTREAM_REPO}`)
  if (get.ok) {
    console.log(`✓ fork ${OWNER}/${UPSTREAM_REPO} 已存在`)
    return
  }
  const res = await api('POST', `/repos/${UPSTREAM_OWNER}/${UPSTREAM_REPO}/forks`, { default_branch_only: true })
  if (!res.ok) die('fork upstream', res)
  for (let i = 0; i < 30; i += 1) {
    await new Promise(r => setTimeout(r, 3000))
    const probe = await api('GET', `/repos/${OWNER}/${UPSTREAM_REPO}/contents/data/plugins`)
    if (probe.ok) {
      console.log(`✓ fork ready`)
      return
    }
  }
  die('fork 未就绪（等了 90s）', { status: 408, data: {} })
}

async function ensureBranch() {
  const base = await api('GET', `/repos/${OWNER}/${UPSTREAM_REPO}/git/ref/heads/main`)
  if (!base.ok) die('读取 fork main', base)
  const sha = base.data.object.sha
  const existing = await api('GET', `/repos/${OWNER}/${UPSTREAM_REPO}/git/ref/heads/${BRANCH}`)
  if (existing.ok) {
    console.log(`✓ branch ${BRANCH} 已存在`)
    return
  }
  const res = await api('POST', `/repos/${OWNER}/${UPSTREAM_REPO}/git/refs`, { ref: `refs/heads/${BRANCH}`, sha })
  if (!res.ok) die(`create branch ${BRANCH}`, res)
  console.log(`✓ branch ${BRANCH} created`)
}

async function putEntryOnFork() {
  const content = readFileSync(join(root, 'catalog-entry.yml'), 'utf8')
  const existing = await api('GET', `/repos/${OWNER}/${UPSTREAM_REPO}/contents/${ENTRY_PATH}?ref=${BRANCH}`)
  const body = {
    message: `Add ${REPO} to the plugin catalog`,
    content: Buffer.from(content, 'utf8').toString('base64'),
    branch: BRANCH,
  }
  if (existing.ok && existing.data !== null && existing.data.sha !== undefined) body.sha = existing.data.sha
  const res = await api('PUT', `/repos/${OWNER}/${UPSTREAM_REPO}/contents/${ENTRY_PATH}`, body)
  if (!res.ok) die(`push ${ENTRY_PATH}`, res)
  console.log(`✓ ${ENTRY_PATH} on ${BRANCH}`)
}

async function ensurePull() {
  const head = `${OWNER}:${BRANCH}`
  const list = await api('GET', `/repos/${UPSTREAM_OWNER}/${UPSTREAM_REPO}/pulls?state=open&head=${encodeURIComponent(head)}`)
  if (list.ok && Array.isArray(list.data) && list.data.length > 0) {
    console.log(`✓ PR 已存在 #${list.data[0].number} ${list.data[0].html_url}`)
    return list.data[0].html_url
  }
  const res = await api('POST', `/repos/${UPSTREAM_OWNER}/${UPSTREAM_REPO}/pulls`, {
    title: `Add dsh-cookie-meter (cookie header usage meter)`,
    head,
    base: 'main',
    body: [
      'Adds `' + ENTRY_PATH + '`.',
      '',
      '**What it does** — a floating meter in the DSH desktop UI. It counts the `dsh-auth-*` cookies in the app\'s cookie jar and estimates how much of Node\'s 16384-byte request-header budget they occupy (the desktop app adds a new cookie of ~228 bytes on every launch under a random port). Past 50% the number turns red; one click either clears the jar right away or, when Chromium holds the file open, schedules the clear for the next launch.',
      '',
      '**Why** — without cleanup the header grows until the desktop welcome page fails with 431 / "Web authentication failed" after roughly 72 launches.',
      '',
      '- `package.json` declares `dsh.bundle` (host route) and `dsh.client` (overlay UI)',
      '- Release `v0.1.0` carries a tarball, so the `tarball:` field lets the market install it without git',
      '- No new dependencies; uses the koffi copy that ships with DSH to read the locked cookie DB',
      '- MIT, Windows-only (`os: win32`), verified against DSH 0.2.1-rc.3',
    ].join('\n'),
  })
  if (!res.ok) die('create PR', res)
  console.log(`✓ PR #${res.data.number} ${res.data.html_url}`)
  return res.data.html_url
}

const tgz = join(root, ASSET)
if (!existsSync(tgz)) {
  console.error(`缺少 ${ASSET}，先跑 pnpm pack 或 npm pack`)
  process.exit(2)
}

const me = await api('GET', '/user')
if (!me.ok) die('校验 token', me)
console.log(`✓ token 有效：${me.data.login}`)

await putBinary('assets/icon-180.png', join(root, 'assets', 'icon-180.png'), 'image/png', 'Add market card icon (180px)')
await putBinary('assets/icon-512.png', join(root, 'assets', 'icon-512.png'), 'image/png', 'Add market card icon (512px)')
await putFile('catalog-entry.yml', join(root, 'catalog-entry.yml'), 'Add plugin-market catalog entry')

const releaseId = await ensureRelease()
await uploadAsset(releaseId)

await ensureFork()
await ensureBranch()
await putEntryOnFork()
const prUrl = await ensurePull()

console.log('')
console.log('全部完成：')
console.log('  release  https://github.com/' + OWNER + '/' + REPO + '/releases/tag/' + TAG)
console.log('  pull     ' + prUrl)
