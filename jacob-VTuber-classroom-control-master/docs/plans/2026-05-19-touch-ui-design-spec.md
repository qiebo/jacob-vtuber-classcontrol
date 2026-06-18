# 教学数智人触控 UI 设计规格

更新时间：2026-05-19

关联 PRD：`docs/plans/2026-05-09-touch-ui-redesign-prd.md`

## 1. 设计结论

本 UI 升级按“树莓派竖屏触控终端”设计，而不是按移动 App 设计。系统运行在 Ubuntu/Chromium 环境中，触摸屏可支持单指点击、单指滑动和单指拖动，但不把多点触控作为核心交互路径。

声音选择按“统一声音卡片 + TTS 供应商适配层”设计。切换 Edge、火山、阿里云等供应商时，卡片列表随供应商变化，但布局、选中态、语速控件和高级参数入口保持一致。

## 2. 单指触控规范

### 2.1 必须支持的操作

- 单指点击：tab、卡片、按钮、开关、删除确认。
- 单指上下滑动：设置页内容、知识库列表、字幕历史。
- 单指左右滑动：顶部 tab、横向卡片组。
- 单指拖动：语速滑杆、阈值滑杆。

### 2.2 不作为核心路径的操作

- 双指缩放。
- 双指滚动。
- 双指旋转。
- 长按菜单。
- 依赖系统级移动端惯性的复杂手势。

### 2.3 尺寸要求

| 元素 | 最小尺寸 | 推荐尺寸 |
| --- | --- | --- |
| 普通按钮 | 52px 高 | 56px 高 |
| 主操作按钮 | 56px 高 | 60px 高 |
| tab | 46px 高 | 52px 高 |
| 卡片点击区 | 56px 高 | 整卡可点 |
| 滑杆触控轨道 | 40px 高 | 48px 高 |
| 滑杆拖动点 | 32px | 36px |
| 删除/关闭按钮 | 40px | 44px |

### 2.4 CSS/事件建议

- 纵向滚动区使用 `overflow-y: auto` 和 `touch-action: pan-y`。
- 横向 tab 或卡片区使用 `overflow-x: auto` 和 `touch-action: pan-x`。
- 滑杆使用 Pointer Events，兼容鼠标和触屏：`pointerdown`、`pointermove`、`pointerup`。
- 不依赖浏览器原生小滚动条作为主要操作入口。
- 重要滚动区需要可见内容裁切提示，避免用户不知道还能继续滑动。

## 3. 声音卡片供应商适配

### 3.1 统一卡片模型

前端 UI 只消费统一的声音卡片模型：

```ts
interface VoiceCard {
  provider: "edge_tts" | "volcengine_tts" | "aliyun_tts" | string;
  id: string;
  name: string;
  gender?: "男声" | "女声" | "儿童" | "方言";
  tags: string[];
  description?: string;
  configPatch: Record<string, unknown>;
  disabled?: boolean;
  disabledReason?: string;
}
```

### 3.2 供应商切换规则

- 声音页顶部保留 TTS 供应商选择控件。
- 切换供应商后，声音卡片列表立即刷新为对应供应商的音色。
- 每个供应商单独保存上次选中的声音。
- 供应商缺少 API key 或未授权时，卡片可以显示，但需要禁用并展示原因。
- 普通老师不直接接触不同供应商的字段差异。

### 3.3 配置写入规则

点击声音卡片时，UI 记录统一 `VoiceCard`。保存或即时应用时，由适配层把 `configPatch` 写入当前供应商配置。

示例：

```ts
const edgeVoice: VoiceCard = {
  provider: "edge_tts",
  id: "zh-CN-XiaoxiaoNeural",
  name: "晓晓",
  gender: "女声",
  tags: ["推荐", "清晰"],
  configPatch: {
    voice: "zh-CN-XiaoxiaoNeural"
  }
};

const volcengineVoice: VoiceCard = {
  provider: "volcengine_tts",
  id: "zh_female_wanwanxiaohe_moon_bigtts",
  name: "湾湾小何",
  gender: "女声",
  tags: ["推荐", "亲切"],
  configPatch: {
    voice: "zh_female_wanwanxiaohe_moon_bigtts"
  }
};

const aliyunVoice: VoiceCard = {
  provider: "aliyun_tts",
  id: "Cherry",
  name: "Cherry",
  gender: "女声",
  tags: ["中文", "清晰"],
  configPatch: {
    voice: "Cherry"
  }
};
```

### 3.4 声音页默认布局

1. 顶部：供应商分段控件。
2. 中部：当前供应商的声音卡片列表。
3. 语速：大尺寸滑杆，支持恢复默认。
4. 试听：作为 P1 功能；第一期可先只做选择与应用。
5. 高级设置：默认折叠，保留 JSON 参数能力。

## 4. 页面滚动与滑动方案

### 4.1 设置页

- 左侧设置抽屉内容区必须支持纵向滑动。
- 底部“取消/保存”固定在底部，不随内容滚走。
- 顶部 tab 可横向滑动，但当前选中项必须始终高亮。

### 4.2 舞台人物卡片

- 人物卡片网格默认 2 列。
- 当人物超过一屏时，卡片区随设置页整体纵向滚动。
- 上传人物作为一张操作卡片，放在网格末尾。
- 删除按钮不放在主点击区域中心，避免误触。

### 4.3 声音卡片

- 声音卡片列表纵向滑动。
- 卡片整张可点，试听按钮作为独立次级操作。
- 语速滑杆触控区域要比视觉轨道更高，确保手指容易拖动。

### 4.4 配置页

- 配置页按组纵向滚动。
- 常用设置直接展示，高级连接参数折叠。
- 开关控件要靠右，文字说明靠左，整行高度不低于 64px。

### 4.5 字幕区

- 字幕容器有最大高度。
- 对话内容过长时内部纵向滚动。
- 声波组件固定在字幕容器左上角，不参与滚动内容排版。

## 5. 验收补充

- [ ] TTS 从阿里云切到火山时，声音卡片换成火山音色。
- [ ] TTS 从火山切回阿里云时，恢复阿里云上次选中的声音。
- [ ] 声音卡片 UI 在 Edge、火山、阿里云三个供应商下结构一致。
- [ ] 树莓派触屏上可单指上下滑动设置页。
- [ ] 树莓派触屏上可单指横向滑动 tab 区域。
- [ ] 树莓派触屏上可单指拖动语速滑杆。
- [ ] 不使用双指手势也能完成全部 P0 设置任务。
