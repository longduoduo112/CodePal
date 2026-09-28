/** Background detail read-only controls and saved filter. @module tests/sessions/backgroundDetail */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import SessionBrowserPage from '../../src/pages/SessionBrowserPage'
import { resetSessionCacheForTests } from '../../src/hooks/useSessionBrowser'
let api, clipboard
const background={projectId:'codepal:-demo',sessionId:'one',source:'codepal',auto:true,title:'后台审核记录',projectPath:'/tmp/demo',projectName:'demo',modifiedAt:new Date().toISOString()}
beforeEach(()=>{
  resetSessionCacheForTests();localStorage.clear()
  clipboard={writeText:vi.fn(async()=>{})}
  Object.defineProperty(navigator,'clipboard',{value:clipboard,configurable:true})
  api={
    listRecentSessions:vi.fn(async()=>({success:true,data:{projectsDirExists:true,sessions:[background]}})),
    readSession:vi.fn(async()=>({success:true,data:{messages:[{kind:'answer',text:'后台审核回答',offset:0}],hasMore:false,cursor:0}})),
    searchSessions:vi.fn(async()=>({success:true,data:[]})),
    readSessionCwd:vi.fn(async()=>({success:true,cwd:'/tmp/demo',cwdExists:true})),
    launchSessionInTerminal:vi.fn(async()=>({success:true})),
  }
  window.electronAPI=api
})
afterEach(()=>{cleanup();vi.restoreAllMocks();delete window.electronAPI})
it('TC-004 BACKGROUND_DETAIL restores auto preference, opens details but blocks both buttons and keyboard',async()=>{
  localStorage.setItem('codepal.sessions.filter',JSON.stringify({projectPath:null,includeAuto:true}))
  render(<SessionBrowserPage/>)
  fireEvent.click(await screen.findByText('后台审核记录'))
  await screen.findByText('后台审核回答')
  for(const name of ['复制 resume 参数','新终端启动']) {
    const button=screen.getByRole('button',{name})
    expect(button,'BACKGROUND_DETAIL readonly').toBeDisabled()
    expect(button).toHaveAttribute('title','后台调用仅供回顾')
    fireEvent.click(button)
  }
  fireEvent.keyDown(window,{key:'C',metaKey:true,shiftKey:true})
  fireEvent.keyDown(window,{key:'Enter',metaKey:true})
  expect(clipboard.writeText).not.toHaveBeenCalled()
  expect(api.launchSessionInTerminal).not.toHaveBeenCalled()
  expect(api.readSessionCwd).not.toHaveBeenCalled()
  expect(api.readSession).toHaveBeenCalledWith('codepal:-demo','one',expect.anything())
})
it('TC-004 BACKGROUND_DETAIL default hides only-background conversations using existing auto empty state',async()=>{
  render(<SessionBrowserPage/>)
  await waitFor(()=>expect(api.listRecentSessions).toHaveBeenCalled())
  expect(await screen.findByText(/只有插件、脚本自动调用产生的对话/)).toBeInTheDocument()
  expect(screen.queryByText('后台审核记录')).toBeNull()
})
it('TC-004 BACKGROUND_DETAIL ordinary conversations still copy and launch',async()=>{
  api.listRecentSessions.mockResolvedValue({success:true,data:{projectsDirExists:true,sessions:[{...background,projectId:'-demo',source:undefined,auto:false,title:'普通记录'}]}})
  render(<SessionBrowserPage/>)
  fireEvent.click(await screen.findByText('普通记录'))
  await screen.findByText('后台审核回答')
  fireEvent.click(screen.getByRole('button',{name:'复制 resume 参数'}))
  await waitFor(()=>expect(clipboard.writeText).toHaveBeenCalled())
  fireEvent.keyDown(window,{key:'Enter',metaKey:true})
  await waitFor(()=>expect(api.launchSessionInTerminal).toHaveBeenCalledWith({cwd:'/tmp/demo',uuid:'one'}))
})
