import React, { useState, useRef, useEffect } from 'react'
import LightPanel from './components/LightPanel'
import lightsData from './data/lights.json'

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
  const middle = sampleQuestions(middlePool, 3)
  return [first, ...middle, last]
}

// 播报语音：优先本地音频，失败回退浏览器 TTS
function playInstruction(q){
  if(!q) return
  try{
    if(q.audio){
      const audio = new Audio(`/audio/${q.audio}`)
      audio.play().catch(()=>{
        // 本地音频缺失或播放失败时回退到语音合成
        try{ const u = new SpeechSynthesisUtterance(q.trigger); u.lang='zh-CN'; speechSynthesis.cancel(); speechSynthesis.speak(u)}catch(e){/* ignore */}
      })
    } else {
      try{ const u = new SpeechSynthesisUtterance(q.trigger); u.lang='zh-CN'; speechSynthesis.cancel(); speechSynthesis.speak(u)}catch(e){/* ignore */}
    }
  }catch(e){ console.warn('Audio/TTS failed', e) }
}

export default function App(){
  const [mode, setMode] = useState('practice') // 'practice' | 'exam' | 'rules'
  const lightRef = useRef(null)

  // ===== 考试模式状态 =====
  const [examRunning, setExamRunning] = useState(false)
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
  const [practiceResult, setPracticeResult] = useState(null)

  // ===== 规则管理状态 =====
  const [customRules, setCustomRules] = useState(loadCustomRules)
  const [currentRuleId, setCurrentRuleId] = useState(loadCurrentRuleId)
  // 新建自定义规则的临时表单状态
  const [newRuleName, setNewRuleName] = useState('')
  const [newRuleItems, setNewRuleItems] = useState([])
  // 当前查看的规则 id（null 表示不展开）
  const [viewRuleId, setViewRuleId] = useState(null)

  // 当前生效规则（预设优先，找不到回退第一套）
  const allRules = [...BUILTIN_RULES, ...customRules]
  const currentRule = allRules.find(r=>r.id===currentRuleId) || BUILTIN_RULES[0]
  const currentQuestions = currentRule.questions

  // 考试倒计时：每秒 -1；到 0 时自动提交。
  // 注意：不能在 setState updater 里调 handleSubmit（含副作用），StrictMode 下 updater 会被调用两次，
  // 导致 submittedRef 错乱、切题失败、计时器卡题反复重置。改为在 effect 里监听 timeLeft 触发提交。
  useEffect(()=>{
    if(!examRunning) return
    if(timeLeft<=0){
      handleSubmitRef.current(false) // 超时自动提交
      return
    }
    const t = setTimeout(()=> setTimeLeft(s=>s-1), 1000)
    return ()=> clearTimeout(t)
  },[examRunning, currentIndex, timeLeft])

  // 题目切换/考试开始：播报指令 + 重置面板 + 重置防重入标志
  useEffect(()=>{
    if(!examRunning) return
    const q = questions[currentIndex]
    if(!q) return
    submittedRef.current = false  // 新题开始，允许提交
    if(currentRule.builtin) playInstruction(q)  // 仅预设规则播报语音，自定义规则无语音
    const id = setTimeout(()=> lightRef.current?.resetForQuestion(true), 120)
    return ()=> clearTimeout(id)
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
    setTimeLeft(5)
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
      setTimeLeft(5)
      setTimeout(()=> lightRef.current?.resetForQuestion(true), 200)
    }
  }

  // 每次渲染更新 handleSubmitRef，确保计时 effect 调到最新版本
  handleSubmitRef.current = handleSubmit

  // ===== 练习模式 =====
  function startPractice(){
    const q = sampleQuestions(currentQuestions, 1)[0]
    setPracticeQ(q)
    setPracticeResult(null)
    setTimeout(()=> lightRef.current?.resetForQuestion(), 120)
    if(currentRule.builtin) playInstruction(q)  // 仅预设规则播报语音
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
  // 保存自定义规则
  function saveNewRule(){
    const name = newRuleName.trim()
    if(!name){ alert('请输入规则名称'); return }
    const items = newRuleItems.filter(it=> it.trigger.trim() && it.switches.length>0)
    if(items.length===0){ alert('至少添加一条指令并勾选灯光操作'); return }
    const rule = {
      id: 'custom-'+Date.now(),
      name,
      builtin: false,
      questions: items.map((it,idx)=> ({
        id: 'q'+idx,
        trigger: it.trigger.trim(),
        action: switchesToAction(it.switches),
        category: '自定义',
        audio: ''  // 自定义规则无语音
      }))
    }
    const next = [...customRules, rule]
    setCustomRules(next)
    saveCustomRules(next)
    // 保存后切到新规则
    selectRule(rule.id)
    // 清空表单
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
                    <p>完全模拟考场：随机 5 题，每题 5 秒限时，结束输出成绩单。</p>
                    <button className="primary" onClick={startExam}>开始 5 题模拟考试</button>
                  </>
                ) : (
                  <div>
                    <div>第 {Math.min(currentIndex+1, questions.length)} / {questions.length} 题</div>
                    <div className="progress-wrap" style={{marginTop:8}}>
                      <div className="progress-bar" style={{width:`${(currentIndex / questions.length) * 100}%`}} />
                    </div>
                    <div style={{marginTop:10}}>当前指令：<strong>{questions[currentIndex]?.trigger}</strong></div>
                    <div className="time-bar">
                      <div className="time-fill" style={{width:`${(timeLeft/5)*100}%`}} />
                    </div>
                    <div style={{marginTop:6}}>剩余时间: {timeLeft}s</div>
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
                  <h3>新增自定义规则</h3>
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
                    <button className="primary" onClick={saveNewRule}>保存规则</button>
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
    </div>
  )
}
