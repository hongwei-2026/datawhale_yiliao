# 药物临床试验 AI 标准化病人

工程认证智能体（实验教学方向）：研究者与 AI 模拟受试者练习知情同意等沟通，系统按规范清单给出**建议性**反馈。

> 系统评分与 AI 模拟仅为练习参考，**不是**合规认证或最终能力评价。真正提升靠真实场景与人对人实践及带教指导。

## 快速开始

```bash
pip install -r server/requirements.txt
cp .env.example .env   # 填写 AGNES_API_KEY
python -m uvicorn server.app.main:app --host 127.0.0.1 --port 8000
```

打开：http://127.0.0.1:8000/

| 页面 | 地址 |
|------|------|
| 入门导读 | `/#guide` |
| 模拟对话 | `/#practice` |
| 练习反馈 | `/#feedback` |
| 数据库实况 | `/#database` |

## 文档

- [阶段汇总 · 管理端闭环与发布（2026-09-10）](./PRD3.0/08-阶段汇总-管理端闭环与发布.md)
- [PRD 3.0 索引](./PRD3.0/README.md)
- [AISP 项目介绍](./AISP项目介绍.md)
- [AISP PRD（产品需求）](./AISP-PRD.md)
- [AISP 项目计划书](./AISP-项目计划书.md)
- [AISP 技术架构（人话版）](./AISP-技术架构.md)
- [项目架构设计文档](./项目架构设计文档.md)
- [标准设计文档](./标准设计文档.md)
- [病例设计文档](./病例设计文档.md)
- [数据库设计文档](./数据库设计文档.md)
- [评分引擎设计文档](./评分引擎设计文档.md)
- [AI设计文档](./AI设计文档.md)
- [贡献指南（严格）](./CONTRIBUTING.md)
- [数据库验证文档](./数据库验证文档.md)

## 质量门禁

```bash
python scripts/ci_check.py
```

GitCode 流水线：`.gitcode/workflows/ci.yml`、`pr-guard.yml`（需在仓库流水线中激活）。

## 安全

- 勿提交 `.env` 与真实密钥
- 本地数据库文件 `data/*.db` 不入库
