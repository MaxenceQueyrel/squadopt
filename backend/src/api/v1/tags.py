from fastapi import APIRouter, Depends, HTTPException

from api.core.deps import require_org_member
from api.models.tag import Tag, TagCreate
from api.repositories.file_repository import FileRepository
from api.v1 import people as people_module
from api.v1 import projects as projects_module

router = APIRouter()
repo: FileRepository[Tag] = FileRepository("tags", Tag)


def require_known_tags(tags: list[str], organization_id: str) -> None:
    """Rejects tag references that are not in the organization's tag catalog.

    Args:
        tags: The referenced tag ids.
        organization_id: The active organization.

    Raises:
        HTTPException: 400 naming every unknown tag.
    """
    known = {tag.id for tag in repo.list(organization_id)}
    unknown = [tag for tag in tags if tag not in known]
    if unknown:
        raise HTTPException(
            status_code=400, detail=f"Unknown tags: {', '.join(unknown)}"
        )


@router.get("/", response_model=list[Tag])
def list_tags(organization_id: str = Depends(require_org_member)):
    return repo.list(organization_id)


@router.get("/{tag_id}", response_model=Tag)
def get_tag(tag_id: str, organization_id: str = Depends(require_org_member)):
    tag = repo.get(tag_id, organization_id)
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")
    return tag


@router.post("/", response_model=Tag, status_code=201)
def create_tag(data: TagCreate, organization_id: str = Depends(require_org_member)):
    if not data.id.strip():
        raise HTTPException(status_code=400, detail="Tag id is required")
    if repo.get(data.id, organization_id):
        raise HTTPException(status_code=409, detail="Tag already exists")
    return repo.create(data.model_dump(), organization_id)


@router.put("/{tag_id}", response_model=Tag)
def update_tag(
    tag_id: str, data: TagCreate, organization_id: str = Depends(require_org_member)
):
    tag = repo.update(tag_id, data.model_dump(), organization_id)
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")
    return tag


@router.delete("/{tag_id}", status_code=204)
def delete_tag(tag_id: str, organization_id: str = Depends(require_org_member)):
    if not repo.delete(tag_id, organization_id):
        raise HTTPException(status_code=404, detail="Tag not found")
    _remove_tag_references(tag_id, organization_id)


def _remove_tag_references(tag_id: str, organization_id: str) -> None:
    for person in people_module.repo.list(organization_id):
        if tag_id in person.tags:
            data = person.model_dump(exclude={"id", "organization_id", "base_capacity"})
            data["tags"] = [tag for tag in person.tags if tag != tag_id]
            people_module.repo.update(person.id, data, organization_id)
    for project in projects_module.repo.list(organization_id):
        if tag_id in project.excluded_tags:
            data = project.model_dump(exclude={"id", "organization_id"})
            data["excluded_tags"] = [
                tag for tag in project.excluded_tags if tag != tag_id
            ]
            projects_module.repo.update(project.id, data, organization_id)
