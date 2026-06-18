import yaml
d = yaml.safe_load(open('/home/yb/Open-LLM-VTuber/conf.yaml'))
cc = d.get('character_config', {})
print("=== character_config keys ===")
print(list(cc.keys()))
# 找音频相关
for key in cc:
    val = cc[key]
    if isinstance(val, dict):
        sub_keys = list(val.keys())
        if any(k in str(sub_keys).lower() for k in ['asr', 'vad', 'audio', 'mic', 'input', 'speech']):
            print(f"=== {key} ===")
            print(yaml.dump(val, allow_unicode=True, default_flow_style=False)[:1500])
# 直接打印 asr/vad/audio 段
for seg in ['asr_config', 'vad_config', 'INPUT_AUDIO_HANDLER', 'audio_config', 'input_audio']:
    if seg in cc:
        print(f"=== {seg} ===")
        print(yaml.dump(cc[seg], allow_unicode=True, default_flow_style=False))
