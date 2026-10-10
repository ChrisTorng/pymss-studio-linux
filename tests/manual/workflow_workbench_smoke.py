import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

import numpy as np
import soundfile as sf
from playwright.sync_api import expect, sync_playwright

root = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser(description='Verify workbench controls with isolated browser stores and the real Python worker.')
parser.add_argument('--url', default='http://127.0.0.1:1435')
parser.add_argument('--output-dir', type=Path, default=Path('.tmp/workbench-ui'))
parser.add_argument('--runtime', type=Path)
args = parser.parse_args()
artifacts = args.output_dir.resolve()
artifacts.mkdir(parents=True, exist_ok=True)
inputs = artifacts / 'inputs'
inputs.mkdir(exist_ok=True)
for name, value in [('one', .3), ('two', .6)]:
    sf.write(inputs / f'{name}.wav', np.full((4410, 2), value, dtype=np.float32), 44100, subtype='FLOAT')
simple = {'version': 1, 'defaults': {'device': 'cpu', 'output_format': 'wav'}, 'steps': [], 'ensembles': [{
    'id': 'phase', 'algorithm': 'invert', 'output_stem': 'Inverted', 'save': 'Default', 'inputs': [{'source': 'input', 'weight': 1}],
}]}
graph = {'nodes': [
    {'id': 1, 'type': 'pymss_load_audio', 'pos': [70, 160], 'size': [290, 170], 'widgets_values': ['input.wav', 'lead'], 'outputs': [{'name': 'audio', 'type': 'AUDIO', 'links': [1]}]},
    {'id': 2, 'type': 'pymss_load_audio', 'pos': [70, 390], 'size': [290, 170], 'widgets_values': ['input.wav', 'reference'], 'outputs': [{'name': 'audio', 'type': 'AUDIO', 'links': [2]}]},
    {'id': 3, 'type': 'pymss_save_audio', 'pos': [470, 160], 'size': [300, 270], 'widgets_values': ['wav', 'Default', '0', 'FLOAT', 'PCM_24', '320k'], 'inputs': [{'name': 'audio', 'type': 'AUDIO', 'link': 1}]},
    {'id': 4, 'type': 'pymss_save_audio', 'pos': [830, 390], 'size': [300, 270], 'widgets_values': ['wav', 'Default', '0', 'FLOAT', 'PCM_24', '320k'], 'inputs': [{'name': 'audio', 'type': 'AUDIO', 'link': 2}]},
], 'links': [[1, 1, 0, 3, 0, 'AUDIO'], [2, 2, 0, 4, 0, 'AUDIO']], 'version': .4, 'last_node_id': 4, 'last_link_id': 2}


def entry(id, name, definition):
    return {'id': id, 'name': name, 'description': '', 'definition': definition, 'format': 'simple' if 'steps' in definition else 'graph', 'formatVersion': 1, 'createdAt': 1, 'updatedAt': 1}


state = {'selectedWorkflowId': 'phase', 'workflows': [entry('phase', '批量反相处理', simple), entry('stereo', '独立音频输出', graph)]}
with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1440, 'height': 1000})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.add_init_script('localStorage.setItem("pymss-studio:app-settings", JSON.stringify(' + json.dumps({'startupOnboardingSeen': True, 'locale': 'zh-CN', 'themeMode': 'light', 'outputDir': str(artifacts / 'output')}, ensure_ascii=False) + ')); localStorage.setItem("pymss-studio:workflow-state", JSON.stringify(' + json.dumps(state, ensure_ascii=False) + '));')
    page.goto(args.url.rstrip('/') + '/#/workflow-simple-editor?workflowId=phase')
    page.wait_for_load_state('networkidle')
    page.screenshot(path=str(artifacts / 'initial.png'), full_page=True)
    expect(page.locator('[data-workbench-input="input"]')).to_be_visible()
    page.screenshot(path=str(artifacts / 'simple-before.png'), full_page=True)
    page.evaluate('''() => {
      window.__workerPayloads=[]; window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener:()=>{}};
      window.__TAURI_INTERNALS__={metadata:{currentWindow:{label:'main'},currentWebview:{label:'main'}},transformCallback:()=>1,convertFileSrc:path=>location.origin+'/@fs/'+path.replaceAll(String.fromCharCode(92),'/'),
        invoke: async(cmd,args) => {
          if(cmd==='pick_media_files') return window.__inputFiles;
          if(cmd==='pick_input_folder') return window.__inputFolder;
          if(cmd==='scan_media_paths') return {files:window.__inputFiles,warnings:[]};
          if(cmd==='pick_output_folder') return window.__outputFolder;
          if(cmd==='save_app_store') {localStorage.setItem('pymss-studio:'+args.name,JSON.stringify(args.data));return null;}
          if(cmd==='load_app_store') return JSON.parse(localStorage.getItem('pymss-studio:'+args.name)||'null');
          if(cmd==='mutate_workflow_store') {const state=JSON.parse(localStorage.getItem('pymss-studio:workflow-state'));const v=args.payload.entry;const index=state.workflows.findIndex(w=>w.id===v.id);if(index<0)state.workflows.push(v);else state.workflows[index]=v;state.selectedWorkflowId=v.id;localStorage.setItem('pymss-studio:workflow-state',JSON.stringify(state));return {state};}
          if(cmd==='start_workflow_inference') {window.__workerPayloads.push(args.payload);return {taskId:args.payload.taskId,started:true};}
          if(cmd==='plugin:event|listen') return 1;
          if(cmd==='cancel_task') return true;
          if(cmd==='is_maximized') return false;
          return null;
        }};
    }''')
    page.evaluate('(value)=>{window.__inputFiles=value.files;window.__inputFolder=value.folder;window.__outputFolder=value.output}', {'files': [str(inputs / 'one.wav'), str(inputs / 'two.wav')], 'folder': str(inputs), 'output': str(artifacts / 'selected-output')})
    page.locator('[data-workbench-input="input"]').get_by_role('button', name='选择文件夹', exact=True).click()
    expect(page.locator('[data-workbench-input="input"] .binding-file')).to_have_count(2)
    page.locator('[data-workbench-output] button').filter(has_text='选择输出目录').click()
    page.locator('[data-workbench-run-panel]').get_by_role('button', name='运行', exact=True).click()
    page.wait_for_timeout(1000)
    page.wait_for_function('window.__workerPayloads.length===1')
    payload = page.evaluate('window.__workerPayloads[0]')
    assert len(payload['tasks']) == 2, payload
    assert payload['workbench'] is True, payload
    assert all('workbenchOutputs' in task for task in payload['tasks'])
    page.screenshot(path=str(artifacts / 'simple-execution.png'), full_page=True)
    page.get_by_text('当前流程', exact=True).click()
    page.locator('.simple-node-editor__title input').fill('批量反相与后续处理')
    frozen = page.evaluate("async()=>{const {useTaskStore}=await import('/src/stores/task.ts');return useTaskStore().tasks[0].runConfig.workbench.sourceDefinition}")
    assert frozen['ensembles'][0]['algorithm'] == 'invert'
    payload_file = artifacts / 'request.json'
    payload_file.write_text(json.dumps(payload, ensure_ascii=False), encoding='utf-8')
    env = {**os.environ, 'PYTHONPATH': str(args.runtime.resolve()) if args.runtime else os.environ.get('PYTHONPATH', ''), 'PYTHONIOENCODING': 'utf-8'}
    result = subprocess.run([sys.executable, str(root / 'python/worker.py'), 'infer_workflow', '--payload', str(payload_file)], capture_output=True, text=True, encoding='utf-8', env=env, timeout=60)
    (artifacts / 'worker-stdout.log').write_text(result.stdout, encoding='utf-8')
    (artifacts / 'worker-stderr.log').write_text(result.stderr, encoding='utf-8')
    assert result.returncode == 0, result.stdout + result.stderr
    events = [json.loads(line) for line in result.stdout.splitlines() if line.startswith('{')]
    for event in events:
        page.evaluate("async(event)=>{const {useTaskStore}=await import('/src/stores/task.ts');useTaskStore().handleWorkerEvent(event)}", event)
    assert sum(event.get('type') == 'task_done' for event in events) == 2
    page.get_by_text('本次执行', exact=True).click()
    expect(page.locator('[data-workbench-run-panel]')).to_have_attribute('data-workbench-view','execution')
    page.locator('[data-workbench-run-panel]').get_by_role('button', name='日志与结果').click()
    expect(page.locator('.run-output')).to_have_count(1)
    page.screenshot(path=str(artifacts / 'simple-results.png'), full_page=True)
    page.get_by_text('当前流程', exact=True).click()
    expect(page.locator('.simple-node-editor__title input')).to_have_value('批量反相与后续处理')
    page.once('dialog', lambda dialog: dialog.accept())
    page.locator('.workbench-header').get_by_role('button', name='返回工作流', exact=True).click()
    page.wait_for_timeout(300)
    page.evaluate("location.hash='/workflow-node-editor?workflowId=stereo'")
    page.wait_for_load_state('networkidle')
    expect(page.locator('canvas.lg-canvas')).to_be_visible()
    page.screenshot(path=str(artifacts / 'advanced-before.png'), full_page=True)
    def configure_node(node_id):
        page.locator('canvas.lg-canvas').evaluate('''(element,id)=>{
          const node=element.data.graph.getNodeById(id);
          const widget=node.widgets.find(widget=>widget.serialize===false);
          if(!widget) throw Error('Missing runtime binding widget for node '+id);
          widget.callback();
        }''', node_id)
        expect(page.locator('.n-drawer')).to_be_visible()

    for node_id, filename in [(1, 'one'), (2, 'two')]:
        page.evaluate('(files)=>window.__inputFiles=files', [str(inputs / f'{filename}.wav')])
        configure_node(node_id)
        page.locator('.n-drawer').get_by_role('button', name='添加文件', exact=True).click()
        expect(page.locator('.n-drawer .binding-file')).to_have_count(1)
        page.keyboard.press('Escape')
        expect(page.locator('.n-drawer')).not_to_be_visible()
    for node_id in [3, 4]:
        page.evaluate('(value)=>window.__outputFolder=value', str(artifacts / f'output-{node_id}'))
        configure_node(node_id)
        page.locator('.n-drawer').get_by_role('button', name='选择输出目录', exact=True).click()
        page.keyboard.press('Escape')
        expect(page.locator('.n-drawer')).not_to_be_visible()
    page.locator('[data-workbench-run-panel]').get_by_role('button', name='运行', exact=True).click()
    page.wait_for_function('window.__workerPayloads.length===2')
    advanced = page.evaluate('window.__workerPayloads[1]')
    assert advanced['inputs']['studio_input_1'] != advanced['inputs']['studio_input_2']
    payload_file.write_text(json.dumps(advanced, ensure_ascii=False), encoding='utf-8')
    result = subprocess.run([sys.executable, str(root / 'python/worker.py'), 'infer_workflow', '--payload', str(payload_file)], capture_output=True, text=True, encoding='utf-8', env=env, timeout=60)
    assert result.returncode == 0, result.stdout + result.stderr
    advanced_events = [json.loads(line) for line in result.stdout.splitlines() if line.startswith('{')]
    for event in advanced_events:
        page.evaluate("async(event)=>{const {useTaskStore}=await import('/src/stores/task.ts');useTaskStore().handleWorkerEvent(event)}", event)
    completed = next(event for event in advanced_events if event['type'] == 'task_done')
    assert {output['nodeId'] for output in completed['payload']['outputs']} == {'3', '4'}
    for output in completed['payload']['outputs']:
        assert Path(output['path']).parent == artifacts / f"output-{output['nodeId']}"
    expected_directories = {str(artifacts / 'output-3'), str(artifacts / 'output-4')}
    assert set(completed['payload']['outputDirectories']) == expected_directories
    actual_directories = page.evaluate("async(id)=>{const {useTaskStore}=await import('/src/stores/task.ts');return useTaskStore().tasks.find(task=>task.id===id).outputDirectories}", completed['taskId'])
    assert set(actual_directories) == expected_directories
    page.locator('[data-workbench-run-panel]').get_by_role('button', name='日志与结果').click()
    expect(page.locator('.run-details .binding-actions button')).to_have_count(2)
    page.screenshot(path=str(artifacts / 'advanced-results.png'), full_page=True)
    canvas = page.locator('canvas.lg-canvas')
    expect(canvas).to_be_visible()
    canvas.focus()
    page.keyboard.press('Space')
    assert canvas.evaluate('element=>element.data.read_only')
    count = canvas.evaluate('element=>element.data.graph.nodes.length')
    canvas.evaluate('element=>element.data.selectNode(element.data.graph.nodes[0])')
    page.keyboard.press('Delete')
    assert canvas.evaluate('element=>element.data.graph.nodes.length') == count
    invariants = page.evaluate("""async(files)=>{
      const {useTaskStore}=await import('/src/stores/task.ts');
      const {useSettingsStore}=await import('/src/stores/settings.ts');
      const {useWorkflowStore}=await import('/src/stores/workflow.ts');
      const task=useTaskStore(), settings=useSettingsStore();
      const original=task.tasks.find(item=>item.runConfig?.workflowId==='stereo');
      const captured=JSON.stringify(original.runConfig);
      settings.outputDir='D:/changed-default'; settings.defaultFormat='flac';
      const retry=await task.retryTask(original.id);
      if(JSON.stringify(retry.runConfig)!==captured) throw Error('Retry changed its frozen configuration');
      await task.cancelWorkbenchJob(retry.jobId||retry.id);
      const flow=useWorkflowStore().workflows.find(flow=>flow.id==='phase');
      const binding={inputs:{input:{files}},outputs:{},primaryInput:'input',outputLayout:'flat'};
      const active=await task.startWorkbenchInference(flow,binding);
      const queued=await task.startWorkbenchInference(flow,binding);
      const before=window.__workerPayloads.length;
      if(queued.tasks.some(item=>item.status!=='queued'))throw Error('Expected a queued batch');
      await task.cancelWorkbenchJob(queued.jobId);
      if(queued.tasks.some(item=>item.status!=='cancelled'))throw Error('Not all queued files were cancelled');
      if(window.__workerPayloads.length!==before)throw Error('Cancellation started a remaining file');
      await task.cancelWorkbenchJob(active.jobId);
      if(active.tasks.some(item=>item.status!=='cancelled'))throw Error('Not all active files were cancelled');
      return {retryFrozen:true,queuedBatchCancelled:true,activeBatchCancelled:true};
    }""", [str(inputs / 'one.wav'), str(inputs / 'two.wav')])
    print('INVARIANTS', json.dumps(invariants), flush=True)
    print(json.dumps({'events': len(events), 'completed': 2, 'errors': errors, 'payload': str(payload_file)}, ensure_ascii=False))
    assert not errors, errors
    browser.close()
