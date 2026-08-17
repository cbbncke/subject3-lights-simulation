import React, { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react'

// 简化的灯光状态机（供前端交互原型使用）
// 说明：所有灯光开关均为布尔值，true 表示当前点亮
const initialState = {
  sidelights: false, // 示廓灯
  lowBeam: false,    // 近光灯
  highBeam: false,   // 远光灯
  leftTurn: false,   // 左转向灯
  rightTurn: false,  // 右转向灯
  hazard: false,     // 危险报警闪光灯（双闪）
  fog: false         // 雾灯
}

const LightPanel = forwardRef(function LightPanel({ mode, lightsData }, ref){
  const [state, setState] = useState(initialState)
  const [log, setLog] = useState([])
  // 统一管理所有延时定时器：切题/卸载时一次性清除，避免旧定时器污染新题目状态（修复 setTimeout 泄漏 bug）
  const timersRef = useRef([])
  // 远近交替动画是否已稳定停在近光：用于评分时区分“动画进行中”与“用户手动停在远光”
  const flashDoneRef = useRef(true)

  function clearTimers(){
    timersRef.current.forEach(id => clearTimeout(id))
    timersRef.current = []
  }

  // 注册延时任务并登记，便于后续统一清理
  function after(delay, fn){
    const id = setTimeout(fn, delay)
    timersRef.current.push(id)
    return id
  }

  useEffect(()=>{
    return ()=>{ clearTimers() }
  },[])

  function pushLog(text){
    const entry = { text, ts: Date.now() }
    // 日志按“新→旧”顺序存储，最多保留 40 条
    setLog(l=>[entry, ...l].slice(0,40))
  }

  // 手动清除操作日志
  function clearLog(){
    setLog([])
  }

  // 控件交互：旋钮（OFF -> 示廓 -> 前照灯(近光)），三档循环
  function toggleKnob(){
    if(!state.sidelights && !state.lowBeam){
      setState(s=>({...s, sidelights:true})); pushLog('示廓')
    } else if(state.sidelights && !state.lowBeam){
      setState(s=>({...s, lowBeam:true, highBeam:false})); pushLog('近光')
    } else {
      setState(initialState); pushLog('全部OFF')
    }
  }

  // 推/拉操纵杆：常亮远光 ↔ 回近光
  function pushPullHigh(){
    if(!state.highBeam){
      setState(s=>({...s, highBeam:true, lowBeam:false})); pushLog('远光')
    } else {
      setState(s=>({...s, highBeam:false, lowBeam:true})); pushLog('回近光')
    }
  }

  // 远近交替：瞬时闪烁两次，最终必须停在近光（考核硬性要求）
  function flashToggle(){
    pushLog('远近交替')
    flashDoneRef.current = false  // 动画开始，标记未稳定
    // 视觉上闪两次：远→近→远→近，900ms 后稳定在近光
    setState(s=>({...s, lowBeam:false, highBeam:true}))
    after(300, ()=> setState(s=>({...s, highBeam:false, lowBeam:true})))
    after(600, ()=> setState(s=>({...s, highBeam:true, lowBeam:false})))
    after(900, ()=> {
      setState(s=>({...s, highBeam:false, lowBeam:true}))
      flashDoneRef.current = true  // 动画结束，已稳定停在近光
    })
  }

  function toggleLeft(){
    setState(s=>{
      const next = !s.leftTurn
      // 开左转时关闭矛盾的双闪与右转（实车互锁，不可并存）
      return {...s, leftTurn: next, hazard: next ? false : s.hazard, rightTurn: next ? false : s.rightTurn}
    })
    pushLog('左转')
  }
  function toggleRight(){
    setState(s=>{
      const next = !s.rightTurn
      // 开右转时关闭矛盾的双闪与左转（实车互锁，不可并存）
      return {...s, rightTurn: next, hazard: next ? false : s.hazard, leftTurn: next ? false : s.leftTurn}
    })
    pushLog('右转')
  }
  // 修复闭包陷阱：使用回调内的 s.hazard 而非外层 state.hazard，避免快速连点读到过期闭包值
  function toggleHazard(){ setState(s=>({...s, hazard: !s.hazard, leftTurn:false, rightTurn:false})); pushLog('双闪') }
  function toggleFog(){ setState(s=>({...s, fog: !s.fog})); pushLog('雾灯') }

  // 键盘快捷键优化：用 ref 持有最新 handler，keydown 监听只绑定一次，
  // 避免 [state] 依赖导致每次状态变化都解绑/重绑（原实现性能浪费且易丢事件）
  const handlersRef = useRef({})
  handlersRef.current = { toggleKnob, pushPullHigh, flashToggle, toggleLeft, toggleRight, toggleHazard, toggleFog }
  useEffect(()=>{
    function onKey(e){
      const h = handlersRef.current
      const key = e.key.toLowerCase()
      if(key === 'k') h.toggleKnob()
      else if(key === 'h') h.pushPullHigh()
      else if(key === 'f') h.flashToggle()
      else if(key === 'a') h.toggleLeft()
      else if(key === 'd') h.toggleRight()
      else if(key === 'z') h.toggleHazard()
      else if(key === 'g') h.toggleFog()
    }
    window.addEventListener('keydown', onKey)
    return ()=> window.removeEventListener('keydown', onKey)
  }, [])

  // 供外部调用：检查答案、重置、回放
  useImperativeHandle(ref, ()=>({
    // expected: 中文描述，如 "近光"、"远近交替"、"示廓灯+双闪"、"左转→远近交替→右转→回近光"
    checkAnswer(expected){
      const e = expected || ''
      // 时间窗略大于考试 5 秒，给操作与提交留余量（原 6s 在边界易误判）
      const TIME_WINDOW_MS = 8000
      const now = Date.now()
      // log 存储“新→旧”，过滤后 reverse 为“旧→新”，便于按时间正序匹配
      const recentLogs = log.filter(entry => (now - entry.ts) <= TIME_WINDOW_MS)
        .map(entry=>entry.text).reverse()

      // 复合操作：按 → 拆分，要求顺序匹配（允许中间有无关操作跳过）
      if(e.includes('→')){
        const tokens = e.split('→').map(t=>t.replace(/\s+/g,'').replace(/灯/g,''))
        let idx = 0
        for(let i=0;i<recentLogs.length && idx<tokens.length;i++){
          if(recentLogs[i].includes(tokens[idx])) idx++
        }
        if(idx === tokens.length) return {correct:true, reason:'顺序匹配通过'}
        return {correct:false, reason:`顺序匹配未通过（已匹配 ${idx}/${tokens.length} 步，时间窗 ${TIME_WINDOW_MS/1000}s）`}
      }

      // 多目标（使用 + 或 & 或中英文逗号分隔）
      const parts = e.split(/\+|&|，|,/).map(p=>p.trim()).filter(Boolean)
      let unmet = []
      parts.forEach(p=>{
        if(p.includes('近光')){
          if(!state.lowBeam) unmet.push('近光')
        } else if(p.includes('远光')){
          if(!state.highBeam) unmet.push('远光')
        } else if(p.includes('示廓')){
          if(!state.sidelights) unmet.push('示廓')
        } else if(p.includes('左转')){
          if(!state.leftTurn) unmet.push('左转')
        } else if(p.includes('右转')){
          if(!state.rightTurn) unmet.push('右转')
        } else if(p.includes('双闪')){
          if(!state.hazard) unmet.push('双闪')
        } else if(p.includes('雾')){
          if(!state.fog) unmet.push('雾灯')
        } else if(p.includes('远近交替')){
          // 修复：必须同时满足 ① 有交替操作日志 ② 最终停在近光（highBeam 关、lowBeam 开）
          // 若动画仍在进行中（flashDoneRef=false），视为即将停在近光，判定通过
          const found = recentLogs.some(t=>t.includes('远近交替'))
          if(!found) unmet.push('远近交替(未操作)')
          else if(flashDoneRef.current && (state.highBeam || !state.lowBeam)) unmet.push('远近交替(结束未停在近光)')
        } else if(p.includes('全部') || p.includes('关闭') || p.includes('复位')){
          const anyOn = state.sidelights||state.lowBeam||state.highBeam||state.leftTurn||state.rightTurn||state.hazard||state.fog
          if(anyOn) unmet.push('全部关闭')
        }
      })

      if(unmet.length===0) return {correct:true, reason:'状态匹配通过'}
      return {correct:false, reason:'未满足: '+unmet.join(',')}
    },
    // 切题/重置：清除所有挂起的定时器。
    // keepState=true 时仅清日志，保留灯光状态（考试连续，符合考场：前一题灯光延续到下一题）；
    // keepState=false 时连同灯光状态一起复位（考试开始/结束、练习模式）。
    resetForQuestion(keepState=false){
      clearTimers()
      // 检测远近交替动画是否未完成（被打断时灯光可能停在远光）
      const wasFlashing = !flashDoneRef.current
      flashDoneRef.current = true
      if(keepState){
        setLog([])
        // 动画被打断时强制停在近光，避免远光延续到下一题影响评分
        if(wasFlashing) setState(s=>({...s, highBeam:false, lowBeam:true}))
      } else {
        setState(initialState); setLog([])
      }
    },
    // 关灯题专用：随机开启 1-3 个灯，模拟考试遗留灯光，让用户关闭
    randomLightsForClose(){
      clearTimers()
      flashDoneRef.current = true
      const presets = [
        { lowBeam:true },
        { lowBeam:true, leftTurn:true },
        { lowBeam:true, fog:true },
        { sidelights:true, hazard:true },
        { lowBeam:true, hazard:true },
        { lowBeam:true, rightTurn:true },
        { lowBeam:true, fog:true, hazard:true },
      ]
      const picked = presets[Math.floor(Math.random()*presets.length)]
      setState({ ...initialState, ...picked })
      const names = { sidelights:'示廓灯', lowBeam:'近光', highBeam:'远光', leftTurn:'左转', rightTurn:'右转', hazard:'双闪', fog:'雾灯' }
      setLog([{ text:`随机灯光：${Object.keys(picked).map(k=>names[k]).join('、')} 已开启`, ts:Date.now() }])
    },
    getLog(){
      return [...log].reverse() // 返回从旧到新的顺序，便于复盘
    }
  }))

  // 单个灯光状态的可视化：点亮时高亮，便于直观判断
  const Light = ({on, label}) => (
    <li className={on? 'lit':'off'}>
      <span className="dot" data-on={on} />
      {label}: {on? 'ON':'OFF'}
    </li>
  )

  return (
    <div className="light-panel">
      <h2>灯光面板</h2>
      <div className="panel-grid">
        <div className="panel-controls">
          <div className="knob">
            <button onClick={toggleKnob}>旋钮 OFF→示廓→近光（K）</button>
          </div>

          <div className="lever">
            <button onClick={pushPullHigh}>推/拉（远光切换）（H）</button>
            <button onClick={flashToggle}>远近交替（F）</button>
          </div>

          <div className="toggles">
            <button onClick={toggleLeft} className={state.leftTurn? 'active':''}>左转（A）</button>
            <button onClick={toggleRight} className={state.rightTurn? 'active':''}>右转（D）</button>
            <button onClick={toggleHazard} className={state.hazard? 'active':''}>双闪（Z）</button>
            <button onClick={toggleFog} className={state.fog? 'active':''}>雾灯（G）</button>
          </div>
        </div>

        <div className="panel-status">
          <h3>当前灯光状态</h3>
          <ul className="status-list">
            <Light on={state.sidelights} label="示廓" />
            <Light on={state.lowBeam} label="近光" />
            <Light on={state.highBeam} label="远光" />
            <Light on={state.leftTurn} label="左转" />
            <Light on={state.rightTurn} label="右转" />
            <Light on={state.hazard} label="双闪" />
            <Light on={state.fog} label="雾灯" />
          </ul>

          <h4 className="log-head">操作日志（最近）<button className="clear-log-btn" onClick={clearLog}>清除</button></h4>
          <div className="log">
            {log.slice().reverse().map((l, i)=> <div key={i} className="log-item">{new Date(l.ts).toLocaleTimeString()} - {l.text}</div>)}
          </div>

        </div>
      </div>

      <div className="note">快捷键：K=旋钮, H=远光推/拉, F=远近交替, A/D=左右转, Z=双闪, G=雾灯</div>
    </div>
  )
})

export default LightPanel
