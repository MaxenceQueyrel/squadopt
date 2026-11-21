from pydantic import BaseModel, Field


class TagBase(BaseModel):
    id: str = Field(description="Identifier of the tag.")
    description: str = Field(default="", description="Description of the tag.")


class Tag(TagBase):
    organization_id: str


class TagCreate(TagBase):
    pass
