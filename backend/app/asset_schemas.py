"""配置资产版本库 API 入参模型。

所有内容都按 UTF-8 文本处理；超过服务端上限会返回 413。
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class AssetChange(BaseModel):
    path: str
    content: str | None = None
    deleted: bool = False


class CommitRequest(BaseModel):
    branch: str = "main"
    message: str = Field(min_length=1, max_length=2000)
    changes: list[AssetChange] = Field(default_factory=list)
    base_commit: str | None = None


class BranchRequest(BaseModel):
    name: str
    from_ref: str = "main"


class TagRequest(BaseModel):
    name: str
    ref: str = "main"
    message: str = ""


class MergeRequest(BaseModel):
    source: str
    target: str = "main"
    message: str = ""


class RollbackRequest(BaseModel):
    branch: str = "main"
    target_ref: str
    message: str = ""


class PublishRequest(BaseModel):
    commit_hash: str
    branch: str | None = None


class ImportWorkingRequest(BaseModel):
    branch: str = "main"
    message: str = "chore(config): 导入工作区变更"


class AssetRegistryErrorBody(BaseModel):
    detail: str
    conflicts: list[str] | None = None
    context: dict[str, Any] | None = None
