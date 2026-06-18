import yaml
d = yaml.safe_load(open('/home/yb/Open-LLM-VTuber/conf.yaml'))
ag = d['character_config']['agent_config']
cfg = ag['llm_configs']['openai_compatible_llm']
# 脱敏
safe = {}
for k, v in cfg.items():
    if any(s in k.lower() for s in ['key', 'token', 'secret']):
        safe[k] = f'{str(v)[:6]}***' if v else ''
    else:
        safe[k] = v
print("openai_compatible_llm 配置:")
print(yaml.dump(safe, allow_unicode=True, default_flow_style=False))
