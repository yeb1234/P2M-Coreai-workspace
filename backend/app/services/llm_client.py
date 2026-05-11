from __future__ import annotations

import json
from dataclasses import dataclass

import requests


Message = dict[str, str]
CONTEXT_LENGTH_KEYS = (
    "context_length",
    "max_context_length",
    "max_context_tokens",
    "max_input_tokens",
    "max_position_embeddings",
    "n_ctx",
)


def _find_context_length(value: object) -> int | None:
    if isinstance(value, dict):
        for key in CONTEXT_LENGTH_KEYS:
            raw = value.get(key)
            if isinstance(raw, int) and raw > 0:
                return raw
            if isinstance(raw, str) and raw.isdigit():
                return int(raw)
        for nested in value.values():
            found = _find_context_length(nested)
            if found:
                return found
    elif isinstance(value, list):
        for item in value:
            found = _find_context_length(item)
            if found:
                return found
    return None


@dataclass(frozen=True)
class OpenAICompatibleClient:
    base_url: str
    api_key: str = ""
    timeout_s: int = 180

    def list_models(self) -> list[str]:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        response = requests.get(
            self.base_url.rstrip("/") + "/models",
            headers=headers,
            timeout=self.timeout_s,
        )
        if response.status_code != 200:
            raise RuntimeError(f"OpenAI-compatible models API HTTP {response.status_code}: {response.text[:500]}")

        data = response.json()
        items = data.get("data") if isinstance(data, dict) else None
        if not isinstance(items, list):
            raise RuntimeError(f"Unexpected OpenAI-compatible models response: {json.dumps(data, ensure_ascii=False)[:500]}")

        models = []
        for item in items:
            if not isinstance(item, dict):
                continue
            value = item.get("id") or item.get("name")
            if isinstance(value, str) and value.strip():
                models.append(value.strip())
        return sorted(set(models))

    def model_context_length(self, model: str) -> tuple[int | None, dict]:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        response = requests.get(
            self.base_url.rstrip("/") + "/models",
            headers=headers,
            timeout=self.timeout_s,
        )
        if response.status_code != 200:
            raise RuntimeError(f"OpenAI-compatible models API HTTP {response.status_code}: {response.text[:500]}")

        data = response.json()
        items = data.get("data") if isinstance(data, dict) else None
        selected = None
        if isinstance(items, list):
            for item in items:
                if not isinstance(item, dict):
                    continue
                if (item.get("id") or item.get("name")) == model:
                    selected = item
                    break
            if selected is None and items:
                selected = items[0] if isinstance(items[0], dict) else None

        target = selected or data
        return _find_context_length(target), target if isinstance(target, dict) else {}

    def chat_completion(
        self,
        *,
        model: str,
        messages: list[Message],
        temperature: float = 0.2,
        max_tokens: int | None = None,
    ) -> str:
        payload: dict[str, object] = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
        }
        if max_tokens is not None:
            payload["max_tokens"] = max_tokens

        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        response = requests.post(
            self.base_url.rstrip("/") + "/chat/completions",
            json=payload,
            headers=headers,
            timeout=self.timeout_s,
        )
        if response.status_code != 200:
            raise RuntimeError(f"OpenAI-compatible API HTTP {response.status_code}: {response.text[:500]}")

        data = response.json()
        try:
            return data["choices"][0]["message"]["content"].strip()
        except (KeyError, IndexError, TypeError):
            raise RuntimeError(f"Unexpected OpenAI-compatible response: {json.dumps(data, ensure_ascii=False)[:500]}")


@dataclass(frozen=True)
class OllamaClient:
    base_url: str
    timeout_s: int = 180

    def model_context_length(self, model: str) -> tuple[int | None, dict]:
        response = requests.post(
            self.base_url.rstrip("/") + "/api/show",
            json={"name": model},
            timeout=self.timeout_s,
        )
        if response.status_code != 200:
            raise RuntimeError(f"Ollama show API HTTP {response.status_code}: {response.text[:500]}")
        data = response.json()
        return _find_context_length(data), data if isinstance(data, dict) else {}

    def generate(self, *, model: str, prompt: str, temperature: float = 0.2) -> str:
        response = requests.post(
            self.base_url.rstrip("/") + "/api/generate",
            json={
                "model": model,
                "prompt": prompt,
                "stream": False,
                "options": {"temperature": temperature},
            },
            timeout=self.timeout_s,
        )
        if response.status_code != 200:
            raise RuntimeError(f"Ollama HTTP {response.status_code}: {response.text[:500]}")

        data = response.json()
        if not isinstance(data, dict) or "response" not in data:
            raise RuntimeError(f"Unexpected Ollama response: {json.dumps(data, ensure_ascii=False)[:500]}")
        return (data.get("response") or "").strip()
