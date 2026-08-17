import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

// PWA：仅在 HTTPS/localhost 注册 Service Worker（file:// 不支持 SW）
// dev 模式下不注册 SW 并主动注销已有 SW，避免缓存旧代码导致 HMR 失效；
// 生产模式（dist 单文件）保留 SW 以支持离线访问。
if('serviceWorker' in navigator){
  if(import.meta.env.DEV){
    // dev：注销所有已存在的 Service Worker，防止旧缓存干扰开发
    navigator.serviceWorker.getRegistrations().then(regs=> regs.forEach(r=> r.unregister()))
  } else if(location.protocol==='https:' || location.hostname==='localhost'){
    window.addEventListener('load', ()=>{
      navigator.serviceWorker.register('./sw.js').catch(()=>{})
    })
  }
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
