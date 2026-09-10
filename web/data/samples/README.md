# 病例导入 · 三种模式演示包

本目录样例对应管理端「添加病例」三条材料路径。云端路径：`web/data/samples/`。

## 基础三路径（演示用，人物不同）

| 模式 | 文件 | 建议选项 | 演示重点 |
|------|------|----------|----------|
| **只有几句故事** | [`sample-rough-liudashan-htn-followup.txt`](./sample-rough-liudashan-htn-followup.txt) | 随访 · 高血压 · 刘大山 | 短文 → 扩写 → 整理卡片 |
| **手头有 Word/PDF（ZIP）** | [`sample-material-zhouminghua-icf-with-junk.zip`](./sample-material-zhouminghua-icf-with-junk.zip) | 知情同意 · 糖尿病 · 周明华 | 上传 ZIP → 刷垃圾文件 → 整理 |
| **内容你已写全** | [`sample-human-chenmeiling-followup.txt`](./sample-human-chenmeiling-followup.txt) | 随访 · 糖尿病 · 陈美玲 | 粘贴全文 → 整理（不编造） |

## 闭环测试 · 周阿姨 × COPD × 家属协同（三路径内容互不相同）

| 模式 | 文件 | 怎么测 |
|------|------|--------|
| **写大概** | [`sample-rough-zhouayi-family-copd.txt`](./sample-rough-zhouayi-family-copd.txt) | 粘贴短文 → 扩写 |
| **交材料 ZIP** | [`sample-material-zhouayi-family-copd-with-junk.zip`](./sample-material-zhouayi-family-copd-with-junk.zip) | 拖入 ZIP → 审核保留便签/纸条、刷掉截图/xlsx 等 |
| **纯人写** | [`sample-human-zhouayi-family-copd.txt`](./sample-human-zhouayi-family-copd.txt) | 粘贴结构化全文 → 整理成卡片 |

说明：

- ZIP 是**碎片访视笔记 + 家属提问条 + 垃圾文件**，不是纯人写那篇全文的压缩版。
- 纯人写是**老师写全的结构化案例**，细节与 ZIP 备忘不完全相同（便于对照「系统有没有乱编」）。
- 场景选 **家属协同沟通**（须设为**正式**才能发学员端）；病种 **COPD**。
- 旧随访样例仍保留：`sample-*-zhouayi-copd-followup.txt`（仅随访局用）。

步骤总览见 [`PRD3.0/06-闭环测试材料-场景病种病例.md`](../../PRD3.0/06-闭环测试材料-场景病种病例.md)。

## 重新生成 ZIP

```bash
# 周明华 · 知情同意演示包
python scripts/gen_sample_material_zip.py

# 周阿姨 · 家属协同闭环交材料包
python scripts/gen_sample_zhouayi_family_zip.py
```

## 一键打包

```bash
python scripts/gen_demo_ingest_packs.py
```
