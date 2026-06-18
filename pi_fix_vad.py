import yaml

path = '/home/yb/Open-LLM-VTuber/conf.yaml'
with open(path, 'r', encoding='utf-8') as f:
    d = yaml.safe_load(f)

cc = d['character_config']
vad = cc['vad_config']
old = vad.get('vad_model')
vad['vad_model'] = None  # 回退：不启用服务端 VAD，与旧版一致（靠前端/ASR 侧）
print(f"vad_model: {old} -> None (回退到旧版行为)")

with open(path, 'w', encoding='utf-8') as f:
    yaml.dump(d, f, allow_unicode=True, default_flow_style=False, sort_keys=False)
print("conf.yaml reverted OK")

with open(path, 'r', encoding='utf-8') as f:
    d2 = yaml.safe_load(f)
print("verify vad_model:", d2['character_config']['vad_config']['vad_model'])
