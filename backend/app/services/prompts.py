from pathlib import Path
import importlib.util


def _load_runtime_prompts():
    for parent in Path(__file__).resolve().parents:
        path = parent / "prompts" / "runtime_prompts.py"
        if not path.exists():
            continue
        spec = importlib.util.spec_from_file_location("siteyeb_runtime_prompts", path)
        if spec and spec.loader:
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            return module
    raise ModuleNotFoundError("Could not find prompts/runtime_prompts.py from backend app path")


_runtime_prompts = _load_runtime_prompts()

ASSISTANT_CONTEXT_INSTRUCTION = _runtime_prompts.ASSISTANT_CONTEXT_INSTRUCTION
ASSISTANT_SYSTEM_DEFAULT = _runtime_prompts.ASSISTANT_SYSTEM_DEFAULT
SUBTITLE_CORRECTION_DEFAULT = _runtime_prompts.SUBTITLE_CORRECTION_DEFAULT
SUBTITLE_CORRECTION_SYSTEM = _runtime_prompts.SUBTITLE_CORRECTION_SYSTEM
build_assistant_learning_prompt = _runtime_prompts.build_assistant_learning_prompt
build_contextual_user_message = _runtime_prompts.build_contextual_user_message
build_summary_prompt = _runtime_prompts.build_summary_prompt
