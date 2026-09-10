"""One-shot: add groups / group_id / prompt_examples to scoring rubrics."""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "web" / "data"

IC_GROUPS = [
    {"id": "G-01", "name": "人文关怀与沟通", "displayMax": 20, "order": 1},
    {"id": "G-02", "name": "试验内容与风险获益", "displayMax": 25, "order": 2},
    {"id": "G-03", "name": "回应受试者关切", "displayMax": 20, "order": 3},
    {"id": "G-04", "name": "流程权利与安排", "displayMax": 20, "order": 4},
    {"id": "G-R", "name": "红线", "displayMax": None, "isGate": True, "order": 5},
]
IC_MAP = {
    "IC-P03": ("G-01", "explain", ["用大白话讲一遍试验是干什么的", "有听不懂的随时打断我"]),
    "IC-P04": ("G-01", "explain", ["不着急签字，有问题尽管问", "我把关键点讲完，您慢慢考虑"]),
    "IC-P05": ("G-01", "explain", ["参加完全自愿，不愿意也可以不参加", "中途想退出随时可以，不影响正常治疗"]),
    "IC-P01": ("G-02", "explain", ["这份是伦理委员会批准的最新版知情同意书"]),
    "IC-P02": ("G-02", "explain", ["我先把试验目的、怎么做、您的权利义务讲清楚"]),
    "IC-C01": ("G-02", "explain", ["这次试验主要是想了解这个药对血糖/血压有没有帮助"]),
    "IC-C04": ("G-02", "explain", ["可能出现哪些不适或风险，我具体说一下"]),
    "IC-C05": ("G-02", "explain", ["不一定人人都有效，也可能分到对照/安慰剂"]),
    "IC-C09": ("G-02", "explain", ["您可以随时退出，不会因此受歧视或影响常规治疗"]),
    "CC-01": ("G-03", "respond", ["您问退出权：可以，随时退出且不影响正常治疗"]),
    "CC-02": ("G-03", "respond", ["您问是不是一定有效：不能保证，可能无效或分到对照"]),
    "CC-03": ("G-03", "respond", ["您担心副作用：可能有哪些不适，我们会监测并及时处理"]),
    "IC-C02": ("G-04", "explain", ["大概要来医院几次、做什么检查、怎么服药"]),
    "IC-C06": ("G-04", "explain", ["不参加也可以继续常规治疗，还有其他可选方案"]),
    "IC-C07": ("G-04", "explain", ["如果因试验受伤，会按方案原则处理治疗与补偿"]),
    "IC-C08": ("G-04", "explain", ["交通/误工补贴怎么算，哪些可能要自费"]),
    "IC-C10": ("G-04", "explain", ["监查、稽查或药监可能查阅相关记录"]),
    "IC-C12": ("G-04", "explain", ["以后有重要新信息，我们会再告知您"]),
    "IC-C13": ("G-04", "explain", ["有疑问可以打这个电话，也可以联系伦理委员会"]),
    "IC-P06": ("G-04", "explain", ["有新发现或方案变化，我们会及时告诉您"]),
    "IC-P10": ("G-04", "explain", ["签完后会给您一份副本带走"]),
    "IC-X01": ("G-R", "avoid", ["禁止：不签就不给看病/必须参加"]),
    "IC-X02": ("G-R", "avoid", ["禁止：肯定治好、绝对安全、没有副作用"]),
    "IC-X03": ("G-R", "avoid", ["禁止：故意不提已知重要风险"]),
    "IC-X04": ("G-R", "avoid", ["禁止：暗示不签会影响待遇"]),
    "IC-X05": ("G-R", "avoid", ["禁止：出了事自负、要求放弃权利"]),
    "IC-X06": ("G-R", "avoid", ["禁止：使用未经伦理批准的材料"]),
}

FU_GROUPS = [
    {"id": "G-01", "name": "沟通方式与人文", "displayMax": 20, "order": 1},
    {"id": "G-02", "name": "用药与依从核查", "displayMax": 35, "order": 2},
    {"id": "G-03", "name": "随访安排与安全", "displayMax": 25, "order": 3},
    {"id": "G-R", "name": "红线", "displayMax": None, "isGate": True, "order": 4},
]
FU_MAP = {
    "FU-A01": ("G-02", "ask", ["最近有没有哪天忘记吃药？", "大概是第几天？后来有没有补服？"], "漏服具体日期/原因/补服"),
    "FU-A02": ("G-02", "ask", ["这段时间有没有头晕或不舒服？", "哪一天开始的？有没有测血压、联系过我们？"], "头晕等 AE 追问"),
    "FU-A03": ("G-02", "ask", ["除了试验药，还吃过感冒药、原来的降压药或保健品吗？"], "合并用药"),
    "FU-A04": ("G-02", "ask", ["我们一起看看药盒还剩几片，和应剩数量对一下"], "药盒清点"),
    "FU-A05": ("G-02", "ask", ["服药日记是当天记的吗？有没有事后补记？"], "日记真实性"),
    "FU-A06": ("G-02", "ask", ["家里怎么测血压的？这几天记了几天？"], "家庭血压"),
    "FU-P01": ("G-03", "explain", ["身体不适不必等特别严重，可以随时联系研究中心"], "及时联系 AE"),
    "FU-P02": ("G-03", "explain", ["漏服或想加药先联系我们，不要自己决定补服或加原降压药"], "勿自行处置"),
    "FU-P03": ("G-03", "explain", ["下次随访约在……，有事打这个电话"], "下次随访与电话"),
    "FU-C01": ("G-01", "ask", ["我不是来责怪您的，主要想了解真实情况，咱们一起看怎么更好"], "非责备"),
    "FU-C02": ("G-01", "ask", ["我们按日期慢慢往前对：第几天？那天怎么回事？"], "具体化提问"),
    "FU-X01": ("G-R", "avoid", ["禁止：为什么不按要求、不能继续参加、责备恐吓"], "责备恐吓红线"),
    "FU-X02": ("G-R", "avoid", ["禁止：你就停药/加服，自己决定医学处理"], "自行医嘱红线"),
}


def upgrade(path: Path, groups: list, mapping: dict) -> None:
    data = json.loads(path.read_text(encoding="utf-8"))
    data["groups"] = groups
    meta = data.setdefault("meta", {})
    meta["displayModel"] = {
        "version": "1.0",
        "note": "大类分=该组小项达成率×displayMax，仅展示；总分仍按 scoringModel 维度加权",
        "primaryFeedback": "checklist",
        "scoreRole": "teaching_reference",
    }
    rule = meta.get("passRule") or ""
    if "清单达标为主" not in rule:
        meta["passRule"] = rule.rstrip("；") + "；反馈以清单达标为主，参考分为教学汇总（非问卷赋分）"
    missing = [i["id"] for i in data["items"] if i["id"] not in mapping]
    if missing:
        raise SystemExit(f"{path.name} missing mapping for: {missing}")
    for item in data["items"]:
        packed = mapping[item["id"]]
        gid, role, examples = packed[0], packed[1], packed[2]
        item["group_id"] = gid
        item["trainee_role"] = role
        item["prompt_examples"] = examples
        if len(packed) > 3:
            item["teammate_map_note"] = packed[3]
    ver = meta.get("version") or "1.1.0"
    if "+groups" not in ver:
        meta["version"] = f"{ver}+groups"
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(path.name, "ok", len(data["items"]), "items", len(groups), "groups")


def main() -> None:
    upgrade(ROOT / "scoring-rubric.json", IC_GROUPS, IC_MAP)
    upgrade(ROOT / "scoring-rubric-followup.json", FU_GROUPS, FU_MAP)
    mapping_doc = {
        "case_id": "CASE-HTN-PH3-W4-001",
        "persona": "李建国",
        "sp_type_teammate": "普通型（配合-回避），兼焦虑/低认知成分",
        "note": "队友病例表考点映射到现有 FU 小项；不采纳其整数分与关键词≥80%判定",
        "mappings": [
            {"teammate_point": "漏服追问具体日期/原因/补服", "fu_ids": ["FU-A01", "FU-C02"]},
            {"teammate_point": "不适/头晕与联系中心", "fu_ids": ["FU-A02", "FU-P01"]},
            {"teammate_point": "合并用药", "fu_ids": ["FU-A03"]},
            {"teammate_point": "药盒数量核对", "fu_ids": ["FU-A04"]},
            {"teammate_point": "服药日记真实性", "fu_ids": ["FU-A05"]},
            {"teammate_point": "家庭血压", "fu_ids": ["FU-A06"]},
            {"teammate_point": "非责备沟通", "fu_ids": ["FU-C01"]},
            {"teammate_point": "勿自行停药/补服", "fu_ids": ["FU-P02", "FU-X02"]},
            {"teammate_point": "责备恐吓红线", "fu_ids": ["FU-X01"]},
            {"teammate_point": "下次随访与联系方式", "fu_ids": ["FU-P03"]},
        ],
    }
    out = ROOT / "fu-lijianguo-teammate-mapping.json"
    out.write_text(json.dumps(mapping_doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("wrote", out.name)


if __name__ == "__main__":
    main()
