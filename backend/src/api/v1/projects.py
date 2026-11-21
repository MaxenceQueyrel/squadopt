from fastapi import APIRouter, Depends, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from api.core.deps import require_org_member
from api.core.projects_csv import (
    ProjectCsvRowError,
    decode_projects_csv,
    encode_projects_csv,
)
from api.models.project import Project, ProjectCreate
from api.repositories.file_repository import FileRepository
from api.v1 import tags as tags_module

router = APIRouter()
repo: FileRepository[Project] = FileRepository("projects", Project)


@router.get("/", response_model=list[Project])
def list_projects(organization_id: str = Depends(require_org_member)):
    return repo.list(organization_id)


class ImportSummary(BaseModel):
    created: list[str]
    skipped: list[str]
    created_tags: list[str] = []


@router.post("/import", response_model=ImportSummary)
def import_projects(
    file: UploadFile, organization_id: str = Depends(require_org_member)
):
    content = file.file.read().decode("utf-8")
    try:
        rows = decode_projects_csv(content)
    except ProjectCsvRowError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    # Excluded tags missing from the catalog are created, as the people import
    # does, so an export from another organization imports as-is.
    existing_tag_ids = {tag.id for tag in tags_module.repo.list(organization_id)}
    created_tags: list[str] = []
    created: list[str] = []
    skipped: list[str] = []
    for project_id, data in rows:
        for tag_id in data.excluded_tags:
            if tag_id and tag_id not in existing_tag_ids:
                tags_module.repo.create(
                    {"id": tag_id, "description": ""}, organization_id
                )
                existing_tag_ids.add(tag_id)
                created_tags.append(tag_id)

        if repo.get(project_id, organization_id):
            skipped.append(project_id)
            continue
        repo.create({**data.model_dump(), "id": project_id}, organization_id)
        created.append(project_id)

    return ImportSummary(created=created, skipped=skipped, created_tags=created_tags)


@router.get("/export")
def export_projects(organization_id: str = Depends(require_org_member)):
    csv_text = encode_projects_csv(repo.list(organization_id))
    return StreamingResponse(
        iter([csv_text]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=projects.csv"},
    )


@router.get("/{project_id}", response_model=Project)
def get_project(project_id: str, organization_id: str = Depends(require_org_member)):
    project = repo.get(project_id, organization_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


@router.post("/", response_model=Project, status_code=201)
def create_project(
    data: ProjectCreate, organization_id: str = Depends(require_org_member)
):
    tags_module.require_known_tags(data.excluded_tags, organization_id)
    return repo.create(data.model_dump(), organization_id)


@router.put("/{project_id}", response_model=Project)
def update_project(
    project_id: str,
    data: ProjectCreate,
    organization_id: str = Depends(require_org_member),
):
    tags_module.require_known_tags(data.excluded_tags, organization_id)
    project = repo.update(project_id, data.model_dump(), organization_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


@router.delete("/{project_id}", status_code=204)
def delete_project(project_id: str, organization_id: str = Depends(require_org_member)):
    if not repo.delete(project_id, organization_id):
        raise HTTPException(status_code=404, detail="Project not found")
