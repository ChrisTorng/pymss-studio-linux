"""Check diagnostics with isolated stores and mocked desktop commands."""
import argparse
import re
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--url', default='http://localhost:1438')
parser.add_argument('--output-dir', type=Path, default=Path('.tmp/diagnostics-ui'))
args = parser.parse_args()
args.output_dir.mkdir(parents=True, exist_ok=True)

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True, args=['--no-proxy-server'])
    page = browser.new_page(viewport={'width': 1280, 'height': 900})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.add_init_script("""localStorage.setItem('pymss-studio:app-settings', JSON.stringify({
      startupOnboardingSeen:true,locale:'zh-CN',themeMode:'light',developerMode:false
    }))""")
    page.goto(args.url.rstrip('/') + '/#/debug')
    page.wait_for_load_state('networkidle')
    expect(page.locator('.debug-page__lock')).to_be_visible()
    for button in page.locator('.debug-header-actions button').all():
        expect(button).to_be_disabled()
    page.evaluate("""async () => {
      const stores=document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s;
      window.__app=stores.get('app');window.__settings=stores.get('settings');
      window.__tasks=stores.get('task');window.__workflow=stores.get('workflow');
      window.__calls=[];window.__revealedPaths=[];window.__copied='';window.__runtimeFailure=false;window.__envFailure=false;window.__logFailure=false;
      Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(text)=>window.__copied=text}});
      window.__env={pythonVersion:'3.12.10',platform:'Windows-11',workerVersion:'2.1.0',
        pymssAvailable:true,pymssVersion:'2.1.8',torchAvailable:true,torchVersion:'2.7.1',
        torchBackend:'cpu',cudaAvailable:false,avAvailable:true,librosaAvailable:true,customModelsSupported:true};
      window.__runtime={platform:'win32',machine:'AMD64',ready:true,installedBackend:'cpu',torchBackend:'cpu',
        torchVersion:'2.7.1',pymssVersion:'2.1.8',pymssGraphAvailable:true,packages:{audioread:true},
        installState:{backend:'cpu',pythonPath:'D:/runtime/cpu/python.exe'},installedEnvironments:[]};
      window.__logInfo={path:'D:/logs/session.log',logsDir:'D:/logs',exists:true,sizeBytes:240,
        persistentPath:'D:/logs/studio.log',persistentExists:true,persistentSizeBytes:240,
        maxBytes:1048576,persistentMaxBytes:1048576,reportExists:false,reportPath:'D:/logs/report.md'};
      window.__logText='2026-10-12T09:00:00Z INFO worker.event taskId=task_a message="Node started"\\n'
        +'2026-10-12T09:00:01Z ERROR worker.event taskId=task_b message="Decoder failed"';
      window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback:()=>1,
        invoke:async(command,args)=>{
          window.__calls.push(command);
          if(command==='runtime_info'){if(window.__runtimeFailure)throw new Error('Runtime probe failed');return structuredClone(window.__runtime);}
          if(command==='get_env_info'){if(window.__envFailure)throw new Error('Environment probe failed');return structuredClone(window.__env);}
          if(command==='optional_runtime_package_status')return {package:'funasr',requirement:'funasr==1.3.26',installed:false,present:false,version:null,source:null,runtimeIdentity:'cpu-py312'};
          if(command==='debug_log_info')return window.__logInfo;
          if(command==='debug_log_read'){if(window.__logFailure)throw new Error('Log read failed');return {path:'D:/logs/studio.log',content:window.__logText,sizeBytes:240,truncated:false};}
          if(command==='get_workflow_editors')return {revision:2,editors:[{label:'workflow-node-editor-flow',workflowId:'flow',kind:'advanced'}]};
          if(command==='debug_runtime_pointers')return {runtimeEnvsDir:'D:/runtime',activeRuntimeFile:'D:/runtime/active-runtime.json',files:[]};
          if(command==='debug_catalog_info')return {baseCatalogPath:'D:/catalog.json',debugCatalogPath:'D:/debug/catalog.json',debugDir:'D:/debug',baseCatalog:{models:[]},debugCatalog:{models:[]},effectiveCatalog:{models:[]},status:{}};
          if(command==='debug_log_create_report'){window.__logInfo.reportExists=true;return {path:'D:/logs/report.md',exists:true,sizeBytes:240};}
          if(command==='reveal_path'){window.__revealedPaths.push(args.path);return;}
          if(command==='save_app_store')return;
          if(command==='get_build_info')return {version:'0.0.12',variant:'default',updateSupported:false};
          if(command==='plugin:event|listen')return 1;
          throw new Error('Unexpected command: '+command);
        }};
      window.__app.envInfo=structuredClone(window.__env);
      window.__app.setWorkerEventConnection('connected');
      await window.__app.checkRuntimeInfo();
      window.__settings.developerMode=true;
      window.__settings.appPaths={...window.__settings.appPaths,dataRoot:'D:/data'};
    }""")
    overview = page.locator('.debug-status-card').first
    expect(overview).to_contain_text('正常')
    expect(page.locator('.diagnostic-row--optional')).to_contain_text('FunASR')
    expect(page.locator('.diagnostic-row--warn')).to_have_count(0)
    expect(page.locator('.debug-header-actions button').last).to_be_enabled()
    assert page.evaluate("!__calls.some(c=>['debug_catalog_info','debug_runtime_pointers','debug_log_read'].includes(c))")
    page.screenshot(path=str(args.output_dir / 'overview-light.png'), full_page=True)
    page.get_by_role('button', name='复制诊断摘要', exact=True).click()
    assert 'pymss: 正常' in page.evaluate('__copied')
    assert 'runtimeIdentity' not in page.evaluate('__copied')
    page.evaluate("__app.handleWorkerEvent({type:'error',taskId:'bad-input',payload:{code:'INVALID_INPUT',message:'Input file does not exist'}})")
    expect(overview).to_contain_text('正常')
    expect(page.locator('.diagnostic-row--error')).to_have_count(0)
    assert page.evaluate("__app.lastError==='Input file does not exist' && __app.envError===null")
    page.evaluate("__app.setWorkerEventConnection('error','Listener failed')")
    expect(page.locator('.diagnostic-row--error')).to_contain_text('Listener failed')
    page.locator('.diagnostic-row').get_by_role('button', name='重新连接', exact=True).click()
    expect(page.locator('.diagnostic-row--error')).to_have_count(0)

    # Unknown values and unavailable APIs are distinct states.
    page.evaluate('__app.runtimeInfo.pymssGraphAvailable=false;delete __app.envInfo.customModelsSupported')
    expect(page.locator('.diagnostic-row--warn')).to_contain_text('高级工作流 API')
    expect(page.locator('.diagnostic-row--unknown')).to_contain_text('本地模型导入')
    page.evaluate('__app.runtimeInfo.pymssGraphAvailable=true;__app.envInfo.customModelsSupported=true;__runtimeFailure=true')
    detect = page.locator('.debug-header-actions').get_by_role('button', name='重新检测', exact=True)
    detect.click()
    expect(page.locator('.diagnostic-row--error')).to_contain_text('Runtime probe failed')
    expect(page.locator('.diagnostic-row').filter(has_text='pymss')).to_contain_text('2.1.8')
    page.screenshot(path=str(args.output_dir / 'probe-failed.png'), full_page=True)
    page.evaluate('__runtimeFailure=false')
    detect.click()
    expect(page.locator('.diagnostic-row--error')).to_have_count(0)
    expect(detect).to_be_enabled()

    page.evaluate('__envFailure=true')
    detect.click()
    expect(page.locator('.diagnostic-row--error')).to_contain_text('Environment probe failed')
    page.evaluate("__app.handleWorkerEvent({type:'error',taskId:'bad-output',payload:{code:'OUTPUT_WRITE_FAILED',message:'Output file is locked'}})")
    expect(page.locator('.diagnostic-row--error')).to_contain_text('Environment probe failed')
    assert page.evaluate("__app.envError==='Environment probe failed'")
    page.evaluate('__envFailure=false')
    detect.click()
    expect(page.locator('.diagnostic-row--error')).to_have_count(0)
    assert page.evaluate('__app.envError===null')

    page.evaluate("""() => {
      const common={model:'voice.ckpt',input:'D:/audio/voice.wav',output:'D:/output',createdAt:1,
        updatedAt:Date.now(),message:'',progress:0,stageLabel:'',logs:[],files:[],outputs:[]};
      __tasks.tasks=[{...common,id:'task_a',status:'separating',progress:42,logs:['[INFO] Workflow started'],nodeLogs:{2:['[ERROR] Node decode failed']},runConfig:{runMode:'workflow',workflowId:'flow',workflowName:'人声处理'},batchId:'batch_1',batchIndex:0},
        {...common,id:'task_missing',status:'queued'}, {...common,id:'task_b',status:'failed',error:'Decoder failed'}];
      __workflow.workflows=[{id:'flow',name:'人声处理',definition:{},format:'graph',createdAt:1,updatedAt:1}];
      __workflow.initialized=true;
      __app.workerEvents=[{type:'workflow_execution',taskId:'task_a',timestamp:'2026-10-12T09:00:02Z',payload:{version:1,event:'node_progress',nodeId:'2'}},
        {type:'error',taskId:'task_b',timestamp:'2026-10-12T09:00:01Z',payload:{message:'Decoder failed'}}];
    }""")
    page.locator('.debug-tabs').get_by_role('button', name='任务与窗口', exact=True).click()
    expect(page.locator('.debug-activity-grid')).to_contain_text('工作流任务')
    expect(page.locator('.debug-activity-grid')).to_contain_text('批量任务 #1')
    expect(page.locator('.debug-activity-grid')).to_contain_text('高级编辑器')
    failures = page.locator('.debug-failed-tasks')
    expect(failures.locator('[role="listitem"]')).to_have_count(1)
    expect(failures.locator('.debug-failed-task-pagination')).to_contain_text('显示 1–1 / 1 条')
    expect(failures.locator('.n-pagination')).to_have_count(0)
    page.evaluate("""() => {
      window.__originalTasks=JSON.parse(JSON.stringify(__tasks.tasks));
      const base=__tasks.tasks.find(item=>item.id==='task_b');
      __tasks.tasks=[...__tasks.tasks.filter(item=>item.status!=='failed'),
        ...Array.from({length:23},(_,index)=>({...base,id:'failure_'+(index+1),
          updatedAt:index+1,error:index===22?Array.from({length:100},(_,line)=>'Decoder traceback line '+line).join('\\n'):'Decoder failed '+(index+1)}))];
      window.__taskOrder=__tasks.tasks.map(item=>item.id);
    }""")
    expect(failures.locator('[role="listitem"]')).to_have_count(5)
    expect(failures.locator('[role="listitem"] > code').first).to_have_text('failure_23')
    expect(failures.locator('.debug-failed-task-pagination')).to_contain_text('显示 1–5 / 23 条')
    first_error = failures.locator('.debug-task-entry__error').first
    assert first_error.evaluate('el=>el.getBoundingClientRect().height<=60')
    failures.locator('[role="listitem"]').first.get_by_role('button', name='执行日志', exact=True).click()
    expect(page.locator('.debug-execution-log-error')).to_contain_text('Decoder traceback line 99')
    assert page.locator('.debug-execution-log-error').evaluate('el=>el.scrollHeight>el.clientHeight')
    page.keyboard.press('Escape')
    failures.locator('.n-pagination-item').filter(has_text=re.compile(r'^2$')).click()
    expect(failures.locator('[role="listitem"] > code').first).to_have_text('failure_18')
    expect(failures.locator('.debug-failed-task-pagination')).to_contain_text('显示 6–10 / 23 条')
    assert page.evaluate('__tasks.tasks.map(item=>item.id).join()===__taskOrder.join()')
    failures.locator('.n-pagination-item').filter(has_text=re.compile(r'^5$')).click()
    expect(failures.locator('[role="listitem"]')).to_have_count(3)
    expect(failures.locator('[role="listitem"] > code').last).to_have_text('failure_1')
    expect(failures.locator('.debug-failed-task-pagination')).to_contain_text('显示 21–23 / 23 条')
    page.screenshot(path=str(args.output_dir / 'failed-tasks-pagination.png'), full_page=True)
    page.evaluate("__tasks.tasks=__tasks.tasks.filter(item=>item.status!=='failed'||['failure_22','failure_23'].includes(item.id))")
    expect(failures.locator('[role="listitem"]')).to_have_count(2)
    expect(failures.locator('.debug-failed-task-pagination')).to_contain_text('显示 1–2 / 2 条')
    expect(failures.locator('.n-pagination')).to_have_count(0)
    page.evaluate("__tasks.tasks=__tasks.tasks.filter(item=>item.status!=='failed')")
    expect(failures).to_contain_text('暂无失败任务记录。')
    expect(failures.locator('.debug-failed-task-pagination')).to_have_count(0)
    page.evaluate("""() => {
      __tasks.tasks=JSON.parse(JSON.stringify(__originalTasks));
      __tasks.tasks.find(item=>item.id==='task_b').message='Decoder failed without an error field';
      delete __tasks.tasks.find(item=>item.id==='task_b').error;
    }""")
    failures.get_by_role('button', name='执行日志', exact=True).click()
    expect(page.locator('.debug-execution-log-error')).to_have_text('Decoder failed without an error field')
    page.keyboard.press('Escape')
    page.evaluate('__tasks.tasks=__originalTasks')
    expect(page.locator('.n-message')).to_have_count(0, timeout=10000)
    page.screenshot(path=str(args.output_dir / 'activity.png'), full_page=True)
    page.locator('.debug-task-entry').filter(has_text='task_a').get_by_role('button', name='执行日志', exact=True).click()
    expect(page.locator('.debug-execution-log-modal')).to_contain_text('Workflow started')
    assert page.locator('.debug-execution-log-modal').evaluate('el=>el.getBoundingClientRect().width<=960')
    page.locator('.debug-node-logs summary').click()
    expect(page.locator('.debug-node-logs')).to_contain_text('Node decode failed')
    page.locator('.debug-execution-log-modal').get_by_role('button', name='复制', exact=True).click()
    assert '[node:2]' in page.evaluate('__copied') and 'Node decode failed' in page.evaluate('__copied')
    page.screenshot(path=str(args.output_dir / 'execution-logs.png'), full_page=True)
    page.keyboard.press('Escape')
    page.locator('.debug-task-entry').filter(has_text='task_a').get_by_role('button', name='应用日志').click()
    expect(page.locator('.debug-log-row')).to_have_count(1)
    expect(page.locator('.debug-log-row')).to_contain_text('Node started')
    page.get_by_role('button', name='复制筛选日志', exact=True).click()
    assert 'task_a' in page.evaluate('__copied') and 'task_b' not in page.evaluate('__copied')
    expect(page.get_by_role('button', name='生成诊断报告', exact=True)).to_have_count(1)
    expect(page.locator('.debug-log-toolbar').get_by_role('button', name='生成诊断报告', exact=True)).to_have_count(0)
    expect(page.locator('.debug-log-toolbar').get_by_role('button', name='打开诊断报告', exact=True)).to_have_count(0)
    # Failed refresh keeps the previous tail and displays the actual read error.
    page.evaluate('__logFailure=true')
    page.locator('.debug-log-toolbar').get_by_role('button', name='刷新', exact=True).click()
    expect(page.locator('.debug-log-read-error')).to_have_text('Log read failed')
    expect(page.locator('.debug-log-row')).to_have_count(1)
    page.evaluate('__logFailure=false')
    page.locator('.debug-tabs').get_by_role('button', name='任务与窗口', exact=True).click()
    page.locator('.debug-task-entry').filter(has_text='task_missing').get_by_role('button', name='应用日志').click()
    expect(page.locator('.debug-log-row')).to_have_count(0)
    expect(page.locator('.debug-log-filters')).to_contain_text('task_missing')
    page.get_by_role('button', name='清空日志', exact=True).click()
    expect(page.get_by_text('将清空会话日志、累计日志及其备份，并删除现有诊断报告。是否继续？', exact=True)).to_be_visible()
    page.keyboard.press('Escape')
    assert page.evaluate("!__calls.includes('debug_log_clear')")

    page.locator('.debug-tabs').get_by_role('button', name='Worker 事件', exact=True).click()
    expect(page.locator('.worker-event-row')).to_have_count(2)
    page.locator('.debug-event-toolbar input').fill('task_a')
    expect(page.locator('.worker-event-row')).to_have_count(1)
    page.locator('.debug-event-toolbar input').fill('')
    page.locator('.debug-event-toolbar').get_by_text('只看异常', exact=True).click()
    expect(page.locator('.worker-event-row')).to_have_count(1)
    expect(page.locator('.worker-event-row')).to_contain_text('task_b')
    page.locator('.worker-event-row').click()
    expect(page.locator('.worker-event-modal-payload')).to_contain_text('Decoder failed')
    page.keyboard.press('Escape')
    page.evaluate("""() => {
      __app.workerEvents=[
        {type:'workflow_execution',taskId:'node_failure',timestamp:'2026-10-12T09:00:01Z',payload:{version:1,event:'node_failed',nodeId:'2',message:'Node decode failed'}},
        {type:'task_log',taskId:'recoverable_warning',timestamp:'2026-10-12T09:00:01Z',payload:{level:'warning',message:'Decoder fallback'}},
        {type:'task_done',taskId:'recoverable_warning',timestamp:'2026-10-12T09:00:02Z',payload:{}},
        {type:'task_log',taskId:'recoverable_error',timestamp:'2026-10-12T09:00:01Z',payload:{level:'error',message:'Recovered decoder error'}},
        {type:'workflow_execution',taskId:'normal_node',timestamp:'2026-10-12T09:00:02Z',payload:{version:1,event:'node_completed'}},
        {type:'task_log',taskId:'normal_log',timestamp:'2026-10-12T09:00:02Z',payload:{level:'info',message:'No error detected'}},
      ];
    }""")
    expect(page.locator('.worker-event-row')).to_have_count(3)
    expect(page.locator('.worker-event-list')).to_contain_text('node_failure')
    expect(page.locator('.worker-event-list')).to_contain_text('recoverable_error')
    expect(page.locator('.worker-event-list')).to_contain_text('recoverable_warning')
    page.locator('.debug-event-toolbar input').fill('recoverable_warning')
    expect(page.locator('.worker-event-row')).to_have_count(1)
    page.locator('.worker-event-row').click()
    expect(page.locator('.worker-event-modal-payload')).to_contain_text('Decoder fallback')
    page.keyboard.press('Escape')

    page.locator('.debug-event-toolbar input').fill('')
    page.evaluate("""() => {
      __app.workerEvents=[
        {type:'download_done',taskId:'download_fallback',timestamp:'2026-10-12T09:00:02Z',payload:{model:'voice.ckpt',downloaded:['D:/models/voice.ckpt'],progress:100}},
        {type:'download_log',taskId:'download_fallback',timestamp:'2026-10-12T09:00:01Z',payload:{level:'warning',message:'aria2c failed; retrying with urllib'}},
        {type:'download_log',taskId:'normal_download',timestamp:'2026-10-12T09:00:01Z',payload:{level:'info',message:'Download complete'}},
      ];
    }""")
    expect(page.locator('.worker-event-row')).to_have_count(1)
    expect(page.locator('.worker-event-row')).to_contain_text('download_fallback')
    page.locator('.worker-event-row').click()
    expect(page.locator('.worker-event-modal-payload')).to_contain_text('aria2c failed; retrying with urllib')
    expect(page.locator('.worker-event-modal-payload')).to_contain_text('download_done')
    page.keyboard.press('Escape')

    page.locator('.debug-tabs').get_by_role('button', name='路径诊断', exact=True).click()
    page.locator('.path-debug-row').filter(has_text='D:/data').get_by_role('button', name='复制', exact=True).click()
    assert page.evaluate('__copied') == 'D:/data'
    page.locator('.debug-header-actions').get_by_role('button', name='生成诊断报告', exact=True).click()
    page.wait_for_function("__calls.includes('reveal_path')")
    assert page.evaluate("__calls.filter(c=>c==='debug_log_create_report').length") == 1
    expect(page.get_by_role('button', name='打开诊断报告', exact=True)).to_have_count(0)
    assert page.evaluate('__revealedPaths') == ['D:/logs/report.md']

    page.locator('.debug-tabs').get_by_role('button', name='运行环境', exact=True).click()
    expect(page.locator('.runtime-status-panel')).to_be_visible()
    assert page.evaluate("__calls.filter(c=>c==='debug_runtime_pointers').length") == 1
    page.locator('.debug-tabs').get_by_role('button', name='概览', exact=True).click()
    page.evaluate("__settings.themeMode='dark'")
    page.set_viewport_size({'width': 1000, 'height': 760})
    assert page.locator('.debug-page').evaluate('el=>el.scrollWidth<=el.clientWidth')
    expect(page.locator('.n-message')).to_have_count(0, timeout=10000)
    page.screenshot(path=str(args.output_dir / 'overview-dark.png'), full_page=True)
    page.evaluate("__settings.locale='en'")
    expect(page.locator('.debug-health-grid')).to_contain_text('Advanced workflow API')
    page.set_viewport_size({'width': 820, 'height': 800})
    assert page.locator('.debug-page').evaluate('el=>el.scrollWidth<=el.clientWidth')
    page.screenshot(path=str(args.output_dir / 'overview-en-narrow.png'), full_page=True)
    page.emulate_media(reduced_motion='reduce')
    assert page.locator('.debug-status-card').first.evaluate('el=>getComputedStyle(el).transitionDuration') == '0s'
    assert not errors, errors
    browser.close()

print('PASS: diagnostic states, lazy reads, refresh recovery, paginated failures, long errors, report actions, task logs, filtered copy, events, themes and narrow layout')
