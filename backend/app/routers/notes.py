"""笔记接口。

两类笔记，权限不同：
  shared   AI 转写产物，属于系统共有。所有人可读，只有 admin 可改。
  private  用户自己写的。只有本人可读写。

以前没有这个区分，所有笔记混在一起、只有 admin 能改，
结果普通用户写不了自己的笔记，成就墙还把 8770 条 AI 产物算成「用户手写」。
"""

import logging
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.database import get_db, settings
from app.models import Note, User
from app.services.quota import ai_daily_quota_for, quota_exceeded_detail
from app.services.rate_limit import ai_daily_limiter

logger = logging.getLogger(__name__)
from app.schemas import NoteOut, NoteUpdate
from app.services.daily_digest import generate_daily_note
from app.services.note_ai import NoteAIError, extract_note_actions, polish_note, summarize_note
from app.services.note_library import save_private_note
from app.services.user_data_cleanup import delete_private_note_files

router = APIRouter(prefix="/api/notes", tags=["notes"])


class NoteCreate(BaseModel):
    title: str = Field(min_length=1, max_length=240)
    content: str = Field(default="", max_length=60_000)
    video_id: int | None = None


class DailyNoteIn(BaseModel):
    # 前端便签存在浏览器里，服务端看不到；由前端把今天更新过的标题带上来
    local_notes: list[str] = Field(default_factory=list)


class NoteAiIn(BaseModel):
    """笔记 AI 请求。

    正文来自浏览器 IndexedDB，服务端不保存、不反查；只处理后返回结果。
    """

    action: Literal["summary", "polish", "actions"]
    title: str = Field(default="", max_length=240)
    markdown: str = Field(default="", max_length=60_000)
    instruction: str = Field(default="", max_length=300)


def _load_visible(note_id: int, user: User, db: Session) -> Note:
    """按可见性取笔记。取不到一律 404 —— 不区分「不存在」和「不属于你」。"""
    note = db.query(Note).filter(Note.id == note_id).first()
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    if note.scope == "private" and note.user_id != user.id:
        # 私有笔记只有本人可见，admin 也不行
        raise HTTPException(status_code=404, detail="Note not found")
    return note


def _private_note_path(note: Note) -> Path:
    """私有笔记的落盘位置。**必须在公开静态目录之外。**

    output_dir 被挂载成 /output 静态目录（main.py: app.mount）。
    user_id / note_id 都是自增整数，放在里面等于给个可枚举的下载地址。
    这里改用 work_dir（容器内 /data/work，不经 nginx，也不经 StaticFiles）。
    """
    return Path(settings.work_dir) / "user-notes" / str(note.user_id) / f"note-{note.id}.md"


def _purge_public_private_note(note_id: int, user_id: int | None, *, keep: Path) -> None:
    """删掉旧版留在公开目录里的私有笔记文件。

    只在「确实是从公开目录读出来的同一份内容」时才删 ——
    调用点保证此刻内容已经写到 keep 了，所以删旧文件不会丢数据。
    """
    if not user_id:
        return
    legacy = Path(settings.output_dir) / "user-notes" / str(user_id) / f"note-{note_id}.md"
    try:
        if legacy.exists() and legacy.resolve() != keep.resolve():
            legacy.unlink()
            logger.info("已清理公开目录下的私有笔记 note_id=%s", note_id)
    except OSError:
        # 删不掉不影响功能，但不能让它静默 —— 这说明笔记可能还在公开可读
        logger.warning("清理公开目录私有笔记失败 note_id=%s path=%s", note_id, legacy, exc_info=True)


@router.post("/ai-daily")
def ai_daily_note(
    payload: DailyNoteIn,
    request: Request,
    user: User = Depends(get_current_user),
):
    """生成「今日 AI 便签」：汇总当天真实学习行为 + 明天建议。

    只统计当前登录用户自己的数据；便签在浏览器端，标题由前端带上来。
    LLM 不可用时服务内部会退回模板，前端拿到的仍然是可读内容。
    """
    # 这个接口会调用外部/本地 LLM；前端按钮可能被连点，先限流再扣每日额度。
    allowed, _ = ai_daily_limiter.hit(f"user:{user.id}")
    if not allowed:
        raise HTTPException(status_code=429, detail="日报生成太频繁，缓一分钟再试")

    quota = ai_daily_quota_for(user.role)
    ok, used, limit = quota.consume(user.id)
    if not ok:
        raise HTTPException(
            status_code=429,
            detail=quota_exceeded_detail(used, limit, "AI 日报"),
        )

    try:
        return generate_daily_note(user.id, payload.local_notes)
    except Exception:
        # 日报失败（LLM/数据聚合异常）不应让用户白扣当天额度。
        quota.refund(user.id)
        raise


@router.post("/ai")
def note_ai(
    payload: NoteAiIn,
    user: User = Depends(get_current_user),
):
    """对当前笔记做总结 / 润色 / 待办日历抽取。

    这是无状态接口：正文由前端带上来，不回写 IndexedDB。
    动作抽取只返回建议，创建待办/日历由前端确认后走现有接口。
    """
    allowed, _ = ai_daily_limiter.hit(f"user:{user.id}:note-ai")
    if not allowed:
        raise HTTPException(status_code=429, detail="AI 操作太频繁，缓一分钟再试")

    quota = ai_daily_quota_for(user.role)
    ok, used, limit = quota.consume(user.id)
    if not ok:
        raise HTTPException(
            status_code=429,
            detail=quota_exceeded_detail(used, limit, "AI 笔记"),
        )

    try:
        if payload.action == "summary":
            result = summarize_note(payload.title, payload.markdown)
            return {"action": "summary", "result": result, "provider": result["provider"], "model": result["model"]}
        if payload.action == "polish":
            result = polish_note(payload.title, payload.markdown, payload.instruction)
            return {"action": "polish", "result": result, "provider": result["provider"], "model": result["model"]}
        result = extract_note_actions(payload.title, payload.markdown)
        return {"action": "actions", "result": result, "provider": result["provider"], "model": result["model"]}
    except NoteAIError as exc:
        quota.refund(user.id)
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        quota.refund(user.id)
        logger.exception("笔记 AI 处理失败 action=%s", payload.action)
        raise HTTPException(status_code=502, detail="AI 服务暂时不可用，请稍后重试") from exc


@router.get("", response_model=list[NoteOut])
def list_notes(
    scope: str | None = None,
    video_id: int | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """当前用户能看到的：所有 shared + 自己的 private。"""
    q = db.query(Note).filter(
        or_(
            Note.scope == "shared",
            (Note.scope == "private") & (Note.user_id == user.id),
        )
    )
    if scope in ("shared", "private"):
        q = q.filter(Note.scope == scope)
    if video_id is not None:
        q = q.filter(Note.video_id == video_id)
    return q.order_by(Note.updated_at.desc()).limit(500).all()


@router.post("", response_model=NoteOut)
def create_note(
    payload: NoteCreate,
    user: User = Depends(get_current_user),
):
    """新建自己的笔记。永远 private —— 共享笔记只由 AI 转写流程产生。"""
    return save_private_note(
        user_id=user.id,
        title=payload.title,
        content=payload.content,
        source="manual",
        video_id=payload.video_id,
    )


@router.put("/{note_id}", response_model=NoteOut)
def update_note(
    note_id: int,
    payload: NoteUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    note = _load_visible(note_id, user, db)

    # 共享笔记是系统内容，改动要管理权限；私有笔记本人可改
    if note.scope == "shared" and (user.role or "") != "admin":
        raise HTTPException(status_code=403, detail="共享笔记需要管理员权限")

    if payload.title is not None:
        note.title = payload.title
    note.content = payload.content

    if note.scope == "private":
        md_path = _private_note_path(note)
    else:
        md_path = Path(note.markdown_path) if note.markdown_path else (
            Path(settings.output_dir) / "notes" / f"note-{note.id}.md"
        )

    md_path.parent.mkdir(parents=True, exist_ok=True)
    md_path.write_text(note.content, encoding="utf-8")
    note.markdown_path = str(md_path)

    # 清掉旧位置的私有笔记文件。
    #
    # 历史上私有笔记写在 output_dir/user-notes/ 下面，而 output_dir 被
    # app.mount("/output", StaticFiles(...)) 整个暴露成静态目录 ——
    # user_id 和 note_id 都是自增整数，等于可以枚举下载任何人的笔记。
    # 换到 work_dir 之后旧文件还在原地，所以这里主动删掉。
    if note.scope == "private":
        _purge_public_private_note(note.id, note.user_id, keep=md_path)

    db.commit()
    db.refresh(note)
    return note


@router.delete("/{note_id}")
def delete_note(
    note_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    note = _load_visible(note_id, user, db)
    if note.scope == "shared":
        # 共享笔记不删 —— 删了视频就少一段笔记；想改内容走 PUT
        raise HTTPException(status_code=403, detail="共享笔记不能删除，只能编辑")
    note_user_id = note.user_id
    db.delete(note)
    db.commit()
    # DB 删除成功后再清文件：反过来先删文件，DB 事务失败就丢内容了。
    # 路径由 note_id/user_id 重新计算，不信任 DB 里可能被写坏的 markdown_path。
    delete_private_note_files(note_id, note_user_id)
    return {"ok": True, "id": note_id}
