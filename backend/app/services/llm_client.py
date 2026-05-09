from __future__ import annotations

import json
from dataclasses import dataclass

import requests


Message = dict[str, str]


@dataclass(frozen=True)
class OpenAICompatibleClient:
    base_url: str
    api_key: str = ""
    timeout_s: int = 180

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
