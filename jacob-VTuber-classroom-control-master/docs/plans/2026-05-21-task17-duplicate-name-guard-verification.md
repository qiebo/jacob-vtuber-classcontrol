# Task 17 - Duplicate Name Guard Verification

## Scope

- Prevent duplicate names when creating/saving personality presets.
- Prevent duplicate names when uploading frame-sequence avatar packs.
- Prevent duplicate names when uploading Live2D avatar zip packages.
- Keep frontend checks for immediate touch-screen feedback and backend checks as an API-level guard.

## Changed Files

- `frontend-source/src/renderer/src/components/sidebar/setting/character.tsx`
- `frontend-source/src/renderer/src/components/sidebar/setting/stage.tsx`
- `frontend-source/src/renderer/src/locales/zh/translation.json`
- `frontend-source/src/renderer/src/locales/en/translation.json`
- `src/open_llm_vtuber/avatar_pack_manager.py`
- `src/open_llm_vtuber/routes.py`

## Behavior

- Personality names are compared after trimming repeated whitespace and normalizing case.
- Custom personality presets cannot reuse the name of another custom preset or a built-in preset.
- Frame-sequence avatar pack names cannot reuse an existing displayed avatar pack name.
- Live2D upload names are checked against the final sanitized model name derived from the zip filename.
- Duplicate uploads return a clear error instead of overwriting an existing avatar or auto-generating a suffixed name.

## Verification

- `npm run build:web` passed.
- `python -m py_compile src/open_llm_vtuber/avatar_pack_manager.py src/open_llm_vtuber/routes.py` passed locally.
- Remote `venv/bin/python -m py_compile src/open_llm_vtuber/avatar_pack_manager.py src/open_llm_vtuber/routes.py` passed on Raspberry Pi.
- Remote page returned HTTP 200 and served `assets/main-C12WmxcZ.js`.
- Remote duplicate frame-sequence upload with `pack_name=默认形象` returned HTTP 400:
  - `人物形象名称已存在：默认形象，请修改后再上传`
- Remote duplicate Live2D upload with `filename=mao_pro.zip` returned HTTP 400:
  - `人物形象名称已存在：mao_pro，请修改压缩包文件名后再上传`

## Notes

- Browser-level click verification was not run because the current automation tool environment did not expose a usable Playwright runtime.
