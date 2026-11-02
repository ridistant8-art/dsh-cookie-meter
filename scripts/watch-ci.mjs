// 轮询 PR #10747 的 CI，直到完成或超时；打印结论与失败步骤。
// 无 token 也能查 job / pull（公开仓库）；有 token 就带上，免得踩限额。
const token = (process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '').trim()
const h = { accept: 'application/vnd.github+json', 'user-agent': 'ci-watch' }
if (token !== '') h.authorization = `Bearer ${token}`
const JOB = 'https://api.github.com/repos/awesome-dsh-plugin/awesome-dsh-plugin/actions/jobs/124370559803'
const PR = 'https://api.github.com/repos/awesome-dsh-plugin/awesome-dsh-plugin/pulls/10747'

async function get(url) {
  const res = await fetch(url, { headers: h })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
  return res.json()
}

const deadline = Date.now() + 25 * 60 * 1000
while (Date.now() < deadline) {
  const job = await get(JOB)
  const done = job.status === 'completed'
  const current = (job.steps || []).filter(s => s.status === 'in_progress').map(s => s.name)
  console.log(`${new Date().toISOString()} status=${job.status} conclusion=${job.conclusion || '-'} running=${current.join(',') || '-'}`)
  if (done) {
    const failed = (job.steps || []).filter(s => s.conclusion && s.conclusion !== 'success' && s.conclusion !== 'skipped')
    for (const s of failed) console.log(`  FAILED [${s.number}] ${s.name} -> ${s.conclusion}`)
    const pr = await get(PR)
    console.log(`PR state=${pr.state} mergeable=${pr.mergeable} mergeable_state=${pr.mergeable_state}`)
    console.log(`RESULT conclusion=${job.conclusion}`)
    process.exit(0)
  }
  await new Promise(r => setTimeout(r, 60000))
}
console.log('RESULT timeout')
