"""运行时提示词加载。

7.0 起提示词归入 configs/ 配置层，并纳入数据库版本库管理：
- 仓库内单一事实源是 configs/prompts/runtime_prompts.py；
- 资产页发布后调用 reload_runtime_prompts()，无需重启进程；
- 容器内 configs/ 以只读镜像层 + 可写挂载存在，路径由 CONFIGS_DIR 覆盖。
"""

from pathlib import Path
import importlib.util
import os

_CONFIGS_DIR = Path(os.environ.get("CONFIGS_DIR", "")).resolve() if os.environ.get("CONFIGS_DIR") else None


def _find_runtime_prompts_path() -> Path:
    candidates: list[Path] = []
    if _CONFIGS_DIR:
        candidates.append(_CONFIGS_DIR / "prompts" / "runtime_prompts.py")
    for parent in Path(__file__).resolve().parents:
        candidates.append(parent / "configs" / "prompts" / "runtime_prompts.py")
        # 兼容旧布局，迁移期保留一条回退路径。
        candidates.append(parent / "prompts" / "runtime_prompts.py")
    for path in candidates:
        if path.exists():
            return path
    raise ModuleNotFoundError("Could not find configs/prompts/runtime_prompts.py from backend app path")


def _load_runtime_prompts():
    path = _find_runtime_prompts_path()
    spec = importlib.util.spec_from_file_location("siteyeb_runtime_prompts", path)
    if spec and spec.loader:
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module
    raise ModuleNotFoundError(f"Could not load runtime prompts from {path}")


_runtime_prompts = _load_runtime_prompts()

SUBTITLE_CORRECTION_DEFAULT = _runtime_prompts.SUBTITLE_CORRECTION_DEFAULT
SUBTITLE_CORRECTION_SYSTEM = _runtime_prompts.SUBTITLE_CORRECTION_SYSTEM
build_summary_prompt = _runtime_prompts.build_summary_prompt


def reload_runtime_prompts() -> None:
    """发布新提示词后刷新模块级引用，保证下一次请求立即生效。"""
    global _runtime_prompts, SUBTITLE_CORRECTION_DEFAULT, SUBTITLE_CORRECTION_SYSTEM, build_summary_prompt
    _runtime_prompts = _load_runtime_prompts()
    SUBTITLE_CORRECTION_DEFAULT = _runtime_prompts.SUBTITLE_CORRECTION_DEFAULT
    SUBTITLE_CORRECTION_SYSTEM = _runtime_prompts.SUBTITLE_CORRECTION_SYSTEM
    build_summary_prompt = _runtime_prompts.build_summary_prompt
