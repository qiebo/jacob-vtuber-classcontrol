import yaml

path = '/home/yb/Open-LLM-VTuber/conf.yaml'
with open(path, 'r', encoding='utf-8') as f:
    d = yaml.safe_load(f)

cc = d['character_config']
ag = cc['agent_config']

changes = []

# 1. 清空 bilibili 直播配置（课堂不用直播）
old_live = d.get('live_config', {})
d['live_config'] = {'bilibili_live': {'room_ids': [], 'sessdata': ''}}
changes.append('live_config.bilibili_live: room_ids 清空（原 [1991478060]）')

# 2. MCP 服务器：课堂场景关闭联网搜索（保留 time）
bs = ag.get('agent_settings', {}).get('basic_memory_agent', {})
old_mcp = bs.get('mcp_enabled_servers', [])
bs['mcp_enabled_servers'] = []
changes.append(f'agent_settings.basic_memory_agent.mcp_enabled_servers: 清空（原 {old_mcp}）')
bs['use_mcpp'] = False

# 3. tool_prompts：群聊/主动发言在课堂场景无用，但保留 live2d_expression_prompt
# （这些只是 prompt 引用名，实际不加载就不影响，保留不动避免破坏）

# 4. translator_config：课堂用中文，关闭翻译
tp = cc.get('tts_preprocessor_config', {})
tc = tp.get('translator_config', {})
if tc.get('translate_audio'):
    tc['translate_audio'] = False
    changes.append('tts_preprocessor_config.translator_config.translate_audio: False（原 True）')
if tc.get('translate_provider'):
    tc['translate_provider'] = ''
    changes.append('tts_preprocessor_config.translator_config.translate_provider: 清空（原 deeplx）')

# 5. llm_configs：只保留 openai_compatible_llm，删除其他未使用的（减少干扰）
keep = 'openai_compatible_llm'
removed_llms = [k for k in ag.get('llm_configs', {}) if k != keep]
ag['llm_configs'] = {keep: ag['llm_configs'][keep]}
changes.append(f'llm_configs: 只保留 {keep}，删除 {removed_llms}')

# 6. asr_config：只保留 sherpa_onnx_asr + asr_model，删除其他未用 ASR
keep_asr = 'sherpa_onnx_asr'
asr = cc['asr_config']
removed_asr = [k for k in asr if k not in ('asr_model', keep_asr)]
for k in removed_asr:
    del asr[k]
changes.append(f'asr_config: 只保留 {keep_asr}，删除 {removed_asr}')

# 7. tts_config：只保留 volcengine_tts + tts_model
tts = cc['tts_config']
keep_tts = 'volcengine_tts'
removed_tts = [k for k in tts if k not in ('tts_model', keep_tts)]
for k in removed_tts:
    del tts[k]
changes.append(f'tts_config: 只保留 {keep_tts}，删除 {removed_tts}')

# 8. agent_settings：只保留 basic_memory_agent
agent_settings = ag.get('agent_settings', {})
keep_agent = 'basic_memory_agent'
removed_agents = [k for k in agent_settings if k != keep_agent]
for k in removed_agents:
    del agent_settings[k]
changes.append(f'agent_settings: 只保留 {keep_agent}，删除 {removed_agents}')

# 写回
with open(path, 'w', encoding='utf-8') as f:
    yaml.dump(d, f, allow_unicode=True, default_flow_style=False, sort_keys=False)

print("========== 清理完成 ==========")
for c in changes:
    print(f"  - {c}")

# 验证
with open(path, 'r', encoding='utf-8') as f:
    d2 = yaml.safe_load(f)
print("\n========== 验证 ==========")
print(f"ASR: {d2['character_config']['asr_config']['asr_model']}")
print(f"TTS: {d2['character_config']['tts_config']['tts_model']}")
print(f"LLM: {d2['character_config']['agent_config']['agent_settings']['basic_memory_agent']['llm_provider']}")
print(f"VAD: {d2['character_config']['vad_config']['vad_model']}")
print(f"llm_configs: {list(d2['character_config']['agent_config']['llm_configs'].keys())}")
print(f"asr keys: {list(d2['character_config']['asr_config'].keys())}")
print(f"tts keys: {list(d2['character_config']['tts_config'].keys())}")
print(f"live_config: {d2['live_config']}")
