import React, { useState, useRef, useEffect } from 'react'
import LightPanel from './components/LightPanel'
import lightsData from './data/lights.json'
import { copyText } from './utils/clipboard'
import wechatImg from './assets/reward-wechat.png'
import alipayImg from './assets/reward-alipay.jpg'

// ===== 规则数据层 =====
// 预设规则（内置，不可修改，有语音播报）
const BUILTIN_RULES = [
  { id:'builtin-standard', name:'标准规则（18项）', builtin:true, questions: lightsData }
]
// 自定义规则可勾选的灯光开关（勾选后自动拼接为 action）
const SWITCHES = ['近光','远光','远近交替','示廓灯','双闪','雾灯','左转','右转','全部复位']
// 勾选项拼接为 action：含"全部复位"则为全部复位，否则用 + 连接
function switchesToAction(switches){
  if(!switches || switches.length===0) return ''
  if(switches.includes('全部复位')) return '全部复位'
  return switches.filter(s=>s!=='全部复位').join('+')
}
// 预设 action 解析回勾选状态（复合操作无法回填，返回空）
function actionToSwitches(action){
  if(!action) return []
  if(action==='全部复位') return ['全部复位']
  if(action.includes('→')) return []
  return action.split('+').map(s=>s.trim()).filter(Boolean)
}

function loadCustomRules(){
  try{ return JSON.parse(localStorage.getItem('custom_rules')||'[]') }catch(e){ return [] }
}
function saveCustomRules(rules){
  localStorage.setItem('custom_rules', JSON.stringify(rules))
}
function loadCurrentRuleId(){
  return localStorage.getItem('current_rule_id') || 'builtin-standard'
}

// 从题库随机抽取 n 道不重复题目
function sampleQuestions(data, n){
  const pool = [...data]
  const out = []
  while(out.length < n && pool.length){
    const i = Math.floor(Math.random()*pool.length)
    out.push(pool.splice(i,1)[0])
  }
  return out
}

// 考场真实流程：首题固定“请开启前照灯”，尾题固定“请关闭所有灯光”，中间 3 题随机
function sampleExamQuestions(data){
  const first = data.find(d=>d.id==='open_headlight') || data[0]
  const last = data.find(d=>d.id==='close_all') || data[data.length-1]
  const middlePool = data.filter(d=>d!==first && d!==last)
  const middle = sampleQuestions(middlePool, 5)
  return [first, ...middle, last]
}

// 预加载本地音频文件（构建时内联为 base64）
const audioModules = import.meta.glob('./assets/audio/*.mp3', { eager: true, query: '?url', import: 'default' })

function getAudioUrl(trigger){
  const normalized = trigger.replace(/[，,]/g, '')
  return audioModules[`./assets/audio/${normalized}.mp3`] || null
}

// 播报语音：复用单个 Audio 元素（便于截断）；onEnded 在语音播报完毕时回调
let audioEl = null
let currentUtterance = null
const SILENCE_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA='
function unlockAudio(){
  // 用临时 Audio 解锁页面媒体（不干扰主 audioEl）
  const tmp = new Audio(SILENCE_WAV)
  tmp.volume = 0
  tmp.play().then(()=>tmp.pause()).catch(()=>{})
}
function playInstruction(q, onEnded){
  if(!q) return
  if(!audioEl) audioEl = new Audio()
  const el = audioEl
  el.pause()
  el.onended = null  // 清除旧回调，避免误触发
  if(currentUtterance){ currentUtterance.onend = null; currentUtterance = null }
  try{ speechSynthesis.cancel() }catch(e){/* ignore */}
  try{
    const url = getAudioUrl(q.trigger)
    if(url){
      el.src = url
      el.currentTime = 0
      el.onended = ()=>{ onEnded && onEnded() }
      const p = el.play()
      if(p && p.catch) p.catch(()=>{
        // 本地音频播放失败时回退到语音合成
        try{
          const u = new SpeechSynthesisUtterance(q.trigger); u.lang='zh-CN'
          u.onend = ()=>{ if(currentUtterance===u) onEnded && onEnded() }
          currentUtterance = u
          speechSynthesis.speak(u)
        }catch(e){ onEnded && onEnded() }
      })
    } else {
      try{
        const u = new SpeechSynthesisUtterance(q.trigger); u.lang='zh-CN'
        u.onend = ()=>{ if(currentUtterance===u) onEnded && onEnded() }
        currentUtterance = u
        speechSynthesis.speak(u)
      }catch(e){ onEnded && onEnded() }
    }
  }catch(e){ console.warn('Audio/TTS failed', e); onEnded && onEnded() }
}

export default function App(){
  const [mode, setMode] = useState('practice') // 'practice' | 'exam' | 'rules'
  const lightRef = useRef(null)

  // ===== 考试模式状态 =====
  const [examRunning, setExamRunning] = useState(false)
  const [examPhase, setExamPhase] = useState('playing') // 'playing'(语音播报中,不计时) | 'answering'(5秒答题中)
  const [questions, setQuestions] = useState([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [timeLeft, setTimeLeft] = useState(5)
  const [score, setScore] = useState(0)
  const [results, setResults] = useState([]) // 每题结果与用户日志
  // 防重入：标记当前题是否已提交，避免自动超时与手动提交并发导致重复记分/越界
  const submittedRef = useRef(false)
  // 持有最新 handleSubmit，供计时 effect 调用，避免闭包过期
  const handleSubmitRef = useRef(()=>{})

  // ===== 练习模式状态 =====
  const [practiceQ, setPracticeQ] = useState(null)
  const [practiceCategory, setPracticeCategory] = useState('全部')
  const [practiceResult, setPracticeResult] = useState(null)

  // ===== 规则管理状态 =====
  const [customRules, setCustomRules] = useState(loadCustomRules)
  const [currentRuleId, setCurrentRuleId] = useState(loadCurrentRuleId)
  // 新建自定义规则的临时表单状态
  const [newRuleName, setNewRuleName] = useState('')
  const [newRuleItems, setNewRuleItems] = useState([])
  // 当前编辑的规则 id（null 表示新建模式）
  const [editingRuleId, setEditingRuleId] = useState(null)
  // 当前查看的规则 id（null 表示不展开）
  const [viewRuleId, setViewRuleId] = useState(null)
  // 导出预览的文本（空字符串表示不显示预览弹窗）
  const [previewData, setPreviewData] = useState(null)
  const [previewFormat, setPreviewFormat] = useState('text')
  // 打赏弹窗
  const [showReward, setShowReward] = useState(false)

  // 当前生效规则（预设优先，找不到回退第一套）
  const allRules = [...BUILTIN_RULES, ...customRules]
  const currentRule = allRules.find(r=>r.id===currentRuleId) || BUILTIN_RULES[0]
  const currentQuestions = currentRule.questions

  // 考试倒计时：每秒 -1；到 0 时自动提交。
  // 注意：不能在 setState updater 里调 handleSubmit（含副作用），StrictMode 下 updater 会被调用两次，
  // 导致 submittedRef 错乱、切题失败、计时器卡题反复重置。改为在 effect 里监听 timeLeft 触发提交。
  useEffect(()=>{
    if(!examRunning) return
    if(examPhase !== 'answering') return  // 仅答题阶段倒计时，语音播报中不计时（防抢答）
    if(timeLeft<=0){
      handleSubmitRef.current(false) // 超时自动提交
      return
    }
    const t = setTimeout(()=> setTimeLeft(s=>s-1), 1000)
    return ()=> clearTimeout(t)
  },[examRunning, examPhase, currentIndex, timeLeft])

  // 移动端音频解锁：首次用户手势时解锁 Audio 元素，后续 useEffect 里才能播放
  useEffect(()=>{
    let unlocked = false
    function unlock(){
      if(unlocked) return
      unlocked = true
      unlockAudio()
      document.removeEventListener('click', unlock)
      document.removeEventListener('touchstart', unlock)
    }
    document.addEventListener('click', unlock)
    document.addEventListener('touchstart', unlock)
    return ()=>{
      document.removeEventListener('click', unlock)
      document.removeEventListener('touchstart', unlock)
    }
  },[])

  // 题目切换/考试开始：播报指令 + 重置面板 + 重置防重入标志
  useEffect(()=>{
    if(!examRunning) return
    const q = questions[currentIndex]
    if(!q) return
    submittedRef.current = false  // 新题开始，允许提交
    setExamPhase('playing')  // 语音播报中，不计时
    let entered = false
    const enterAnswering = ()=>{
      if(entered) return
      entered = true
      setExamPhase('answering')
      setTimeLeft(5)
    }
    if(currentRule.builtin){
      // 语音播报完毕后才开始 5 秒倒计时（防抢答）
      playInstruction(q, enterAnswering)
    } else {
      // 自定义规则无语音，直接进入答题
      enterAnswering()
    }
    const id = setTimeout(()=> lightRef.current?.resetForQuestion(true), 120)
    // 兜底：语音回调未触发时（如音频加载失败），8秒后自动进入答题，避免卡住
    const fallback = setTimeout(enterAnswering, 8000)
    return ()=>{ clearTimeout(id); clearTimeout(fallback) }
  },[examRunning, currentIndex, questions])

  function startExam(){
    const qs = sampleExamQuestions(currentQuestions)
    submittedRef.current = false
    setQuestions(qs)
    setCurrentIndex(0)
    setScore(0)
    setResults([])
    setExamRunning(true)
    setMode('exam')
    setExamPhase('playing')  // 语音播报阶段，不计时（timeLeft 由播报 effect 在语音结束后设置）
    setTimeout(()=>{ lightRef.current?.resetForQuestion(false) }, 120)
  }

  function finishExam(){
    setExamRunning(false)
    // 考试结束：灯光全部归零
    lightRef.current?.resetForQuestion(false)
  }

  // 提交当前题答案：isManual 表示是否用户主动提交
  function handleSubmit(isManual=true){
    if(!examRunning) return
    if(submittedRef.current) return // 防重入：本题已提交则忽略
    const q = questions[currentIndex]
    if(!q) return
    submittedRef.current = true

    const userLog = lightRef.current?.getLog() || []
    const res = lightRef.current?.checkAnswer(q.action) || {correct:false, reason:'未检查'}
    const record = { question: q, correct: !!res.correct, reason: res.reason, userLog }
    setResults(r=>[...r, record])
    if(res.correct) setScore(s=>s+1)

    const next = currentIndex+1
    if(next >= questions.length){
      // 最后一题，结束考试
      setCurrentIndex(next)
      setTimeout(()=> finishExam(), 200)
    } else {
      setCurrentIndex(next)
      setExamPhase('playing')  // 切题进入语音播报阶段，timeLeft 由播报 effect 语音结束后设置
      setTimeout(()=> lightRef.current?.resetForQuestion(true), 200)
    }
  }

  // 每次渲染更新 handleSubmitRef，确保计时 effect 调到最新版本
  handleSubmitRef.current = handleSubmit

  // ===== 练习模式 =====
  function startPractice(){
    const pool = practiceCategory==='全部' ? currentQuestions : currentQuestions.filter(q=>{
      if(practiceCategory==='开灯类') return ['开灯类','近光保持类','远光类','远近交替类'].includes(q.category)
      return q.category===practiceCategory
    })
    if(pool.length===0){ alert('该分类暂无题目'); return }
    const q = sampleQuestions(pool, 1)[0]
    setPracticeQ(q)
    setPracticeResult(null)
    // 关灯题：随机开灯让用户关闭；其他题：重置
    const isCloseAll = q.action === '全部复位' || q.trigger.includes('关闭所有灯光')
    setTimeout(()=>{
      if(isCloseAll) lightRef.current?.randomLightsForClose()
      else lightRef.current?.resetForQuestion()
    }, 120)
    if(currentRule.builtin) playInstruction(q)
  }

  function checkPractice(){
    if(!practiceQ) return
    const res = lightRef.current?.checkAnswer(practiceQ.action) || {correct:false, reason:'未检查'}
    setPracticeResult({ ...res, userLog: lightRef.current?.getLog() || [] })
  }

  // ===== 规则管理 =====
  function selectRule(id){
    setCurrentRuleId(id)
    localStorage.setItem('current_rule_id', id)
  }
  // 基于预设规则创建：复制预设全部指令到表单，操作解析为勾选状态
  function loadFromBuiltin(){
    setNewRuleName('')
    setNewRuleItems(BUILTIN_RULES[0].questions.map(q=> ({ trigger: q.trigger, switches: actionToSwitches(q.action) })))
  }
  // 新建表单：添加一条指令项
  function addNewItem(){
    setNewRuleItems(items=>[...items, { trigger:'', switches: [] }])
  }
  function updateNewItem(i, field, val){
    setNewRuleItems(items=> items.map((it,idx)=> idx===i? {...it, [field]:val}: it))
  }
  // 切换某条指令项的灯光开关勾选
  function toggleSwitch(i, sw){
    setNewRuleItems(items=> items.map((it,idx)=>{
      if(idx!==i) return it
      const has = it.switches.includes(sw)
      // 勾"全部复位"时清空其他；勾其他时取消"全部复位"
      if(sw==='全部复位'){
        return { ...it, switches: has? []: ['全部复位'] }
      }
      let next = it.switches.filter(s=>s!=='全部复位')
      next = has? next.filter(s=>s!==sw): [...next, sw]
      return { ...it, switches: next }
    }))
  }
  function removeNewItem(i){
    setNewRuleItems(items=> items.filter((_,idx)=> idx!==i))
  }
  // 编辑已有规则：载入表单并切换为编辑模式
  function editRule(rule){
    setEditingRuleId(rule.id)
    setNewRuleName(rule.name)
    setNewRuleItems(rule.questions.map(q=> ({ trigger: q.trigger, switches: actionToSwitches(q.action) })))
  }
  // 保存自定义规则（编辑或新建）
  function saveNewRule(){
    const name = newRuleName.trim()
    if(!name){ alert('请输入规则名称'); return }
    const items = newRuleItems.filter(it=> it.trigger.trim() && it.switches.length>0)
    if(items.length===0){ alert('至少添加一条指令并勾选灯光操作'); return }
    const questions = items.map((it,idx)=> ({
      id: 'q'+idx,
      trigger: it.trigger.trim(),
      action: switchesToAction(it.switches),
      category: '自定义',
      audio: ''
    }))
    if(editingRuleId){
      // 编辑已有规则
      const next = customRules.map(r=> r.id===editingRuleId ? { ...r, name, questions } : r)
      setCustomRules(next)
      saveCustomRules(next)
      selectRule(editingRuleId)
    } else {
      // 新建
      const rule = { id: 'custom-'+Date.now(), name, builtin: false, questions }
      const next = [...customRules, rule]
      setCustomRules(next)
      saveCustomRules(next)
      selectRule(rule.id)
    }
    // 清空表单
    setEditingRuleId(null)
    setNewRuleName('')
    setNewRuleItems([])
  }
  function deleteCustomRule(id){
    if(!confirm('确定删除该自定义规则？')) return
    const next = customRules.filter(r=>r.id!==id)
    setCustomRules(next)
    saveCustomRules(next)
    if(currentRuleId===id) selectRule('builtin-standard')
  }
  // 导出规则到剪贴板（纯 JSON，跨平台通用格式）
  function exportRule(rule){
    const data = {
      name: rule.name,
      questions: rule.questions.map(q=> ({ trigger: q.trigger, action: q.action }))
    }
    setPreviewData(data)
    setPreviewFormat('text')  // 默认文本格式
  }
  // 文本格式：人类可读的指令列表
  function formatAsText(data){
    const lines = data.questions.map((q,i)=> `${i+1}. ${q.trigger} → ${q.action}`)
    return `规则名称：${data.name}\n\n${lines.join('\n')}`
  }
  // 当前预览内容（根据格式生成）
  const previewContent = previewData
    ? (previewFormat==='json' ? JSON.stringify(previewData, null, 2) : formatAsText(previewData))
    : ''
  // 从预览弹窗复制到剪贴板
  async function copyPreview(){
    const ok = await copyText(previewContent)
    if(ok) alert('已复制到剪贴板，可粘贴')
    else alert('复制失败，请手动复制')
  }
  function switchMode(m){
    setMode(m)
    setExamRunning(false)
  }

  return (
    <div className="app-container">
      <header>
        <h1>灯光通</h1>
        <div className="controls">
          <button onClick={()=>switchMode('practice')} className={mode==='practice'? 'active':''}>练习模式</button>
          <button onClick={()=>switchMode('exam')} className={mode==='exam'? 'active':''}>模拟考试</button>
          <button onClick={()=>switchMode('rules')} className={mode==='rules'? 'active':''}>规则</button>
          <button className="reward-btn" onClick={()=>setShowReward(true)}>打赏</button>
        </div>
      </header>

      <main className={mode==='rules'?'rules-mode':''}>
        <section className="left">
          <div className="instructions">
            {/* ===== 练习模式 ===== */}
            {mode==='practice' && (
              <div className="fade-in">
                <h2>练习模式</h2>
                <div className="current-rule-tag">当前规则：{currentRule.name}{!currentRule.builtin && '（无语音）'}</div>
                <div className="form-row" style={{marginBottom:8}}>
                  <label>分类筛选：
                    <select value={practiceCategory} onChange={e=>setPracticeCategory(e.target.value)} style={{padding:'4px 8px',borderRadius:6,border:'1px solid #e6eef8'}}>
                      <option value="全部">全部</option>
                      <option value="开灯类">开灯类</option>
                      <option value="停车/故障类">停车/故障类</option>
                      <option value="特殊天气类">特殊天气类</option>
                      <option value="转向类">转向类</option>
                      <option value="结束类">结束类</option>
                    </select>
                  </label>
                </div>
                {!practiceQ ? (
                  <>
                    <p>随机抽题、不限时，操作后点“检查答案”查看对错与原因。</p>
                    <button className="primary" onClick={startPractice}>开始练习（随机一题）</button>
                  </>
                ) : (
                  <div>
                    <div className="question-card">
                      <div className="q-label">当前指令：</div>
                      <div className="q-trigger">{practiceQ.trigger}</div>
                      <div className="q-meta">分类：{practiceQ.category}</div>
                    </div>
                    <div className="btn-row">
                      <button className="primary" onClick={checkPractice}>检查答案</button>
                      <button onClick={startPractice}>下一题</button>
                      <button onClick={()=> lightRef.current?.resetForQuestion(false)}>重置灯光</button>
                    </div>
                    {practiceResult && (
                      <div className={`practice-result ${practiceResult.correct? 'correct':'wrong'}`}>
                        <div className="pr-status">{practiceResult.correct? '✓ 正确' : '✗ 错误'}</div>
                        <div className="pr-reason">{practiceResult.reason}</div>
                        {!practiceResult.correct && (
                          <div className="pr-answer">正确操作：{practiceQ.action}</div>
                        )}
                      </div>
                    )}
                  </div>
                )}
                <details className="ref-list">
                  <summary>查看指令对照表（{currentQuestions.length} 项）</summary>
                  <ul>
                    {currentQuestions.map((it, idx)=> (
                      <li key={idx}><strong>{it.trigger}</strong> → {it.action}</li>
                    ))}
                  </ul>
                </details>
              </div>
            )}

            {/* ===== 考试模式 ===== */}
            {mode==='exam' && (
              <div className="fade-in">
                <h2>模拟考试</h2>
                <div className="current-rule-tag">当前规则：{currentRule.name}{!currentRule.builtin && '（无语音）'}</div>
                {!examRunning ? (
                  <>
                    <p>完全模拟考场：开头+结尾固定，中间随机 5 题，共 7 题。每题语音播报完毕后 5 秒限时，结束输出成绩单。</p>
                    <button className="primary" onClick={startExam}>开始 5 题模拟考试</button>
                  </>
                ) : (
                  <div>
                    <div>第 {Math.min(currentIndex+1, questions.length)} / {questions.length} 题</div>
                    <div className="progress-wrap" style={{marginTop:8}}>
                      <div className="progress-bar" style={{width:`${(currentIndex / questions.length) * 100}%`}} />
                    </div>
                    <div style={{marginTop:10}}>当前指令：<strong>{questions[currentIndex]?.trigger}</strong></div>
                    {examPhase==='playing' ? (
                      <div style={{marginTop:6, color:'#1976d2', fontWeight:600}}>语音播报中，请听完后操作…</div>
                    ) : (
                      <>
                        <div className="time-bar">
                          <div className="time-fill" style={{width:`${(timeLeft/5)*100}%`}} />
                        </div>
                        <div style={{marginTop:6}}>剩余时间: {timeLeft}s</div>
                      </>
                    )}
                    <div className="btn-row" style={{marginTop:8}}>
                      <button className="primary" onClick={()=>handleSubmit(true)}>提交当前答案</button>
                      <button onClick={()=> finishExam() }>提前结束</button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ===== 规则管理 ===== */}
            {mode==='rules' && (
              <div className="fade-in">
                <h2>规则管理</h2>
                <p>预设规则不可修改；可新增自定义规则（无语音播报）。练习与考试使用当前选中的规则。</p>

                <div className="rule-list">
                  {allRules.map(r=> (
                    <div key={r.id} className={`rule-item ${r.id===currentRuleId? 'active':''}`}>
                      <div className="rule-item-main">
                        <span className="rule-name">{r.name}</span>
                        <span className="rule-badge">{r.builtin? '预设':'自定义'}</span>
                        {r.id===currentRuleId && <span className="rule-current">当前使用</span>}
                        {!r.builtin && <span className="rule-noaudio">无语音</span>}
                        <span className="rule-count">{r.questions.length} 项</span>
                      </div>
                      <div className="rule-item-actions">
                        <button className="mini" onClick={()=>setViewRuleId(viewRuleId===r.id? null: r.id)}>{viewRuleId===r.id? '收起':'查看'}</button>
                        {r.id!==currentRuleId && <button className="mini" onClick={()=>selectRule(r.id)}>切换</button>}
                        {!r.builtin && <button className="mini" onClick={()=>exportRule(r)}>导出</button>}
                        {!r.builtin && <button className="mini" onClick={()=>editRule(r)}>编辑</button>}
                        {!r.builtin && <button className="mini danger" onClick={()=>deleteCustomRule(r.id)}>删除</button>}
                      </div>
                      {viewRuleId===r.id && (
                        <div className="rule-view">
                          <table className="rule-view-table">
                            <thead><tr><th>指令</th><th>操作</th></tr></thead>
                            <tbody>
                              {r.questions.map((q,i)=> (
                                <tr key={i}><td>{q.trigger}</td><td>{q.action}</td></tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <div className="rule-form">
                  <h3>{editingRuleId ? '编辑规则' : '新增自定义规则'}</h3>
                  <div className="form-row">
                    <label>规则名称</label>
                    <input value={newRuleName} onChange={e=>setNewRuleName(e.target.value)} placeholder="如：本地简化版" />
                  </div>
                  <div className="form-row">
                    <label>指令项
                      <button className="mini" onClick={loadFromBuiltin}>基于预设规则填充</button>
                      <button className="mini" onClick={()=>setNewRuleItems([])}>清空</button>
                    </label>
                    {newRuleItems.length===0 && <div className="empty-hint">暂无指令，可点“基于预设规则填充”快速开始，或下方按钮逐条添加</div>}
                    {newRuleItems.map((it,i)=> (
                      <div key={i} className="new-item-row">
                        <input className="ni-trigger" value={it.trigger} onChange={e=>updateNewItem(i,'trigger',e.target.value)} placeholder="指令文本，如：夜间通过急弯" />
                        <div className="switch-group">
                          {SWITCHES.map(sw=> (
                            <label key={sw} className={`switch-chip ${it.switches.includes(sw)? 'on':''}`}>
                              <input type="checkbox" checked={it.switches.includes(sw)} onChange={()=>toggleSwitch(i,sw)} />
                              {sw}
                            </label>
                          ))}
                        </div>
                        <button className="mini danger" onClick={()=>removeNewItem(i)}>移除</button>
                      </div>
                    ))}
                    <button className="mini" onClick={addNewItem}>+ 添加指令项</button>
                  </div>
                  <div className="btn-row" style={{marginTop:10}}>
                    <button className="primary" onClick={saveNewRule}>{editingRuleId ? '保存修改' : '保存规则'}</button>
                    {editingRuleId && <button onClick={()=>{ setEditingRuleId(null); setNewRuleName(''); setNewRuleItems([]) }}>取消编辑</button>}
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>

        {mode !== 'rules' && (
        <section className="right">
          <LightPanel ref={lightRef} mode={mode} lightsData={currentQuestions} />

          {/* 考试复盘 */}
          {mode==='exam' && !examRunning && results.length>0 && (
            <div style={{marginTop:12}}>
              <h3>考试结果（复盘）</h3>
              <div>得分: {score} / {questions.length} {score===questions.length? '🎉 满分合格': '❌ 不合格（错一道即不合格）'}</div>
              <div style={{marginTop:8}}>
                {results.map((r,i)=> (
                  <div key={i} className="result-item">
                    <div className="result-header">
                      <span><strong>题 {i+1}：</strong>{r.question.trigger} → {r.question.action}</span>
                      <span className={`result-status ${r.correct? 'correct':'wrong'}`}>{r.correct? '正确':'错误'}</span>
                    </div>
                    <div style={{marginTop:4}}>{r.reason}</div>
                    <details style={{marginTop:6}}>
                      <summary>查看用户操作日志 ({r.userLog.length} 条)</summary>
                      <ul>
                        {r.userLog.map((u,ui)=> <li key={ui}>{new Date(u.ts).toLocaleTimeString()} - {u.text}</li>)}
                      </ul>
                    </details>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
        )}
      </main>
      {/* 导出预览弹窗 */}
      {previewData && (
        <div className="modal-mask" onClick={()=>setPreviewData(null)}>
          <div className="modal-box" onClick={e=>e.stopPropagation()}>
            <h3>规则预览（导出内容）</h3>
            <div className="format-switch">
              <button className={previewFormat==='text'?'on':''} onClick={()=>setPreviewFormat('text')}>文本格式</button>
              <button className={previewFormat==='json'?'on':''} onClick={()=>setPreviewFormat('json')}>JSON格式</button>
            </div>
            <pre className="preview-code">{previewContent}</pre>
            <div className="modal-actions">
              <button onClick={copyPreview}>复制到剪贴板</button>
              <button onClick={()=>setPreviewData(null)}>关闭</button>
            </div>
          </div>
        </div>
      )}
      {/* 打赏弹窗 */}
      {showReward && (
        <div className="modal-mask" onClick={()=>setShowReward(false)}>
          <div className="modal-box reward-box" onClick={e=>e.stopPropagation()}>
            <h3>打赏支持</h3>
            <p className="reward-tip">如果这个工具对你有帮助，可以扫码打赏支持开发者</p>
            <div className="reward-codes">
              <div className="reward-item">
                <img src={wechatImg} alt="微信打赏二维码" />
                <span>微信</span>
              </div>
              <div className="reward-item">
                <img src={alipayImg} alt="支付宝打赏二维码" />
                <span>支付宝</span>
              </div>
            </div>
            <p className="reward-source-tip">对源代码感兴趣？支持 19.9 元即可获取完整源码。付款时请务必备注邮箱（重要的事说三遍：备注邮箱！备注邮箱！备注邮箱！）</p>
            <div className="modal-actions">
              <button onClick={()=>setShowReward(false)}>关闭</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
