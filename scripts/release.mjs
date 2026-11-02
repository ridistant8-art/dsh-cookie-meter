/*
 * 发布新版本：推文件 → 建 Release → 传 tarball → 更新市场条目（PR）。
 * 用法：设置环境变量 GH_TOKEN 后 `node scripts/release.mjs`
 * 版本号取自 package.json，tarball 取仓库根目录的 dsh-cookie-meter-<version>.tgz。
 * 幂等：文件按 sha 覆盖，Release 已存在则复用，asset 已存在则跳过。
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const API = 'https://api.github.com'
const UA = 'dsh-cookie-meter-release'

const token = (process.env.GH_TOKEN ?? '').trim()
if (token === '') {
  console.error('缺少 GH_TOKEN')
  process.exit(2)
}

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const version = pkg.version
const tag = 'v' + version
const tgzName = `dsh-cookie-meter-${version}.tgz`
const tgzPath = join(root, tgzName)
if (!existsSync(tgzPath)) {
  console.error('找不到 tarball：' + tgzPath + '（先跑 pnpm pack）')
  process.exit(2)
}

const OWNER = 'ridistant8-art'
const REPO = 'dsh-cookie-meter'
const UPSTREAM = 'awesome-dsh-plugin'
const ENTRY_PATH = `data/plugins/${OWNER}__${REPO}.yml`

async function api(method, path, body, opts = {}) {
  const headers = {
    authorization: 'Bearer ' + token,
    accept: opts.accept ?? 'application/vnd.github+json',
    'user-agent': UA,
    'x-github-api-version': '2022-11-28',
  }
  if (body !== undefined && !opts.raw) headers['content-type'] = 'application/json'
  const res = await fetch(opts.url ?? API + path, {
    method,
    headers,
    body: body === undefined ? undefined : opts.raw ? body : JSON.stringify(body),
  })
  const text = await res.text()
  let json
  try {
    json = text === '' ? undefined : JSON.parse(text)
  } catch {
    json = undefined
  }
  if (!res.ok) {
    const message = json?.message ?? text.slice(0, 200)
    if (opts.allow404 === true && res.status === 404) return undefined
    throw new Error(`${method} ${path} → ${res.status} ${message}`)
  }
  return json
}

const FILES = [
  'package.json',
  'index.js',
  'probe.js',
  'client.js',
  'cordis.patch.yml',
  'README.md',
  'LICENSE',
  '.gitignore',
  'catalog-entry.yml',
  'assets/icon-180.png',
  'assets/icon-512.png',
  'scripts/make-icon.py',
  'scripts/smoke.mjs',
  'scripts/smoke-client.mjs',
  'scripts/smoke-boot.mjs',
  'scripts/publish-github.mjs',
  'scripts/submit-catalog.mjs',
  'scripts/check-catalog.mjs',
  'scripts/watch-ci.mjs',
  'scripts/release.mjs',
]

let changed = 0
for (const rel of FILES) {
  const abs = join(root, rel)
  if (!existsSync(abs)) {
    console.log('skip（本地没有）', rel)
    continue
  }
  const current = await api('GET', `/repos/${OWNER}/${REPO}/contents/${rel}`, undefined, { allow404: true })
  const content = readFileSync(abs).toString('base64')
  if (current !== undefined && current.content !== undefined) {
    const remote = current.content.replace(/\n/g, '')
    if (remote === content) {
      console.log('不变', rel)
      continue
    }
  }
  await api('PUT', `/repos/${OWNER}/${REPO}/contents/${rel}`, {
    message: `chore: ${tag} — ${rel}`,
    content,
    ...(current !== undefined && current.sha !== undefined ? { sha: current.sha } : {}),
  })
  changed += 1
  console.log('已推', rel)
}
console.log(`\n文件同步完成，改动 ${changed} 个`)

let release = await api('GET', `/repos/${OWNER}/${REPO}/releases/tags/${tag}`, undefined, { allow404: true })
if (release === undefined) {
  release = await api('POST', `/repos/${OWNER}/${REPO}/releases`, {
    tag_name: tag,
    target_commitish: 'main',
    name: `${tag} — 浮窗复位与位置修正`,
    body: [
      '### ' + tag,
      '',
      '- **修复**：浮窗拖到窗口顶部后抓不住（落进 Electron 的 `-webkit-app-region:drag` 标题带）。',
      '- 纵向留 48px 安全区，读取旧坐标时自动夹回安全区（刷新即脱困）。',
      '- 新增：双击标题栏复位到右下角；浮窗自身 `-webkit-app-region:no-drag`。',
      '',
      '安装：`dsh plugin --profile desktop add ' + tag + ' 的 tgz`',
    ].join('\n'),
    draft: false,
    prerelease: false,
  })
  console.log('已建 Release', tag, 'id=' + release.id)
} else {
  console.log('Release 已存在', tag, 'id=' + release.id)
}

const assets = await api('GET', `/repos/${OWNER}/${REPO}/releases/${release.id}/assets`)
if (assets.some((a) => a.name === tgzName)) {
  console.log('asset 已存在，跳过上传', tgzName)
} else {
  const url = `https://uploads.github.com/repos/${OWNER}/${REPO}/releases/${release.id}/assets?name=${encodeURIComponent(tgzName)}`
  const uploaded = await api('POST', '', readFileSync(tgzPath), {
    url,
    raw: true,
    accept: 'application/vnd.github+json',
  })
  console.log('已上传 asset', uploaded.name, uploaded.size, uploaded.state)
}

// ---- 更新市场条目：改 tarball 指向新版本，提一个小 PR ----
const entryLocal = readFileSync(join(root, 'catalog-entry.yml'), 'utf8')
const upSha = await api('GET', `/repos/${UPSTREAM}/${UPSTREAM}/git/ref/heads/main`)
const baseSha = upSha.object.sha
const branch = 'tarball-' + tag
await api('POST', `/repos/${OWNER}/${UPSTREAM}/git/refs`, { ref: `refs/heads/${branch}`, sha: baseSha }, { allow404: true }).catch(
  (err) => {
    if (!String(err.message).includes('422')) throw err
    console.log('分支已存在，复用', branch)
  },
)
const remoteEntry = await api('GET', `/repos/${OWNER}/${UPSTREAM}/contents/${ENTRY_PATH}?ref=${branch}`)
if (remoteEntry.content.replace(/\n/g, '') === Buffer.from(entryLocal, 'utf8').toString('base64')) {
  console.log('市场条目已是最新，无需 PR')
} else {
  await api('PUT', `/repos/${OWNER}/${UPSTREAM}/contents/${ENTRY_PATH}`, {
    message: `chore(${REPO}): tarball → ${tag}`,
    content: Buffer.from(entryLocal, 'utf8').toString('base64'),
    sha: remoteEntry.sha,
    branch,
  })
  const open = await api('GET', `/repos/${UPSTREAM}/${UPSTREAM}/pulls?state=open&head=${OWNER}:${branch}`, undefined, {
    allow404: true,
  })
  if (Array.isArray(open) && open.length > 0) {
    console.log('PR 已存在 #' + open[0].number, open[0].html_url)
  } else {
    const pr = await api('POST', `/repos/${UPSTREAM}/${UPSTREAM}/pulls`, {
      title: `Update ${REPO} tarball to ${tag}`,
      head: `${OWNER}:${branch}`,
      base: 'main',
      body: [
        `把 \`${ENTRY_PATH}\` 的 \`tarball\` 指向 ${tag}。`,
        '',
        '新版修复：浮窗拖到窗口顶部后抓不住（Electron 的 `-webkit-app-region:drag` 标题带吞掉了按下事件）。',
        '现在纵向留 48px 安全区、读取旧坐标时自动夹回、双击标题栏复位。',
      ].join('\n'),
    })
    console.log('已开 PR #' + pr.number, pr.html_url)
  }
}

console.log('\n全部完成 ✅')
