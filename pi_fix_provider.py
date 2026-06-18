import yaml

path = '/home/yb/Open-LLM-VTuber/conf.yaml'
with open(path, 'r', encoding='utf-8') as f:
    d = yaml.safe_load(f)

tc = d['character_config']['tts_preprocessor_config']['translator_config']
tc['translate_provider'] = 'deeplx'  # Literal 类型必须用合法值（translate_audio=False 已关闭翻译）
print(f"translate_provider: '' -> 'deeplx'（translate_audio={tc.get('translate_audio')} 翻译仍关闭）")

with open(path, 'w', encoding='utf-8') as f:
    yaml.dump(d, f, allow_unicode=True, default_flow_style=False, sort_keys=False)
print("修复完成")
