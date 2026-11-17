from datetime import date
from typing import Self

from pydantic import BaseModel, Field, model_validator


class DateRange(BaseModel):
    start: date = Field(description="Start date of the range, inclusive.")
    end: date = Field(description="End date of the range, inclusive.")

    @model_validator(mode="after")
    def _check_order(self) -> Self:
        if self.end < self.start:
            raise ValueError("End date must not be before start date")
        return self


class AvailabilityWindow(DateRange):
    ratio: float = Field(
        ge=0, le=1, description="Fraction of FTE available during this window, overriding the working-pattern ratio."
    )
