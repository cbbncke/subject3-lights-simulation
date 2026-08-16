import React, { useState, useRef, useEffect } from 'react'
import LightPanel from './components/LightPanel'
import lightsData from './data/lights.json'

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
  const [mode, setMode] = useState('practice') // 'practice' | 'exam' | 'wrongbook'
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

  // ===== 错题本状态 =====
  const [wrongList, setWrongList] = useState([])

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
    playInstruction(q)
    const id = setTimeout(()=> lightRef.current?.resetForQuestion(true), 120)
    return ()=> clearTimeout(id)
  },[examRunning, currentIndex, questions])

  function startExam(){
    const qs = sampleExamQuestions(lightsData)
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
    // 错题归集到 localStorage
    const wrongs = results.filter(r=>!r.correct)
    if(wrongs.length){
      const prev = JSON.parse(localStorage.getItem('wrong_list')||'[]')
      localStorage.setItem('wrong_list', JSON.stringify([...prev, ...wrongs]))
    }
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
    const q = sampleQuestions(lightsData, 1)[0]
    setPracticeQ(q)
    setPracticeResult(null)
    setTimeout(()=> lightRef.current?.resetForQuestion(), 120)
    playInstruction(q)
  }

  function checkPractice(){
    if(!practiceQ) return
    const res = lightRef.current?.checkAnswer(practiceQ.action) || {correct:false, reason:'未检查'}
    setPracticeResult({ ...res, userLog: lightRef.current?.getLog() || [] })
  }

  // ===== 错题本 =====
  function loadWrongList(){
    const list = JSON.parse(localStorage.getItem('wrong_list')||'[]')
    setWrongList(list)
  }
  function clearWrongList(){
    localStorage.removeItem('wrong_list')
    setWrongList([])
  }

  function switchMode(m){
    setMode(m)
    setExamRunning(false)
    if(m==='wrongbook') loadWrongList()
  }

  return (
    <div className="app-container">
      <header>
        <h1>灯光通</h1>
        <div className="controls">
          <button onClick={()=>switchMode('practice')} className={mode==='practice'? 'active':''}>练习模式</button>
          <button onClick={()=>switchMode('exam')} className={mode==='exam'? 'active':''}>模拟考试</button>
          <button onClick={()=>switchMode('wrongbook')} className={mode==='wrongbook'? 'active':''}>错题本</button>
        </div>
      </header>

      <main>
        <section className="left">
          <div className="instructions">
            {/* ===== 练习模式 ===== */}
            {mode==='practice' && (
              <div className="fade-in">
                <h2>练习模式</h2>
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
                  <summary>查看指令对照表（{lightsData.length} 项）</summary>
                  <ul>
                    {lightsData.map((it, idx)=> (
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

            {/* ===== 错题本 ===== */}
            {mode==='wrongbook' && (
              <div className="fade-in">
                <h2>错题本</h2>
                {wrongList.length===0 ? (
                  <p>暂无错题记录。</p>
                ) : (
                  <>
                    <p>共 {wrongList.length} 条错题记录。</p>
                    <button onClick={clearWrongList}>清空错题本</button>
                    <div style={{marginTop:10}}>
                      {wrongList.map((r,i)=> (
                        <div key={i} className="result-item">
                          <div><strong>{r.question.trigger}</strong> → {r.question.action}</div>
                          <div className="result-status wrong">错误原因：{r.reason}</div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </section>

        <section className="right">
          <LightPanel ref={lightRef} mode={mode} lightsData={lightsData} />

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
      </main>
    </div>
  )
}
