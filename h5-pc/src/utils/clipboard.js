// 跨平台剪贴板工具
// H5/Web 实现于此；小程序/exe/apk 等其他平台只需替换本文件实现，业务代码与数据格式不变。
// 对外只提供 copyText 方法（用于规则导出）。

// 复制文本到剪贴板，成功返回 true
export async function copyText(text){
  // 优先用现代 Clipboard API
  try{
    if(navigator.clipboard?.writeText){
      await navigator.clipboard.writeText(text)
      return true
    }
  }catch(e){ /* 回退到 execCommand */ }
  // 回退方案：临时 textarea + execCommand（兼容旧浏览器、file:// 协议）
  try{
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  }catch(e){
    return false
  }
}
