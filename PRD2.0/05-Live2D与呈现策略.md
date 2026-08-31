# Live2D 与呈现策略（PRD 2.0）

## 1. 决策

**本迭代默认用 Live2D**，不用 MuseTalk / MiniMax H3 真视频口型。

| 方案 | 成本 | 依赖 | 决策 |
|------|------|------|------|
| Live2D 官方示例模型 | 低 | 前端静态资源 | ✅ 默认 |
| 静态肖像 + 音频口型 CSS | 极低 | 无 GPU | 兜底 |
| MuseTalk | 高（GPU+权重+环境） | 云 GPU | ⏸ 暂缓 |
| MiniMax H3 | 中高、延迟大 | API | 保持关闭 |

理由：导师已明确 **别堆表面逼真**；本地可完整演示；与沟通内核改造解耦。

---

## 2. Persona 映射（现有）

| persona_id | Live2D 模型 |
|------------|-------------|
| PER-HTN-TAXI-01 | mark |
| PER-ELDER-BASIC-01 | natori |
| PER-ELDER-FEMALE-02 | hiyori |

`manifest.json`：`default_visual` / `persona_visual` → `live2d`。

---

## 3. 边界

- Live2D = **在场感**，不替代问题引擎  
- 语音仍用 MiniMax TTS（可选）  
- 加载失败 → 自动回退肖像 SVG/webp（`digital-human.js` 已有路径）  

---

## 4. 验收

- [ ] 三名可练受试者默认出现 Live2D（或失败时肖像兜底）  
- [ ] 关闭 MuseTalk 时练习不被阻塞  
- [ ] 不影响对话持久化与历史  
