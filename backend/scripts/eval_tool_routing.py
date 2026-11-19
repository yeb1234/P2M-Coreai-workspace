"""按「问题 → 意图 → 工具 → 参数」评测工具路由。

默认只验策略与参数 schema（不碰数据库）；加 --probe 才执行数据集里显式
标注的探针。这样 CI / 容器里可以快速跑，改完治理层先看策略有没有回归。
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.agents.tool_runtime import PERSONAL_ACTION_TOOLS, build_governed_toolset  # noqa: E402

PERSONAL_ACTIONS = set(PERSONAL_ACTION_TOOLS)

DATASET = Path(__file__).resolve().parents[1] / "tests" / "eval" / "tool_routing_eval.json"


def _schema_fields(tool) -> set[str]:
    schema = getattr(tool, "args_schema", None)
    if schema is None:
        return set()
    fields = getattr(schema, "model_fields", None)
    if fields is not None:
        return set(fields)
    return set(getattr(schema, "__fields__", {}))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", action="store_true", help="输出机器可读结果")
    parser.add_argument("--probe", action="store_true", help="执行数据集中的真实工具探针")
    args = parser.parse_args()

    cases = json.loads(DATASET.read_text(encoding="utf-8"))
    failures: list[dict[str, object]] = []
    probes = 0

    for case in cases:
        ts = build_governed_toolset(case["intent"], user_id=1)
        actual_tools = set(ts.tool_names)
        # 个人动作工具是登录用户的常驻动作层，不属于具体 Skill 的意图路由。
        # 数据集仍然只描述「这个意图该拿哪些检索/画像工具」，否则 72 条会被
        # 四个常驻写工具全部判错，评估信号就没了。
        actual_skill_tools = actual_tools - PERSONAL_ACTIONS
        expected_tools = set(case["tools"])
        expected_skill_tools = expected_tools - PERSONAL_ACTIONS

        if ts.skill.name != case["skill"]:
            failures.append(
                {
                    "id": case["id"],
                    "kind": "skill",
                    "expected": case["skill"],
                    "actual": ts.skill.name,
                }
            )
        if actual_skill_tools != expected_skill_tools:
            failures.append(
                {
                    "id": case["id"],
                    "kind": "tools",
                    "expected": sorted(expected_skill_tools),
                    "actual": sorted(actual_skill_tools),
                }
            )
        missing_personal = sorted(PERSONAL_ACTIONS - actual_tools)
        if missing_personal:
            failures.append(
                {
                    "id": case["id"],
                    "kind": "personal_action_layer",
                    "missing": missing_personal,
                }
            )
        forbidden = actual_tools & set(case.get("forbidden", []))
        if forbidden:
            failures.append(
                {
                    "id": case["id"],
                    "kind": "forbidden_tool",
                    "tools": sorted(forbidden),
                }
            )

        tool_by_name = {tool.name: tool for tool in ts.tools}
        for name, required in case.get("arg_fields", {}).items():
            tool = tool_by_name.get(name)
            if tool is None:
                failures.append(
                    {"id": case["id"], "kind": "arg_tool_missing", "tool": name}
                )
                continue
            fields = _schema_fields(tool)
            missing = [field for field in required if field not in fields]
            if missing:
                failures.append(
                    {
                        "id": case["id"],
                        "kind": "arg_schema",
                        "tool": name,
                        "missing": missing,
                        "actual": sorted(fields),
                    }
                )

        if args.probe and case.get("probe"):
            probe = case["probe"]
            tool = tool_by_name.get(probe["tool"])
            if tool is None:
                failures.append(
                    {"id": case["id"], "kind": "probe_tool_missing", "tool": probe["tool"]}
                )
                continue
            probes += 1
            result = tool.invoke(probe.get("args", {}))
            text = str(result)
            if text.startswith("Error:"):
                failures.append(
                    {"id": case["id"], "kind": "probe_error", "result": text[:300]}
                )
            elif probe.get("expect_non_empty") and "没有找到" in text:
                failures.append(
                    {"id": case["id"], "kind": "probe_empty", "result": text[:300]}
                )

    summary = {
        "cases": len(cases),
        "probes": probes,
        "failures": len(failures),
    }
    if args.json:
        print(json.dumps({"summary": summary, "failures": failures}, ensure_ascii=False, indent=2))
    else:
        print(f"cases={summary['cases']} probes={summary['probes']} failures={summary['failures']}")
        for failure in failures[:20]:
            print(json.dumps(failure, ensure_ascii=False))
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
