window.__ModuleLoader__.load({
  id: 'dsh-cookie-meter',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const API = '/dsh-cookie-meter/api'
    const POLL_MS = 30000
    const POS_KEY = 'dsh.cookie-meter.pos'
    // 桌面端窗口顶部有一条 -webkit-app-region:drag 的标题带，落进去就再也抓不住，
    // 所以纵向留出 SAFE_TOP 的安全区，横向留 SAFE_GAP。
    const SAFE_TOP = 48
    const SAFE_GAP = 8

    const CSS = `
.dcm-root{position:fixed;right:16px;bottom:16px;z-index:2147482000;pointer-events:auto;
  -webkit-app-region:no-drag;
  font-family:inherit;font-size:12px;line-height:1.4;color:#E8EEFF}
.dcm-card{width:250px;background:#0B1B3A;border:1px solid rgba(120,150,220,.22);border-radius:14px;
  box-shadow:0 18px 48px rgba(0,0,0,.45),0 2px 8px rgba(0,0,0,.35);overflow:hidden}
.dcm-card.dcm-armed{border-color:rgba(51,214,159,.45)}
.dcm-head{display:flex;align-items:center;gap:7px;padding:8px 10px;background:#142240;
  border-bottom:1px solid rgba(120,150,220,.14);cursor:grab;user-select:none}
.dcm-head:active{cursor:grabbing}
.dcm-mark{width:16px;height:16px;flex:none;border-radius:5px;background:#4D6BFE;color:#fff;
  display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700}
.dcm-title{flex:1;font-weight:600;font-size:12px;letter-spacing:.2px}
.dcm-refresh{flex:none;width:22px;height:22px;border-radius:6px;border:1px solid rgba(120,150,220,.3);
  background:rgba(120,150,220,.1);color:#C9D8F5;font-size:12px;line-height:1;cursor:pointer;padding:0}
.dcm-refresh:hover{background:rgba(120,150,220,.26);color:#fff}
.dcm-body{padding:11px 11px 10px}
.dcm-row{display:flex;align-items:center;gap:10px}
.dcm-pct{flex:1;min-width:0;font-size:30px;font-weight:750;letter-spacing:.4px;line-height:1.1;
  font-variant-numeric:tabular-nums;transition:color .25s ease}
.dcm-pct small{font-size:14px;font-weight:600;opacity:.75;margin-left:1px}
.dcm-btn{flex:none;border:0;border-radius:9px;padding:8px 10px;font-size:11.5px;font-weight:600;
  line-height:1.15;cursor:pointer;background:#4D6BFE;color:#fff;white-space:nowrap;
  transition:background .15s ease,transform .05s ease}
.dcm-btn:hover{background:#6E87FF}
.dcm-btn:active{transform:translateY(1px)}
.dcm-btn[disabled]{background:#2A3D68;color:#9DB2D8;cursor:default;transform:none}
.dcm-btn.dcm-armed{background:#1F5C46;color:#8AF0C4}
.dcm-btn.dcm-armed:hover{background:#276E54}
.dcm-meta{margin-top:8px;font-size:10.5px;color:#8FA3C8;font-variant-numeric:tabular-nums}
.dcm-status{display:flex;align-items:center;gap:6px;margin-top:6px;font-size:11px;color:#B9C9E6}
.dcm-dot{width:7px;height:7px;border-radius:50%;flex:none;display:inline-block}
.dcm-host{display:flex;align-items:center;gap:6px;margin-top:8px;font-size:10.5px;color:#6E82A8}
`
    const WARN = '#FF4D5E'
    const OK = '#33D69F'
    const AMBER = '#FFB020'
    const MUTED = '#8FA3C8'

    /** 把坐标收进"抓得到"的区域：上方避开标题带，四周留一点边。 */
    function clampPoint(x, y, w, h) {
      const maxX = Math.max(SAFE_GAP, window.innerWidth - w - SAFE_GAP)
      const maxY = Math.max(SAFE_TOP, window.innerHeight - h - SAFE_GAP)
      return {
        x: Math.min(Math.max(SAFE_GAP, Math.round(x)), maxX),
        y: Math.min(Math.max(SAFE_TOP, Math.round(y)), maxY),
      }
    }

    function readPos() {
      try {
        const raw = window.localStorage.getItem(POS_KEY)
        if (raw === null) return null
        const value = JSON.parse(raw)
        if (value !== null && typeof value === 'object' && typeof value.x === 'number' && typeof value.y === 'number') {
          // 旧版本可能把卡片存到标题带里，读出来先夹一次，刷新即自动脱困。
          return clampPoint(value.x, value.y, 0, 0)
        }
      } catch (err) {
        /* 隐私模式 / 脏数据：回默认位置 */
      }
      return null
    }

    function savePos(value) {
      try {
        if (value === null) {
          window.localStorage.removeItem(POS_KEY)
          return
        }
        window.localStorage.setItem(POS_KEY, JSON.stringify(value))
      } catch (err) {
        /* 不可写就只当次生效 */
      }
    }

    function fmtK(bytes) {
      if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KiB'
      return String(bytes) + ' B'
    }

    function CookieMeter() {
      const [data, setData] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [phase, setPhase] = React.useState('idle') // idle | cleaned | scheduled | error
      const [note, setNote] = React.useState('')
      const [pos, setPos] = React.useState(readPos)
      const rootRef = React.useRef(null)
      const dragRef = React.useRef(null)
      const posRef = React.useRef(pos)

      function beginDrag(event) {
        if (event.button !== 0 && event.pointerType === 'mouse') return
        const node = rootRef.current
        if (node === null) return
        const rect = node.getBoundingClientRect()
        dragRef.current = { dx: event.clientX - rect.left, dy: event.clientY - rect.top, w: rect.width, h: rect.height }
        const start = clampPoint(rect.left, rect.top, rect.width, rect.height)
        posRef.current = start
        setPos(start)
      }

      function resetPos() {
        dragRef.current = null
        posRef.current = null
        setPos(null)
        savePos(null)
        setNote('位置已复位')
      }

      function clampIntoView() {
        const node = rootRef.current
        if (posRef.current === null || node === null) return
        const rect = node.getBoundingClientRect()
        const next = clampPoint(posRef.current.x, posRef.current.y, rect.width, rect.height)
        if (next.x === posRef.current.x && next.y === posRef.current.y) return
        posRef.current = next
        setPos(next)
        savePos(next)
      }

      React.useEffect(function () {
        clampIntoView()
      }, [])

      React.useEffect(function () {
        function move(event) {
          const drag = dragRef.current
          if (drag === null) return
          const next = clampPoint(event.clientX - drag.dx, event.clientY - drag.dy, drag.w, drag.h)
          posRef.current = next
          setPos(next)
        }
        function stop() {
          if (dragRef.current === null) return
          dragRef.current = null
          if (posRef.current !== null) savePos(posRef.current)
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', stop)
        window.addEventListener('pointercancel', stop)
        window.addEventListener('resize', clampIntoView)
        return function () {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', stop)
          window.removeEventListener('pointercancel', stop)
          window.removeEventListener('resize', clampIntoView)
        }
      }, [])

      const load = React.useCallback(function (force) {
        fetch(API + (force === true ? '?force=1' : ''), { credentials: 'include' })
          .then(function (res) {
            if (!res.ok) throw new Error('HTTP ' + res.status)
            return res.json()
          })
          .then(function (body) {
            setData(body)
            setPhase(function (current) {
              if (current === 'cleaned') return current
              return body.scheduled === true ? 'scheduled' : 'idle'
            })
          })
          .catch(function (err) {
            setNote(err !== null && err !== undefined && err.message !== undefined ? err.message : String(err))
            setPhase('error')
          })
      }, [])

      React.useEffect(function () {
        load(false)
        const timer = window.setInterval(function () {
          load(false)
        }, POLL_MS)
        return function () {
          window.clearInterval(timer)
        }
      }, [load])

      function post(action) {
        return fetch(API + '?action=' + action, { method: 'POST', credentials: 'include' }).then(function (res) {
          return res.json()
        })
      }

      function onClean() {
        if (busy) return
        setBusy(true)

        if (phase === 'scheduled') {
          post('cancel-clean')
            .then(function () {
              setPhase('idle')
              setNote('已取消安排，cookie 会照常累积')
              return load(true)
            })
            .catch(function (err) {
              setPhase('error')
              setNote(String(err))
            })
            .finally(function () {
              setBusy(false)
            })
          return
        }

        post('clean')
          .then(function (body) {
            if (body.cleared === true) {
              setPhase('cleaned')
              setNote('已清空 cookie 库')
              return load(true)
            }
            if (body.locked === true) {
              return post('schedule-clean').then(function (armed) {
                if (armed.scheduled === true) {
                  setPhase('scheduled')
                  setNote('已安排：关掉 DSH 时清空，下次进入从 0 开始')
                } else {
                  setPhase('error')
                  setNote(armed.note !== undefined ? armed.note : '安排失败')
                }
              })
            }
            const first = Array.isArray(body.results) ? body.results[0] : undefined
            setPhase('error')
            setNote('删除失败' + (first !== undefined && first.error !== undefined ? '：' + first.error : ''))
            return undefined
          })
          .catch(function (err) {
            setPhase('error')
            setNote(String(err))
          })
          .finally(function () {
            setBusy(false)
          })
      }

      const ok = data !== null && data.ok === true
      const pct = ok ? data.pct : NaN
      const hot = ok && pct > 50
      const scheduled = phase === 'scheduled'
      const pctColor = !ok ? MUTED : hot ? WARN : '#E8EEFF'
      const dotColor = scheduled ? OK : !ok ? MUTED : hot ? WARN : pct > 25 ? AMBER : OK
      const rootStyle = pos === null ? undefined : { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' }

      let statusText
      if (scheduled) statusText = '已安排，下次进入时清零'
      else if (phase === 'cleaned') statusText = '已清理'
      else if (phase === 'error') statusText = '出错了'
      else if (!ok) statusText = data === null ? '检测中…' : '读不到 cookie 库'
      else statusText = hot ? '已过半，建议清理' : '余量充足'

      let buttonLabel = '一键清理'
      if (scheduled) buttonLabel = '取消安排'
      else if (phase === 'cleaned') buttonLabel = '再清一次'

      return h(
        'div',
        { className: 'dcm-root', ref: rootRef, style: rootStyle },
        h(
          'div',
          { className: 'dcm-card' + (scheduled ? ' dcm-armed' : '') },
          h(
            'div',
            { className: 'dcm-head', onPointerDown: beginDrag, onDoubleClick: resetPos, title: '按住可拖动 · 双击复位' },
            h('div', { className: 'dcm-mark' }, '鲸'),
            h('div', { className: 'dcm-title' }, 'Cookie 百分表'),
            h(
              'button',
              {
                className: 'dcm-refresh',
                type: 'button',
                title: '立即重新检测',
                onPointerDown: function (event) {
                  event.stopPropagation()
                },
                onClick: function () {
                  load(true)
                },
              },
              '↻',
            ),
          ),
          h(
            'div',
            { className: 'dcm-body' },
            h(
              'div',
              { className: 'dcm-row' },
              h(
                'div',
                { className: 'dcm-pct', style: { color: pctColor } },
                ok ? String(Math.round(pct * 10) / 10) : '—',
                h('small', null, '%'),
              ),
              h(
                'button',
                {
                  className: 'dcm-btn' + (scheduled ? ' dcm-armed' : ''),
                  type: 'button',
                  disabled: busy,
                  onClick: onClean,
                },
                buttonLabel,
              ),
            ),
            h(
              'div',
              { className: 'dcm-meta' },
              ok ? data.count + ' 条 · ' + fmtK(data.bytes) + ' / ' + fmtK(data.maxHeader) : '— / 16 KiB',
            ),
            h(
              'div',
              { className: 'dcm-status' },
              h('i', { className: 'dcm-dot', style: { background: dotColor } }),
              h('span', null, statusText),
            ),
            note === '' ? null : h('div', { className: 'dcm-host' }, note),
          ),
        ),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.effect(
          function () {
            const style = document.createElement('style')
            style.setAttribute('data-plugin', 'dsh-cookie-meter')
            style.textContent = CSS
            document.head.appendChild(style)
            return function () {
              style.remove()
            }
          },
          'dsh-cookie-meter: styles',
        )

        ctx.slots.inject('shell.overlay', function () {
          return ctx.slots.register(
            { name: 'shell.overlay', id: 'cookie-meter', order: 46, label: 'Cookie 百分表' },
            CookieMeter,
          )
        })
      },
    }
  },
})
