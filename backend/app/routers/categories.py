from sqlalchemy import func
from sqlalchemy.orm import Session
from fastapi import APIRouter, Depends

from app.database import get_db
from app.models import Category, Video
from app.schemas import CategoryOut, CategoryTreeOut, CategoryTreeWithVideosOut


router = APIRouter(prefix="/api/categories", tags=["categories"])


def build_full_path(node: Category, by_id: dict[int, Category]) -> str:
    parts = [node.name]
    parent = by_id.get(node.parent_id)
    while parent:
        parts.append(parent.name)
        parent = by_id.get(parent.parent_id)
    return " / ".join(reversed(parts))


@router.get("", response_model=list[CategoryOut])
def get_categories(db: Session = Depends(get_db)):
    rows = (
        db.query(Category, func.count(Video.id))
        .outerjoin(Video, Video.category_id == Category.id)
        .group_by(Category.id)
        .order_by(Category.sort_order, Category.name)
        .all()
    )

    result = []
    for category, count in rows:
        result.append(
            CategoryOut(
                id=category.id,
                name=category.name,
                path=category.path,
                sort_order=category.sort_order,
                parent_id=category.parent_id,
                video_count=count,
            )
        )
    return result


@router.get("/tree", response_model=list[CategoryTreeOut])
def get_category_tree(db: Session = Depends(get_db)):
    rows = db.query(Category, func.count(Video.id)).outerjoin(Video, Video.category_id == Category.id).group_by(Category.id).all()
    categories = {category.id: category for category, _count in rows}
    direct_counts = {category.id: int(count) for category, count in rows}
    nodes: dict[int, CategoryTreeOut] = {}

    for category_id, category in categories.items():
        nodes[category_id] = CategoryTreeOut(
            id=category.id,
            name=category.name,
            path=category.path,
            sort_order=category.sort_order,
            parent_id=category.parent_id,
            video_count=direct_counts.get(category.id, 0),
            full_path=build_full_path(category, categories),
            level=0,
            children=[],
        )

    roots: list[CategoryTreeOut] = []
    for node in nodes.values():
        if node.parent_id and node.parent_id in nodes:
            parent = nodes[node.parent_id]
            node.level = parent.level + 1
            parent.children.append(node)
        else:
            roots.append(node)

    def sort_nodes(items: list[CategoryTreeOut]) -> None:
        items.sort(key=lambda item: (item.sort_order, item.name))
        for item in items:
            sort_nodes(item.children)

    def calc_total(node: CategoryTreeOut) -> int:
        total = direct_counts.get(node.id, 0)
        for child in node.children:
            total += calc_total(child)
        node.video_count = total
        return total

    sort_nodes(roots)
    for root in roots:
        calc_total(root)
    return roots


@router.get("/tree/videos", response_model=list[CategoryTreeWithVideosOut])
def get_category_tree_with_videos(db: Session = Depends(get_db)):
    rows = db.query(Category, func.count(Video.id)).outerjoin(Video, Video.category_id == Category.id).group_by(Category.id).all()
    categories = {category.id: category for category, _count in rows}
    direct_counts = {category.id: int(count) for category, count in rows}

    video_rows = db.query(Video.id, Video.category_id).all()
    video_ids_by_category: dict[int, list[int]] = {}
    for video_id, cat_id in video_rows:
        if cat_id is not None:
            video_ids_by_category.setdefault(cat_id, []).append(video_id)

    nodes: dict[int, CategoryTreeWithVideosOut] = {}
    for category_id, category in categories.items():
        nodes[category_id] = CategoryTreeWithVideosOut(
            id=category.id,
            name=category.name,
            path=category.path,
            sort_order=category.sort_order,
            parent_id=category.parent_id,
            video_count=direct_counts.get(category.id, 0),
            full_path=build_full_path(category, categories),
            level=0,
            children=[],
            video_ids=video_ids_by_category.get(category.id, []),
        )

    roots: list[CategoryTreeWithVideosOut] = []
    for node in nodes.values():
        if node.parent_id and node.parent_id in nodes:
            parent = nodes[node.parent_id]
            node.level = parent.level + 1
            parent.children.append(node)
        else:
            roots.append(node)

    def sort_nodes(items: list[CategoryTreeWithVideosOut]) -> None:
        items.sort(key=lambda item: (item.sort_order, item.name))
        for item in items:
            sort_nodes(item.children)

    def calc_total(node: CategoryTreeWithVideosOut) -> int:
        total = direct_counts.get(node.id, 0)
        for child in node.children:
            total += calc_total(child)
        node.video_count = total
        return total

    sort_nodes(roots)
    for root in roots:
        calc_total(root)
    return roots
