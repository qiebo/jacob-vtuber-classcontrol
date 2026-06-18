import importlib
mods = ['fastapi','uvicorn','httpx','yaml','loguru','numpy','onnxruntime','sherpa_onnx','openai','anthropic','aiohttp','mcp','pydub','PIL','websocket','requests','tomli','jinja2','audioop','websockets','letta_client']
failed = []
for m in mods:
    try:
        mod = importlib.import_module(m)
        print('OK', m, getattr(mod, '__version__', 'ok'))
    except Exception as e:
        print('FAIL', m, e)
        failed.append(m)
raise SystemExit(1 if failed else 0)
