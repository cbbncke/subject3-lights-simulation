import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

// PWA：仅在 HTTPS/localhost 注册 Service Worker（file:// 不支持 SW）
if('serviceWorker' in navigator && (location.protocol==='https:' || location.hostname==='localhost')){
  window.addEventListener('load', ()=>{
    navigator.serviceWorker.register('./sw.js').catch(()=>{})
  })
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
