# 贡献指南（严格）

感谢参与「药物临床试验 AI 标准化病人」项目。为避免突发故障与低质量代码进入主分支，请遵守以下硬性规则。

## 1. 项目边界（先读再改）

1. 必读 [`题目方向`](./项目架构设计文档.md) / [`项目架构设计文档.md`](./项目架构设计文档.md)：工程认证智能体 · 实验教学方向，不得做成无关通用 AI 玩具。  
2. 双底座不可偏废：标准/评分（A）与病例事实（B）。  
3. 系统评分与 AI 模拟均为**建议**，不得写成合规认证或最终能力裁定。

## 2. 分支与合并

| 规则 | 要求 |
|------|------|
| 禁止直推 `main` | 功能请开 `feature/*` 或 `fix/*`，经 PR 合并 |
| PR 必须通过流水线 | `.gitcode/workflows/ci.yml` 与 `pr-guard.yml` 全绿 |
| 单 PR 范围 | 一事一 PR；禁止无关大重构夹带 |
| 描述 | 写清动机、影响面、如何验证 |

## 3. 绝对禁止提交

- `.env`、真实 API Key、私钥、证书、内网账号  
- `data/*.db` 等本地运行产物  
- 真实受试者 / 患者 PII  
- 未经说明的二进制大文件（>1.5MB 将被 CI 拒绝）

本地密钥只放 `.env`（参考 `.env.example`）。

## 4. 代码质量底线

提交前在仓库根目录执行：

```bash
python scripts/ci_check.py
```

建议同时：

```bash
pip install -r server/requirements.txt ruff
ruff check server scripts --select E,F,W,I,B,UP --ignore E501
```

要求：

- Python 可 `compileall`  
- `web/data/**/*.json` 合法  
- 核心模块 import 冒烟通过  
- 无明显硬编码密钥  

## 5. 功能改动自检

若改动 AI / 评分 / 病例 / 标准：

- [ ] 是否仍声明「建议非认证」？  
- [ ] 占位病例是否仍标注 `placeholder`？  
- [ ] 是否更新对应设计文档？  
- [ ] 是否可用 `#practice` / `#feedback` 或 API 冒烟验证？

## 6. Review 否决项（示例）

- 把评分写成「已合规/已认证」  
- 绕过 grounding 允许患者乱编症状  
- 删除或弱化 CI 门禁  
- 提交密钥或 `.env`  
- 无测试/无说明的大范围格式化刷屏  

## 7. 本地运行（贡献者）

```bash
pip install -r server/requirements.txt
cp .env.example .env   # 自行填写 Agnes Key
python -m uvicorn server.app.main:app --host 127.0.0.1 --port 8000
```

打开 http://127.0.0.1:8000/

## 8. 流水线说明

| 工作流 | 作用 |
|--------|------|
| `ci.yml` | 密钥扫描、文档齐全、JSON、Ruff、编译、前端静态检查 |
| `pr-guard.yml` | PR 额外禁止危险文件与超大变更 |

首次使用请在 GitCode 仓库「流水线」中激活上述 YAML。
